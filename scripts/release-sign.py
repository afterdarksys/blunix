#!/usr/bin/env python3
"""Friendly names for GPG release keys; requires Python 3.9+ and GnuPG 2.2+.

Threats: pin full fingerprints, reject signature/key mismatches and unsafe
manifest paths, never store passphrases, serialize alias changes, and refuse
to overwrite output files. The local alias registry is a trusted input.
"""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def fingerprint(value):
    value = value.upper()
    if not re.fullmatch(r"[0-9A-F]{40}|[0-9A-F]{64}", value):
        raise ValueError("use a complete GPG fingerprint")
    return value


class Keyring:
    def __init__(self, home=None):
        self.command = ["gpg"] + (["--homedir", str(home)] if home else [])

    def run(self, *args):
        result = subprocess.run(self.command + list(args), stdout=subprocess.PIPE,
                                check=True, env=os.environ.copy())
        return result.stdout

    def require_key(self, key, secret=False):
        key = fingerprint(key)
        data = self.run("--batch", "--with-colons", "--list-secret-keys" if secret
                        else "--list-keys", key).decode()
        primary = False
        for line in data.splitlines():
            fields = line.split(":")
            if fields[0] in ("pub", "sec"):
                primary = True
            elif fields[0] in ("sub", "ssb"):
                primary = False
            elif fields[0] == "fpr" and primary and fields[9] == key:
                return key
        raise ValueError("fingerprint must identify an existing primary key")

    def create(self, uid, expires):
        # GPG handles passphrase entry through pinentry, never this script.
        status = self.run("--status-fd", "1", "--quick-generate-key", uid,
                          "ed25519", "cert,sign", expires).decode()
        for line in status.splitlines():
            if line.startswith("[GNUPG:] KEY_CREATED "):
                return fingerprint(line.split()[-1])
        raise ValueError("GPG did not report a new key; inspect your keyring")

    def sign(self, key, source, output):
        self.require_key(key, secret=True)
        with tempfile.TemporaryDirectory() as temporary:
            signature = Path(temporary) / "signature.asc"
            self.run("--armor", "--local-user", key + "!", "--output",
                     str(signature), "--detach-sign", str(source.resolve()))
            self.verify(key, source, signature)
            publish(output, signature.read_bytes())

    def verify(self, key, source, signature):
        status = self.run("--batch", "--status-fd", "1", "--verify",
                          str(signature.resolve()), str(source.resolve())).decode()
        valid = [line.split()[2:] for line in status.splitlines()
                 if line.startswith("[GNUPG:] VALIDSIG ")]
        bad = ("BADSIG", "ERRSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG")
        if any("[GNUPG:] " + tag + " " in status for tag in bad):
            raise ValueError("expired, revoked or invalid signature")
        if len(valid) != 1 or (valid[0][0] != key and valid[0][-1] != key):
            raise ValueError("signature does not match the selected key")


