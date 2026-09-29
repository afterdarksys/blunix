"""Fail-closed checks for the mounted-root secret scan.

Threats: a dangling symlink is not file content, a link that leaves the
mount must not be followed, and a secret in a regular file or in link text
must still be rejected. These tests do not print secret bytes.
"""

import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCAN = os.path.join(ROOT, "image", "scan-root.py")


def _secret(name):
    path = os.path.join(ROOT, "build", name)
    with open(path, "rb") as handle:
        raw = handle.read(512)
    return raw.decode("ascii").strip().encode("ascii")


class ScanRootTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.needles = []
        for name in ("root-password", "bootstrap-passphrase"):
            try:
                cls.needles.append(_secret(name))
            except (OSError, UnicodeError):
                raise AssertionError("test secret missing")

    def _run(self, root):
        proc = subprocess.run(
            [sys.executable, SCAN, root],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        err = proc.stderr.decode("ascii", "replace").strip()
        return proc.returncode, err

    def test_dangling_symlink_is_not_content(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "etc"))
            os.symlink("../proc/self/mounts", os.path.join(root, "etc", "mtab"))
            code, err = self._run(root)
        self.assertEqual(code, 0)
        self.assertEqual(err, "")

    def test_secret_in_regular_file(self):
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, "note")
            with open(path, "wb") as handle:
                handle.write(b"prefix " + self.needles[0] + b" suffix\n")
            code, err = self._run(root)
        self.assertEqual(code, 1)
        self.assertEqual(err, "plaintext secret leaked into the image")

    def test_secret_in_link_text(self):
        with tempfile.TemporaryDirectory() as root:
            os.symlink(self.needles[1].decode("ascii"), os.path.join(root, "leak"))
            code, err = self._run(root)
        self.assertEqual(code, 1)
        self.assertEqual(err, "plaintext secret leaked into the image")

    def test_outside_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as outside:
            leaked = os.path.join(outside, "hidden")
            with open(leaked, "wb") as handle:
                handle.write(self.needles[0])
            with tempfile.TemporaryDirectory() as root:
                os.symlink(leaked, os.path.join(root, "via"))
                code, err = self._run(root)
        self.assertEqual(code, 0)
        self.assertEqual(err, "")

    def test_vendor_filename(self):
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, "grok"), "wb") as handle:
                handle.write(b"x")
            code, err = self._run(root)
        self.assertEqual(code, 1)
        self.assertEqual(err, "vendor binary in image")


if __name__ == "__main__":
    unittest.main()
