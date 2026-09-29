#!/usr/bin/env python3
"""Scan a mounted root for vendor binaries and plaintext test secrets.

Threats: a copied passphrase or root password would ship in the disk. This
script prints a fixed line and no path when that happens. Filename matches
for grok, claude, and codex are the vendor-binary check. Symlinks whose
target leaves the mount are not read. A symlink with no target has no file
content; its link text is still checked. An unreadable regular file fails
closed.
"""

import os
import re
import stat
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_HERE, ".."))
_CHAR = re.compile(r"[A-Za-z0-9_-]{8,128}\Z")
_VENDOR = ("grok", "claude", "codex")


def _fail(message):
    sys.stderr.write(message + "\n")
    raise SystemExit(1)


def _secrets():
    found = []
    for name in ("root-password", "bootstrap-passphrase"):
        path = os.path.join(_REPO, "build", name)
        try:
            with open(path, "rb") as handle:
                raw = handle.read(512)
        except OSError:
            _fail("blunix: scan failed")
        if b"\x00" in raw or len(raw) > 256:
            _fail("blunix: scan failed")
        try:
            text = raw.decode("ascii").strip()
        except UnicodeDecodeError:
            _fail("blunix: scan failed")
        if not _CHAR.fullmatch(text):
            _fail("blunix: scan failed")
        found.append(text.encode("ascii"))
    return found


def _inside(root_real, path):
    real = os.path.realpath(path)
    if real == root_real:
        return True
    return real.startswith(root_real + os.sep)


def _contains(path, needles):
    try:
        handle = open(path, "rb")
    except OSError:
        _fail("blunix: scan failed")
    try:
        prev = b""
        while True:
            try:
                chunk = handle.read(1024 * 1024)
            except OSError:
                _fail("blunix: scan failed")
            if not chunk:
                return False
            blob = prev + chunk
            for needle in needles:
                if needle in blob:
                    return True
            prev = blob[-256:]
    finally:
        handle.close()


def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        _fail("blunix: scan failed")
    root = os.path.abspath(sys.argv[1])
    root_real = os.path.realpath(root)
    needles = _secrets()
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        if not _inside(root_real, dirpath):
            dirnames[:] = []
            continue
        kept = []
        for name in dirnames:
            if name in _VENDOR:
                _fail("vendor binary in image")
            child = os.path.join(dirpath, name)
            if _inside(root_real, child):
                kept.append(name)
        dirnames[:] = kept
        for name in filenames:
            path = os.path.join(dirpath, name)
            if name in _VENDOR:
                _fail("vendor binary in image")
            try:
                kind = os.lstat(path)
            except OSError:
                _fail("blunix: scan failed")
            if stat.S_ISLNK(kind.st_mode):
                try:
                    link = os.readlink(path)
                except OSError:
                    _fail("blunix: scan failed")
                encoded = link.encode("utf-8", "surrogateescape")
                for needle in needles:
                    if needle in encoded:
                        _fail("plaintext secret leaked into the image")
                if not _inside(root_real, path):
                    continue
                try:
                    info = os.stat(path)
                except OSError:
                    continue
            elif stat.S_ISREG(kind.st_mode):
                info = kind
            else:
                continue
            if not stat.S_ISREG(info.st_mode):
                continue
            if not _inside(root_real, path):
                continue
            if _contains(path, needles):
                _fail("plaintext secret leaked into the image")


if __name__ == "__main__":
    main()
