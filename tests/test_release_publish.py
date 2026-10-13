"""release-publish.py: the fetch-and-verify path, with a fake staging fetcher.

Nothing here touches R2, GitHub or a real keyring.
"""

import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/release-publish.py"
SPEC = importlib.util.spec_from_file_location("release_publish", SCRIPT)
rp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rp)

TAG = "v0.1.1-rc.3"
TAG_OBJECT = "1" * 40
COMMIT = "2" * 40


def sha(data):
    return hashlib.sha256(data).hexdigest()


def staged_release(iso=b"iso bytes", **provenance_overrides):
    """{name: bytes} as builder1 would stage it (or a forger, given another iso)."""
    files = {
        "RELEASE-NOTES.md": b"# Blunix v0.1.1-rc.3\n",
        "SOURCES.md": b"sources\n",
        "blunix-installer.iso": iso,
        "vmlinuz": b"kernel bytes",
    }
    provenance = {
        "schema": rp.SCHEMA, "tag": TAG, "tag_object": TAG_OBJECT, "commit": COMMIT,
        "signer": rp.SIGNER, "repo_url": rp.REPO_URL,
        "builder": {"hostname": "builder1.blunix.io"},
        "artifacts": {n: sha(d) for n, d in files.items()},
    }
    provenance.update(provenance_overrides)
    files[rp.PROVENANCE] = json.dumps(provenance, sort_keys=True).encode() + b"\n"
    files[rp.SUMS] = "".join(f"{sha(files[n])}  {n}\n" for n in sorted(files)).encode()
    return files


def fetcher(files, tamper=None):
    def fetch(tag, name, dest):
        assert tag == TAG
        data = files[name]
        if tamper and name in tamper:
            data = tamper[name]
        Path(dest).write_bytes(data)
    return fetch


class TagNameTests(unittest.TestCase):
    def test_accepts_builder_pattern(self):
        for tag in ("v0.1.1", "v1.2.3-rc.4", "v0.0.0-alpha.0", "v9999.0.1-beta.12"):
            self.assertEqual(rp.check_tag_name(tag), tag)

    def test_rejects_others(self):
        for tag in ("0.1.1", "v0.1", "v01.1.1", "v0.1.1-rc", "v0.1.1-rc.1;rm", "v0.1.1/../x", ""):
            with self.assertRaises(rp.PublishError):
                rp.check_tag_name(tag)

    def test_prerelease(self):
        self.assertTrue(rp.is_prerelease("v0.1.1-rc.3"))
        self.assertFalse(rp.is_prerelease("v0.1.1"))


class SumsTests(unittest.TestCase):
    def good(self):
        return staged_release()[rp.SUMS]

    def test_parses_builder_output(self):
        entries = rp.parse_sums(self.good())
        self.assertIn(rp.PROVENANCE, entries)
        self.assertEqual(len(entries), 5)

    def refuses(self, data):
        with self.assertRaises(rp.PublishError):
            rp.parse_sums(data)

    def test_rejects_traversal_and_unsafe_names(self):
        for name in ("../etc/passwd", "a/b", ".hidden", "SHA256SUMS", "SHA256SUMS.asc", "a b"):
            self.refuses(self.good() + f"{'0' * 64}  {name}\n".encode())

    def test_rejects_duplicates(self):
        line = self.good().split(b"\n")[0] + b"\n"
        self.refuses(self.good() + line)

    def test_rejects_malformed_lines(self):
        self.refuses(self.good() + b"not a line\n")
        self.refuses(self.good() + b"0" * 63 + b"  x\n")
        self.refuses(self.good() + b"0" * 64 + b" *x\n")  # binary-mode marker
        self.refuses(self.good().rstrip(b"\n"))
        self.refuses(b"")

    def test_requires_provenance_and_notes(self):
        lines = [l for l in self.good().split(b"\n") if l and rp.PROVENANCE.encode() not in l]
        self.refuses(b"\n".join(lines) + b"\n")
        lines = [l for l in self.good().split(b"\n") if l and rp.NOTES.encode() not in l]
        self.refuses(b"\n".join(lines) + b"\n")

    def test_rejects_oversize_and_non_ascii(self):
        self.refuses(b"0" * (rp.MAX_SUMS_BYTES + 1))
        self.refuses(self.good() + "é\n".encode())


