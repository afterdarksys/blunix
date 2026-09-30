"""Threats: command injection, unintended account privilege, and partial setup.
Validated personal provisioning accepts no shell, arbitrary packages, or scripts.

Only the explicitly chosen packages are installed from the image's configured
Debian repositories. Service starts are suppressed while installing offline.
"""
import base64
import contextlib
import os
import re
from pathlib import Path

from blunix.cmd import run_cmd
from blunix.errors import BlunixError
from blunix.schema import require_keys, write_text

PACKAGES = ("curl", "git", "htop", "jq", "tmux", "vim", "wget", "rsync", "python3", "podman", "nginx", "postgresql-client", "dnsutils", "tcpdump", "strace")


def parse_packages(value):
    if not isinstance(value, list) or len(value) > len(PACKAGES):
        raise BlunixError("refused packages")
    if any(not isinstance(p, str) or p not in PACKAGES for p in value) or len(set(value)) != len(value):
        raise BlunixError("refused packages")
    return sorted(value)


def parse_install(value, target):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise BlunixError("refused install")
    require_keys(value, {"erase", "reboot"})
    if value.get("erase") is not True or not isinstance(value.get("reboot"), bool) or not target:
        raise BlunixError("refused install")
    return dict(value)


def parse_admin(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise BlunixError("refused admin")
    require_keys(value, {"name", "sshPublicKey"})
    name, key = value.get("name"), value.get("sshPublicKey")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,30}", name) or name in ("root", "daemon", "nobody", "bin", "sys", "sync", "games", "mail", "www-data", "backup", "systemd-network"):
        raise BlunixError("refused admin")
    if not isinstance(key, str) or not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/]{68}", key):
        raise BlunixError("refused public key")
    try:
        data = base64.b64decode(key.split()[1], validate=True)
    except ValueError:
        raise BlunixError("refused public key")
    if len(data) != 51 or data[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20":
        raise BlunixError("refused public key")
    return {"name": name, "sshPublicKey": key}


@contextlib.contextmanager
def replacement(path, data, mode):
    """Restore files and symlinks exactly, including after an apt failure."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    link = os.readlink(path) if path.is_symlink() else None
    exists = path.exists() and link is None
    original = path.read_bytes() if exists else None
    original_mode = path.stat().st_mode & 0o777 if exists else None
    if path.is_symlink():
        path.unlink()
    try:
        path.write_bytes(data)
        path.chmod(mode)
        yield
    finally:
        path.unlink(missing_ok=True)
        if link is not None:
            path.symlink_to(link)
        elif exists:
            path.write_bytes(original)
            path.chmod(original_mode)


def provision(root, packages, admin, runner=run_cmd):
    packages = parse_packages(packages)
    admin = parse_admin(admin)
    if not packages and admin is None:
        return
    prefix = [] if os.path.abspath(root) == "/" else ["chroot", os.path.abspath(root)]
    def command(args):
        runner(prefix + args, check=True, timeout=1800, capture_output=True)
    wanted = sorted(set(packages + (["sudo", "openssh-server"] if admin else [])))
    # DNS in the mounted image may point into /run, which is not mounted.
    with contextlib.ExitStack() as stack:
        if prefix:
            stack.enter_context(replacement(Path(root) / "etc/resolv.conf", Path("/etc/resolv.conf").read_bytes(), 0o644))
            stack.enter_context(replacement(Path(root) / "usr/sbin/policy-rc.d", b"#!/bin/sh\nexit 101\n", 0o755))
        command(["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "update"])
        command(["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-y", "--no-install-recommends", "-o", "Dpkg::Options::=--force-confold", "install", "--"] + wanted)
        # Record what apt actually installed, not just the requested names.
        result = runner(prefix + ["dpkg-query", "-W", "-f=${binary:Package}=${Version}\n"], check=True, timeout=60, capture_output=True)
        manifest = result.stdout.decode("utf-8") if isinstance(result.stdout, bytes) else result.stdout
        write_text(os.path.join(root, "var/lib/blunix/packages.lock"), manifest, 0o644)
        if admin:
            name = admin["name"]
            passwd = Path(root) / "etc/passwd"
            # Never grant sudo to a pre-existing system account.
            existing = next((line.split(":") for line in passwd.read_text().splitlines() if line.split(":")[0] == name), None)
            if existing and (int(existing[2]) < 1000 or existing[5] != "/home/" + name):
                raise BlunixError("refused existing admin")
            if not existing:
                command(["useradd", "--create-home", "--no-user-group", "--gid", "users", "--shell", "/bin/bash", "--", name])
            folder = Path(root) / "home" / name / ".ssh"
            folder.mkdir(parents=True, exist_ok=True)
            folder.chmod(0o700)
            write_text(str(folder / "authorized_keys"), admin["sshPublicKey"] + "\n", 0o600)
            command(["usermod", "--shell", "/bin/bash", "--", name])
            # Primary group names need not match usernames on an existing system.
            entry = next(line.split(":") for line in passwd.read_text().splitlines() if line.split(":")[0] == name)
            command(["chown", "-R", entry[2] + ":" + entry[3], "/home/" + name + "/.ssh"])
            write_text(os.path.join(root, "etc/sudoers.d/blunix-admin"), name + " ALL=(ALL:ALL) NOPASSWD: ALL\n", 0o440)
            write_text(os.path.join(root, "etc/ssh/sshd_config.d/00-blunix-admin.conf"), "PubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n", 0o644)
            command(["systemctl", "enable", "ssh.service"])
