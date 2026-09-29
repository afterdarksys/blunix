"""Threats: a network model chooses addresses and which interfaces match.
A match of `*`, a bridge, a veth, or a container NIC is refused. DHCP and a
static address in the same model are refused. Rendering writes one
systemd-networkd unit and does not run a shell.

v1 models do not emit a .link or a .netdev. A .link that matched every NIC
would take naming away from udev, and the DHCP match would miss the name
VMware assigns.
"""

from __future__ import annotations

import ipaddress
import os
import re

from blunix.errors import BlunixError
from blunix.schema import (
    load_path,
    model_path,
    require_bool,
    require_header,
    require_keys,
    require_name,
    write_text,
)

_NET_KEYS = {
    "apiVersion",
    "kind",
    "name",
    "dhcp",
    "match",
    "address",
    "gateway",
    "dns",
}
_SPECIFIC = re.compile(r"(en[a-z0-9]{1,14}|eth[0-9]{1,4})")
_FILE = "10-blunix.network"


def check_match(pattern):
    if pattern in ("en*", "eth*"):
        return pattern
    if isinstance(pattern, str) and _SPECIFIC.fullmatch(pattern):
        return pattern
    raise BlunixError("refused interface match")


def _address(value):
    if not isinstance(value, str) or "/" not in value:
        raise BlunixError("refused address")
    try:
        iface = ipaddress.ip_interface(value)
    except ValueError:
        raise BlunixError("refused address")
    if iface.network.prefixlen == 0 or iface.ip.is_multicast or iface.ip.is_unspecified:
        raise BlunixError("refused address")
    return str(iface)


def _host(value, what):
    if not isinstance(value, str) or "/" in value:
        raise BlunixError("refused " + what)
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        raise BlunixError("refused " + what)
    if addr.is_multicast or addr.is_unspecified:
        raise BlunixError("refused " + what)
    return str(addr)


def parse_network(doc):
    if not isinstance(doc, dict):
        raise BlunixError("rejected plaintext")
    require_keys(doc, _NET_KEYS)
    require_header(doc, "Network")
    name = require_name(doc.get("name"), "name")
    patterns = doc.get("match")
    if not isinstance(patterns, list) or not patterns or len(patterns) > 8:
        raise BlunixError("refused interface match")
    match = [check_match(item) for item in patterns]
    dhcp = "dhcp" in doc
    static = any(key in doc for key in ("address", "gateway", "dns"))
    if dhcp and static:
        raise BlunixError("refused network")
    if not dhcp and not static:
        raise BlunixError("refused network")
    if dhcp:
        if require_bool(doc.get("dhcp"), "dhcp") is not True:
            raise BlunixError("refused network")
        return {"name": name, "dhcp": True, "match": match}
    address = _address(doc.get("address"))
    gateway = _host(doc.get("gateway"), "gateway")
    dns_raw = doc.get("dns")
    if not isinstance(dns_raw, list) or not dns_raw or len(dns_raw) > 4:
        raise BlunixError("refused dns")
    dns = [_host(item, "dns") for item in dns_raw]
    if ipaddress.ip_interface(address).ip == ipaddress.ip_address(gateway):
        raise BlunixError("refused gateway")
    return {
        "name": name,
        "dhcp": False,
        "match": match,
        "address": address,
        "gateway": gateway,
        "dns": dns,
    }


def load_network(models, name):
    parsed = parse_network(load_path(model_path(models, "network", name)))
    if parsed["name"] != name:
        raise BlunixError("refused name")
    return parsed


def render_network(model):
    lines = ["# blunix model: " + model["name"], "[Match]"]
    for pattern in model["match"]:
        lines.append("Name=" + pattern)
    lines.append("")
    lines.append("[Network]")
    if model["dhcp"]:
        lines.append("DHCP=yes")
        lines.append("IPv6AcceptRA=yes")
        lines.append("")
        lines.append("[DHCPv4]")
        lines.append("UseDNS=yes")
        lines.append("")
        lines.append("[DHCPv6]")
        lines.append("UseDNS=yes")
    else:
        lines.append("DHCP=no")
        lines.append("IPv6AcceptRA=no")
        lines.append("Address=" + model["address"])
        lines.append("Gateway=" + model["gateway"])
        for item in model["dns"]:
            lines.append("DNS=" + item)
    body = "\n".join(lines) + "\n"
    return {_FILE: body}


def write_network(model, dest):
    os.makedirs(dest, exist_ok=True)
    files = render_network(model)
    for name, body in files.items():
        write_text(os.path.join(dest, name), body)
    return files