class ProvenanceTests(unittest.TestCase):
    def check(self, files):
        sums = rp.parse_sums(files[rp.SUMS])
        return rp.check_provenance(files[rp.PROVENANCE], sums, TAG, TAG_OBJECT, COMMIT)

    def test_accepts_matching(self):
        self.assertEqual(self.check(staged_release())["tag"], TAG)

    def test_rejects_each_mismatched_field(self):
        for key, value in (("tag", "v0.1.1-rc.2"), ("tag_object", "3" * 40),
                           ("commit", "4" * 40), ("schema", "other/1"),
                           ("signer", "openpgp:" + "A" * 40),
                           ("repo_url", "https://github.com/evil/blunix.git")):
            with self.subTest(key=key), self.assertRaises(rp.PublishError):
                self.check(staged_release(**{key: value}))

    def test_rejects_artifact_list_drift(self):
        files = staged_release(artifacts={"vmlinuz": "0" * 64})
        with self.assertRaises(rp.PublishError):
            self.check(files)

    def test_rejects_provenance_not_matching_sums(self):
        files = staged_release()
        files[rp.PROVENANCE] = files[rp.PROVENANCE].replace(b"builder1", b"builder2")
        with self.assertRaises(rp.PublishError):
            self.check(files)

    def test_rejects_non_object(self):
        files = staged_release()
        files[rp.PROVENANCE] = b"[]\n"
        files[rp.SUMS] = "".join(f"{sha(files[n])}  {n}\n"
                                 for n in sorted(files) if n != rp.SUMS).encode()
        with self.assertRaises(rp.PublishError):
            self.check(files)


class FetchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="blunix-publish-")
        self.dir = Path(self.temp.name) / TAG

    def tearDown(self):
        self.temp.cleanup()

    def fetch(self, files, tamper=None):
        return rp.fetch_and_verify(TAG, self.dir, TAG_OBJECT, COMMIT, fetcher(files, tamper))

    def test_fetches_and_verifies_everything(self):
        files = staged_release()
        sums, prov = self.fetch(files)
        self.assertEqual(set(sums), set(files) - {rp.SUMS})
        for name, data in files.items():
            self.assertEqual((self.dir / name).read_bytes(), data)
        self.assertEqual(self.dir.stat().st_mode & 0o777, 0o700)

    def test_rejects_a_tampered_artifact_and_removes_it(self):
        files = staged_release()
        with self.assertRaises(rp.PublishError):
            self.fetch(files, tamper={"blunix-installer.iso": b"evil iso"})
        self.assertFalse((self.dir / "blunix-installer.iso").exists())

    def test_rejects_provenance_for_another_commit(self):
        with self.assertRaises(rp.PublishError):
            self.fetch(staged_release(commit="5" * 40))

    def test_refuses_an_existing_directory(self):
        self.dir.mkdir()
        with self.assertRaises(FileExistsError):
            self.fetch(staged_release())

    def test_rejects_a_symlinked_artifact(self):
        files = staged_release()

        def fetch(tag, name, dest):
            if name == "vmlinuz":
                Path(dest).symlink_to(self.dir / rp.SUMS)
            else:
                Path(dest).write_bytes(files[name])
        with self.assertRaises(rp.PublishError):
            rp.fetch_and_verify(TAG, self.dir, TAG_OBJECT, COMMIT, fetch)


class AnchorTests(unittest.TestCase):
    """C1: only the builder1-recorded provenance hash authenticates staging."""

    def forged(self):
        # Everything an attacker with R2 write access can produce: public fields,
        # an evil ISO, and SHA256SUMS and provenance that agree with it.
        return staged_release(iso=b"evil iso")

    def check(self, files, anchor):
        sums = rp.parse_sums(files[rp.SUMS])
        return rp.check_provenance(files[rp.PROVENANCE], sums, TAG, TAG_OBJECT, COMMIT,
                                   anchor)

    def test_forged_set_is_self_consistent_without_the_anchor(self):
        # Documents why the anchor is required: the forgery passes every other check.
        self.check(self.forged(), None)

    def test_forged_set_is_rejected_with_the_real_anchor(self):
        real_anchor = sha(staged_release()[rp.PROVENANCE])
        with self.assertRaises(rp.PublishError):
            self.check(self.forged(), real_anchor)

    def test_genuine_set_passes_with_its_anchor(self):
        files = staged_release()
        self.check(files, sha(files[rp.PROVENANCE]))

    def test_anchor_format(self):
        self.assertEqual(rp.check_anchor("A" * 64), "a" * 64)
        self.assertIsNone(rp.check_anchor(None))
        for bad in ("", "a" * 63, "g" * 64, "a" * 65, " " + "a" * 63):
            with self.assertRaises(rp.PublishError):
                rp.check_anchor(bad)


