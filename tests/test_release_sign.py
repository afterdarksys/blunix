"""Real GPG integration checks use disposable, unprotected test keys only."""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/release-sign.py"
SPEC = importlib.util.spec_from_file_location("release_sign", SCRIPT)
signing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signing)


@unittest.skipUnless(shutil.which("gpg"), "GPG is required")
class ReleaseSigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="blunix-gpg-")
        cls.home = Path(cls.temp.name)
        os.chmod(cls.home, 0o700)
        cls.gpg = signing.Keyring(cls.home)
        cls.keys = []
        for index in range(2):
            result = cls.gpg.run(
                "--batch", "--pinentry-mode", "loopback", "--passphrase", "",
                "--status-fd", "1", "--quick-generate-key",
                f"Test {index} <test{index}@example.invalid>", "ed25519", "cert,sign", "1d")
            cls.keys.append(next(line.split()[-1] for line in result.decode().splitlines()
                                 if line.startswith("[GNUPG:] KEY_CREATED ")))

    @classmethod
    def tearDownClass(cls):
        subprocess.run(["gpgconf", "--homedir", str(cls.home), "--kill", "all"], check=True)
        cls.temp.cleanup()

    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.registry = self.root / "keys.json"
        self.cli("register", "releases", self.keys[0])

    def cli(self, *args):
        signing.main(["--homedir", str(self.home), "--registry", str(self.registry), *args])

    def test_sign_verify_tamper_and_wrong_key(self):
        artifact = self.root / "image.raw"
        artifact.write_bytes(b"image")
        self.cli("sign", "releases", str(artifact))
        self.cli("verify", "releases", str(artifact))
        self.cli("register", "other", self.keys[1])
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.cli("verify", "other", str(artifact))
        artifact.write_bytes(b"tampered")
        with self.assertRaises(subprocess.CalledProcessError):
            self.cli("verify", "releases", str(artifact))

    def test_release_verification_and_tamper(self):
        (self.root / "image.raw").write_bytes(b"image")
        (self.root / "installer.iso").write_bytes(b"installer")
        self.cli("sign-release", "releases", str(self.root), "installer.iso", "image.raw")
        self.cli("verify-release", "releases", str(self.root))
        (self.root / "image.raw").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            self.cli("verify-release", "releases", str(self.root))

    def test_signed_manifest_rejects_traversal(self):
        manifest = self.root / "SHA256SUMS"
        manifest.write_text("0" * 64 + "  ../outside\n")
        self.gpg.sign(self.keys[0], manifest, self.root / "SHA256SUMS.asc")
        with self.assertRaisesRegex(ValueError, "flat filenames"):
            self.cli("verify-release", "releases", str(self.root))

    def test_refuses_overwrite_and_symlinks(self):
        output = self.root / "public.asc"
        self.cli("export", "releases", str(output))
        original = output.read_bytes()
        with self.assertRaises(FileExistsError):
            self.cli("export", "releases", str(output))
        self.assertEqual(original, output.read_bytes())
        (self.root / "link").symlink_to(output)
        with self.assertRaisesRegex(ValueError, "regular release artifact"):
            self.cli("sign-release", "releases", str(self.root), "link")

    def test_rotation_retains_history_and_failure_retains_mapping(self):
        with self.assertRaises(ValueError), patch.object(
                signing.Keyring, "create", side_effect=ValueError("failed")):
            self.cli("rotate", "releases", "--uid", "Test <test@example.invalid>")
        self.assertEqual(json.loads(self.registry.read_text())["releases"]["fingerprint"],
                         self.keys[0])
        with patch.object(signing.Keyring, "create", return_value=self.keys[1]):
            self.cli("rotate", "releases", "--uid", "Test <test@example.invalid>")
        self.assertEqual(json.loads(self.registry.read_text())["releases"],
                         {"fingerprint": self.keys[1], "previous": [self.keys[0]]})

    def test_real_creation_and_rotation(self):
        run = signing.Keyring.run

        def test_pinentry(keyring, *args):
            return run(keyring, "--batch", "--pinentry-mode", "loopback",
                       "--passphrase", "", *args)

        with patch.object(signing.Keyring, "run", new=test_pinentry):
            self.cli("create", "new", "--uid", "New <new@example.invalid>")
            first = json.loads(self.registry.read_text())["new"]["fingerprint"]
            self.cli("rotate", "new", "--uid", "Rotated <rotated@example.invalid>")
        entry = json.loads(self.registry.read_text())["new"]
        self.assertNotEqual(first, entry["fingerprint"])
        self.assertEqual([first], entry["previous"])
        self.gpg.require_key(entry["fingerprint"], secret=True)

    def test_register_rejects_ambiguous_and_missing_keys(self):
        for key in (self.keys[0][-16:], "A" * 40):
            with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                self.cli("register", "bad", key)
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.cli("register", "releases", self.keys[1])

    def test_key_certification(self):
        self.cli("sign-key", "releases", self.keys[1])
        signatures = self.gpg.run("--with-colons", "--list-sigs", self.keys[1]).decode()
        self.assertTrue(any(line.startswith("sig:") and self.keys[0][-16:] in line
                            for line in signatures.splitlines()))


if __name__ == "__main__":
    unittest.main()