def publish(path, data):
    """Publish complete bytes atomically without clobbering another file."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=".sign-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        os.unlink(temporary)


@contextlib.contextmanager
def registry(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(str(path) + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads(path.read_text()) if path.exists() else {}
        before = json.dumps(data, sort_keys=True)
        yield data
        if json.dumps(data, sort_keys=True) != before:
            fd, temporary = tempfile.mkstemp(prefix=".keys-", dir=path.parent)
            try:
                with os.fdopen(fd, "w") as stream:
                    json.dump(data, stream, indent=2)
                    stream.write("\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def release_file(directory, name):
    if (not name or name in (".", "..", "SHA256SUMS", "SHA256SUMS.asc")
            or any(c in name for c in "/\\\r\n") or Path(name).name != name):
        raise ValueError("release artifacts must be flat filenames, excluding manifests")
    path = directory / name
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"not a regular release artifact: {name}")
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=Path.home() /
                        ".config/blunix/signing-keys.json")
    parser.add_argument("--homedir", type=Path, help="alternate GPG home")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    for command in ("create", "rotate", "register", "export", "sign", "verify",
                    "sign-key", "sign-release", "verify-release"):
        sub = commands.add_parser(command)
        sub.add_argument("name", help="friendly key name")
        if command in ("create", "rotate"):
            sub.add_argument("--uid", required=True, help="Name <email>")
            sub.add_argument("--expires", default="2y")
        elif command == "register":
            sub.add_argument("fingerprint")
        elif command == "export":
            sub.add_argument("output", type=Path)
        elif command in ("sign", "verify"):
            sub.add_argument("file", type=Path)
            sub.add_argument("--signature", type=Path)
        elif command == "sign-key":
            sub.add_argument("fingerprint", help="primary fingerprint to certify")
        else:
            sub.add_argument("directory", type=Path)
            if command == "sign-release":
                sub.add_argument("artifacts", nargs="+", help="filenames inside directory")
    args = parser.parse_args(argv)
    gpg = Keyring(args.homedir)
    if sys.stdin.isatty():
        os.environ["GPG_TTY"] = os.ttyname(sys.stdin.fileno())
    with registry(args.registry) as keys:
        if args.command == "list":
            print(json.dumps(keys, indent=2))
            return
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", args.name):
            raise ValueError("invalid friendly name")
        if args.command in ("create", "register") and args.name in keys:
            raise ValueError("name already exists; use rotate to replace it")
        if args.command in ("create", "rotate", "register"):
            if args.command == "rotate" and args.name not in keys:
                raise ValueError("unknown friendly name")
            old = keys.get(args.name, {})
            key = (gpg.require_key(args.fingerprint) if args.command == "register"
                   else gpg.create(args.uid, args.expires))
            history = list(old.get("previous", []))
            if old:
                history.append(old["fingerprint"])
            keys[args.name] = {"fingerprint": key, "previous": history}
            print(f"blunix: {args.name} maps to {key}")
            return
        if args.name not in keys:
            raise ValueError("unknown friendly name")
        key = fingerprint(keys[args.name]["fingerprint"])
        if args.command == "export":
            gpg.require_key(key)
            publish(args.output, gpg.run("--armor", "--export", key))
        elif args.command == "sign-key":
            target = gpg.require_key(args.fingerprint)
            gpg.require_key(key, secret=True)
            gpg.run("--local-user", key + "!", "--quick-sign-key", target)
        elif args.command in ("sign", "verify"):
            signature = args.signature or Path(str(args.file) + ".asc")
            if args.command == "sign":
                gpg.sign(key, args.file, signature)
            else:
                gpg.verify(key, args.file, signature)
        else:
            directory = args.directory.resolve()
            manifest = directory / "SHA256SUMS"
            signature = directory / "SHA256SUMS.asc"
            if args.command == "sign-release":
                if manifest.exists() or signature.exists():
                    raise ValueError("release manifest or signature already exists")
                names = sorted(set(args.artifacts))
                content = "".join(f"{digest(release_file(directory, name))}  {name}\n"
                                  for name in names)
                with tempfile.TemporaryDirectory() as temporary:
                    staged = Path(temporary) / "SHA256SUMS"
                    staged.write_text(content)
                    staged_sig = Path(temporary) / "SHA256SUMS.asc"
                    gpg.sign(key, staged, staged_sig)
                    publish(manifest, staged.read_bytes())
                    publish(signature, staged_sig.read_bytes())
            else:
                # Verify the exact snapshot that will be parsed, not a mutable path.
                with tempfile.TemporaryDirectory() as temporary:
                    staged = Path(temporary) / "SHA256SUMS"
                    staged.write_bytes(manifest.read_bytes())
                    gpg.verify(key, staged, signature)
                    lines = staged.read_text().splitlines()
                seen = set()
                if not lines:
                    raise ValueError("empty manifest")
                for line in lines:
                    match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
                    if not match or match[2] in seen:
                        raise ValueError("invalid or duplicate manifest entry")
                    seen.add(match[2])
                    if digest(release_file(directory, match[2])) != match[1]:
                        raise ValueError(f"checksum mismatch: {match[2]}")
        print(f"blunix: {args.command} succeeded for {args.name}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"blunix: {error}", file=sys.stderr)
        sys.exit(1)