class ProvenanceHardeningTests(unittest.TestCase):
    def sums_for(self, files):
        files[rp.SUMS] = "".join(f"{sha(files[n])}  {n}\n"
                                 for n in sorted(files) if n != rp.SUMS).encode()
        return rp.parse_sums(files[rp.SUMS])

    def test_rejects_duplicate_keys(self):
        files = staged_release()
        files[rp.PROVENANCE] = files[rp.PROVENANCE].replace(
            b'{', b'{"tag": "v9.9.9", ', 1)
        with self.assertRaises(rp.PublishError):
            rp.check_provenance(files[rp.PROVENANCE], self.sums_for(files), TAG,
                                TAG_OBJECT, COMMIT)

    def test_rejects_missing_or_non_dict_builder(self):
        for builder in (None, "builder1", ["builder1"]):
            files = staged_release(builder=builder)
            with self.subTest(builder=builder), self.assertRaises(rp.PublishError):
                rp.check_provenance(files[rp.PROVENANCE], rp.parse_sums(files[rp.SUMS]),
                                    TAG, TAG_OBJECT, COMMIT)

    def test_rejects_oversize(self):
        files = staged_release()
        sums = rp.parse_sums(files[rp.SUMS])
        with self.assertRaises(rp.PublishError):
            rp.check_provenance(b" " * (rp.MAX_PROVENANCE_BYTES + 1), sums, TAG,
                                TAG_OBJECT, COMMIT)

    def test_accepts_builder_artifact_names_with_plus(self):
        sums = staged_release()[rp.SUMS] + f"{'0' * 64}  linux+extra.img\n".encode()
        self.assertIn("linux+extra.img", rp.parse_sums(sums))


def completed(stdout="", returncode=0):
    return subprocess.CompletedProcess([], returncode, stdout=stdout)


class LocalTagTests(unittest.TestCase):
    def fake(self, kind="tag", verify_out=f"[GNUPG:] VALIDSIG {rp.FPR} x\n", verify_rc=0,
             fetch_fails=False):
        def run(command, **kwargs):
            if "fetch" in command:
                if fetch_fails:
                    raise rp.PublishError("git fetch failed")
                return completed()
            if "cat-file" in command:
                return completed(kind + "\n")
            if "rev-parse" in command:
                return completed(("2" if "^{commit}" in command[-1] else "1") * 40 + "\n")
            raise AssertionError(command)
        verify = completed(verify_out, verify_rc)
        return patch.object(rp, "run", side_effect=run), \
            patch.object(rp.subprocess, "run", return_value=verify)

    def call(self, **kwargs):
        a, b = self.fake(**kwargs)
        with a, b:
            return rp.local_tag(TAG)

    def test_accepts_pinned_signature(self):
        self.assertEqual(self.call(), ("1" * 40, "2" * 40))

    def test_rejects_other_signer(self):
        with self.assertRaises(rp.PublishError):
            self.call(verify_out="[GNUPG:] VALIDSIG " + "A" * 40 + " x\n")

    def test_rejects_failed_verification(self):
        with self.assertRaises(rp.PublishError):
            self.call(verify_rc=1)

    def test_rejects_lightweight_tag(self):
        with self.assertRaises(rp.PublishError):
            self.call(kind="commit")

    def test_rejects_failed_fetch(self):
        with self.assertRaises(rp.PublishError):
            self.call(fetch_fails=True)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="blunix-publish-")
        self.dir = Path(self.temp.name) / TAG
        self.files = staged_release()
        self.sums, _ = rp.fetch_and_verify(TAG, self.dir, TAG_OBJECT, COMMIT,
                                           fetcher(self.files))
        (self.dir / rp.SIG).write_bytes(b"signature")
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    RELEASE_ID = 402714332

    def gh(self, assets=None, tag_objects=(TAG_OBJECT, TAG_OBJECT), view=None, release=None):
        """Behaves like GitHub: releases/tags/<tag> is 404 for a draft."""
        tag_answers = iter(tag_objects)

        def run(command, **kwargs):
            self.calls.append(command)
            if command[:2] == ["gh", "api"] and "/git/ref/tags/" in command[2]:
                return completed(json.dumps({"object": {"sha": next(tag_answers)}}))
            if command[:2] == ["gh", "api"] and "/releases/tags/" in command[2]:
                raise rp.PublishError("gh api failed (exit 1)")  # drafts are invisible here
            if command[:3] == ["gh", "release", "view"]:
                return completed(json.dumps(view if view is not None else
                                            {"databaseId": self.RELEASE_ID, "isDraft": True}))
            if command[:2] == ["gh", "api"] and command[2].endswith(f"/releases/{self.RELEASE_ID}"):
                uploaded = assets if assets is not None else [
                    {"name": p.name, "digest": "sha256:" + rp.sha256_file(p)}
                    for p in sorted(self.dir.iterdir())]
                body = release if release is not None else {
                    "tag_name": TAG, "draft": True, "assets": uploaded}
                return completed(json.dumps(body))
            if command[:3] == ["gh", "api", "-X"]:
                return completed()
            if command[:3] == ["gh", "release", "create"]:
                return completed()
            raise AssertionError(command)
        return patch.object(rp, "run", side_effect=run)

    def made_public(self):
        return any(c[:4] == ["gh", "api", "-X", "PATCH"] for c in self.calls)

    def test_undrafts_the_checked_release_by_id(self):
        with self.gh():
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        patch_call = next(c for c in self.calls if c[:4] == ["gh", "api", "-X", "PATCH"])
        self.assertEqual(patch_call[4], f"repos/{rp.REPO}/releases/{self.RELEASE_ID}")
        self.assertEqual(patch_call[5:], ["-F", "draft=false"])

    def test_missing_digest_stays_draft(self):
        no_digest = [{"name": p.name} for p in sorted(self.dir.iterdir())]
        with self.gh(assets=no_digest), self.assertRaises(rp.PublishError) as e:
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        self.assertIn("no sha256 digest", str(e.exception))
        self.assertFalse(self.made_public())

    def test_non_draft_or_other_release_stays_unpublished(self):
        for view, release in (({"databaseId": self.RELEASE_ID, "isDraft": False}, None),
                              (None, {"tag_name": "v9.9.9", "draft": True, "assets": []}),
                              (None, {"tag_name": TAG, "draft": False, "assets": []})):
            self.calls = []
            with self.subTest(view=view, release=release), \
                    self.gh(view=view, release=release), self.assertRaises(rp.PublishError):
                rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
            self.assertFalse(self.made_public())

    def test_publishes_after_digests_match(self):
        with self.gh():
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        create = next(c for c in self.calls if c[:3] == ["gh", "release", "create"])
        self.assertIn("--draft", create)
        self.assertIn("--prerelease", create)
        self.assertTrue(self.made_public())

    def test_digest_mismatch_stays_draft(self):
        bad = [{"name": p.name, "digest": "sha256:" + "0" * 64}
               for p in sorted(self.dir.iterdir())]
        with self.gh(assets=bad), self.assertRaises(rp.PublishError):
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        self.assertFalse(self.made_public())

    def test_missing_asset_stays_draft(self):
        partial = [{"name": rp.SUMS, "digest": "sha256:" + rp.sha256_file(self.dir / rp.SUMS)}]
        with self.gh(assets=partial), self.assertRaises(rp.PublishError):
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        self.assertFalse(self.made_public())

    def test_moved_tag_refuses_before_create(self):
        with self.gh(tag_objects=("9" * 40,)), self.assertRaises(rp.PublishError):
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        self.assertFalse(any(c[:3] == ["gh", "release", "create"] for c in self.calls))

    def test_tag_moved_during_upload_stays_draft(self):
        with self.gh(tag_objects=(TAG_OBJECT, "9" * 40)), self.assertRaises(rp.PublishError):
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        self.assertFalse(self.made_public())

    def test_file_changed_after_verify_refuses(self):
        (self.dir / "vmlinuz").write_bytes(b"swapped")
        with self.gh(), self.assertRaises(rp.PublishError):
            rp.publish(TAG, self.dir, self.sums, TAG_OBJECT)
        self.assertEqual(self.calls, [])


