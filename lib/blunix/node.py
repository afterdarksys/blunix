"""Threats: apply renders every section in memory and publishes files only
after each renderer accepts the document. A refused document does not write
node.yaml or bootstrap-complete.

The document is unsigned in this spike. apply says so on the log callback.
Signing is still open. This module does not invent a signature.
"""

from __future__ import annotations

import os

import yaml

from blunix.access import apply_access, load_access
from blunix.ai import install_ai, load_ai
from blunix.cmd import run_cmd
from blunix.disk import load_disk, render_disk, write_disk
from blunix.errors import BlunixError
from blunix.network import load_network, write_network
from blunix.schema import (
    load_bytes,
    load_path,
    load_text,
    models_dir,
    reject_banned,
    require_header,
    require_keys,
    require_name,
    write_text,
)

_NODE_KEYS = {
    "apiVersion",
    "kind",
    "name",
    "hostname",
    "disk",
    "network",
    "access",
    "ai",
    "update",
    "sysexts",
}
_UPDATE_KEYS = {"url", "channel"}


def _update(value):
    if not isinstance(value, dict):
        raise BlunixError("refused update")
    require_keys(value, _UPDATE_KEYS)
    url = value.get("url")
    if not isinstance(url, str) or not url.startswith("https://") or len(url) > 256:
        raise BlunixError("refused update")
    rest = url[len("https://"):]
    host, sep, path = rest.partition("/")
    if not host or "@" in host or "\\" in url or " " in url:
        raise BlunixError("refused update")
    if any(ord(ch) < 33 or ord(ch) > 126 for ch in url):
        raise BlunixError("refused update")
    channel = value.get("channel")
    if channel != "stable":
        raise BlunixError("refused channel")
    return {"url": url, "channel": channel, "path": path if sep else ""}


def parse_node(doc):
    if not isinstance(doc, dict):
        raise BlunixError("rejected plaintext")
    require_keys(doc, _NODE_KEYS)
    require_header(doc, "Node")
    name = require_name(doc.get("name"), "name")
    hostname = require_name(doc.get("hostname"), "hostname")
    disk = require_name(doc.get("disk"), "disk")
    network = require_name(doc.get("network"), "network")
    access = require_name(doc.get("access"), "access")
    ai = require_name(doc.get("ai"), "ai")
    update = _update(doc.get("update"))
    sysexts = doc.get("sysexts")
    if sysexts != []:
        raise BlunixError("refused sysexts")
    return {
        "name": name,
        "hostname": hostname,
        "disk": disk,
        "network": network,
        "access": access,
        "ai": ai,
        "update": update,
    }


def coerce_doc(doc):
    if isinstance(doc, bytes):
        return load_bytes(doc)
    if isinstance(doc, str):
        return load_text(doc)
    if isinstance(doc, dict):
        reject_banned(doc)
        return doc
    raise BlunixError("rejected plaintext")


def _say(log, message):
    if log is not None:
        log(message)


def _live(root):
    return os.path.abspath(root) == "/"


def _publish_hostname(root, hostname):
    write_text(os.path.join(root, "etc", "hostname"), hostname + "\n")
    hosts = "127.0.0.1 localhost\n127.0.1.1 " + hostname + "\n"
    write_text(os.path.join(root, "etc", "hosts"), hosts)
    if _live(root):
        run_cmd(["hostname", hostname], check=False)


def _save_boot_entry(root, entry, log):
    if not _live(root):
        return
    proc = run_cmd(["grub-set-default", entry], check=False)
    if proc.returncode != 0:
        _say(log, "blunix: boot entry was not saved")


def apply_node(doc, root, models=None, log=None):
    original = coerce_doc(doc)
    parsed = parse_node(original)
    models = models_dir(models)
    disk = load_disk(models, parsed["disk"])
    network = load_network(models, parsed["network"])
    access = load_access(models, parsed["access"])
    ai = load_ai(models, parsed["ai"])
    # Render before any write so a refusal leaves the tree untouched.
    render_disk(disk)
    dumped = yaml.safe_dump(original, sort_keys=False)
    if not isinstance(dumped, str) or "password" in dumped.lower():
        raise BlunixError("refused field")
    write_disk(disk, os.path.join(root, "usr", "lib", "repart.d"))
    write_network(network, os.path.join(root, "run", "systemd", "network"))
    plan = apply_access(access, root, log=log)
    _save_boot_entry(root, plan["entry"], log)
    install_ai(ai, root)
    _publish_hostname(root, parsed["hostname"])
    if _live(root):
        run_cmd(["networkctl", "reload"], check=False)
    state = os.path.join(root, "var", "lib", "blunix")
    os.makedirs(state, exist_ok=True)
    write_text(os.path.join(state, "node.yaml"), dumped, 0o644)
    _say(log, "blunix: node document is unsigned; spike is applying it without a signature")
    _say(log, "blunix: disk layout recorded; systemd-repart was not executed")
    _say(log, "blunix: applied node document " + parsed["name"])
    write_text(os.path.join(state, "bootstrap-complete"), "applied\n", 0o644)
    return parsed


def boot_node(root="/", models=None, log=None):
    path = os.path.join(root, "var", "lib", "blunix", "node.yaml")
    if not os.path.isfile(path):
        return 0
    doc = load_path(path)
    parsed = parse_node(doc)
    network = load_network(models_dir(models), parsed["network"])
    write_network(network, os.path.join(root, "run", "systemd", "network"))
    if _live(root):
        run_cmd(["networkctl", "reload"], check=False)
    return 0