class MainTests(unittest.TestCase):
    def test_bad_tag_exits_nonzero_without_side_effects(self):
        self.assertEqual(rp.main(["v0.1.1;touch /tmp/x", "--dry-run"]), 1)

    def test_publish_requires_anchor(self):
        with patch.object(rp, "release_exists") as exists:
            self.assertEqual(rp.main([TAG]), 1)
        exists.assert_not_called()

    def test_existing_release_refuses_real_publish(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(rp, "release_exists", return_value=True), \
                patch.object(rp, "local_tag") as local:
            self.assertEqual(rp.main([TAG, "--provenance-sha256", "a" * 64,
                                      "--dir", str(Path(tmp) / "new")]), 1)
        local.assert_not_called()

    def test_existing_dir_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rp.main([TAG, "--dry-run", "--dir", tmp]), 1)

    def test_dry_run_never_signs_or_publishes(self):
        files = staged_release()
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(rp, "release_exists", return_value=False), \
                patch.object(rp, "local_tag", return_value=(TAG_OBJECT, COMMIT)), \
                patch.object(rp, "fetch_and_verify", side_effect=lambda *a, **k:
                             ORIGINAL_FETCH(*a, fetch=fetcher(files), **k)), \
                patch.object(rp, "sign_and_verify") as sign, \
                patch.object(rp, "publish") as publish:
            self.assertEqual(rp.main([TAG, "--dry-run", "--dir", str(Path(tmp) / "out")]), 0)
        sign.assert_not_called()
        publish.assert_not_called()


ORIGINAL_FETCH = rp.fetch_and_verify


if __name__ == "__main__":
    unittest.main()
