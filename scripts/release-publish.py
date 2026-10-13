#!/usr/bin/env python3
"""Publish a release that builder1 staged: fetch, verify, sign, publish. Laptop only.

    python3 scripts/release-publish.py v0.1.1-rc.3 --provenance-sha256 HEX [--dir DIR]
    python3 scripts/release-publish.py v0.1.1-rc.3 --dry-run [--provenance-sha256 HEX]

HEX is the provenance_sha256 builder1 recorded for the tag, read over the
vpscfgfarm door, not from R2:

    vpsexec builder1 'cat /var/lib/blunix-builder/built/v0.1.1-rc.3.json'

builder1 builds a signed tag and stages the files, unsigned, in R2
blunix-release-staging/<tag>/. This script does the rest in one pass:

  1. checks the tag, fetched from GitHub by URL: annotated, signed by the
     release key (full fingerprint), and notes its tag object and commit;
  2. fetches SHA256SUMS and build-provenance.json from staging (wrangler);
  3. checks the provenance hash against the one builder1 recorded (the only
     input that does not come from R2), then its fields against the tag:
     tag, tag object, commit, signer, repository and schema, and that its
     artifact list matches SHA256SUMS exactly;
  4. fetches every other listed file and checks its sha256;
  5. signs the builder's SHA256SUMS (release-sign.py sign; gpg asks for the
     passphrase), checks the signature is by the pinned key, and runs
     release-sign.py verify-release over the directory;
  6. checks the GitHub tag still points at the verified tag object, re-hashes
     every file, creates the release as a DRAFT (a prerelease for
     -alpha/-beta/-rc tags) with the staged RELEASE-NOTES.md, compares every
     uploaded asset's sha256 digest, checks the tag again, and only then
     makes the release public.

--dry-run stops after step 4: nothing is signed or published. It also runs
when the GitHub release already exists, so a published tag can be re-checked.
If a publish stops after the draft is created, inspect and delete the draft
(gh release delete TAG --repo afterdarksys/blunix) before running again.

Threats: anyone who can write the R2 staging bucket (a leaked token, the
Cloudflare account) staging a self-consistent forged release. Every field in
the staged files is public, so only the builder1-recorded provenance hash
authenticates them, and a real publish refuses without it. Also: a staged
file that differs from what the builder hashed; a provenance file for another
tag, commit or signer; a SHA256SUMS with extra, missing, duplicate or
path-traversing entries; a GitHub tag moved after the build; signing with a
key other than the pinned one; a partial or altered asset upload going
public; overwriting an existing release or a previous download; and running
anything through a shell. Not covered: a compromised builder1 (it records the
anchor hash; review the provenance), a compromised laptop or keyring, or
GitHub itself. The R2 credentials are wrangler's; this script never sees them.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

FPR = "62F736BEA2AB2E1FA16D5138BCB3426C090ADF92"
SIGNER = "openpgp:" + FPR
ALIAS = "blunix-releases"
REPO = "afterdarksys/blunix"
REPO_URL = "https://github.com/afterdarksys/blunix.git"
BUCKET = "blunix-release-staging"
SCHEMA = "blunix-build-provenance/1"
SUMS = "SHA256SUMS"
SIG = "SHA256SUMS.asc"
PROVENANCE = "build-provenance.json"
NOTES = "RELEASE-NOTES.md"
# Same pattern as the builder's TAG_RE and release-tag.sh.
TAG_RE = re.compile(r"v(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})"
                    r"(-(alpha|beta|rc)\.(0|[1-9][0-9]{0,3}))?")
# Same as the builder's ARTIFACT_RE.
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,127}")
HEX_RE = re.compile(r"[0-9a-f]{64}")
SUMS_LINE_RE = re.compile(r"([0-9a-f]{64})  (\S+)")
MAX_SUMS_BYTES = 64 * 1024
MAX_PROVENANCE_BYTES = 256 * 1024
ROOT = Path(__file__).resolve().parent.parent


class PublishError(Exception):
    pass


def check_tag_name(tag):
    if not TAG_RE.fullmatch(tag):
        raise PublishError(f"'{tag}' is not a release tag name the builder accepts")
    return tag


def is_prerelease(tag):
    return "-" in check_tag_name(tag)


def check_anchor(value):
    """The builder1-recorded provenance hash, or None for a dry run without one."""
    if value is None:
        return None
    value = value.lower()
    if not HEX_RE.fullmatch(value):
        raise PublishError("--provenance-sha256 must be 64 hex digits")
    return value


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def parse_sums(data):
    """{name: sha256} from the builder's SHA256SUMS; refuse anything unexpected."""
    if len(data) > MAX_SUMS_BYTES:
        raise PublishError("SHA256SUMS is too large")
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        raise PublishError("SHA256SUMS is not ASCII") from None
    if not text.endswith("\n"):
        raise PublishError("SHA256SUMS does not end with a newline")
    entries = {}
    for number, line in enumerate(text[:-1].split("\n"), 1):
        match = SUMS_LINE_RE.fullmatch(line)
        if not match:
            raise PublishError(f"SHA256SUMS line {number} is malformed")
        digest, name = match.groups()
        if not NAME_RE.fullmatch(name) or name in (SUMS, SIG):
            raise PublishError(f"SHA256SUMS line {number} names an unsafe file")
        if name in entries:
            raise PublishError(f"SHA256SUMS lists {name} twice")
        entries[name] = digest
    if PROVENANCE not in entries:
        raise PublishError(f"SHA256SUMS does not list {PROVENANCE}")
    if NOTES not in entries:
        raise PublishError(f"SHA256SUMS does not list {NOTES}")
    return entries


def _no_duplicate_keys(pairs):
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise PublishError("provenance has a duplicate key")
    return dict(pairs)


def check_provenance(data, sums, tag, tag_object, commit, anchor=None):
    """The provenance must be the one builder1 recorded, and describe this tag."""
    if len(data) > MAX_PROVENANCE_BYTES:
        raise PublishError("provenance is too large")
    digest = hashlib.sha256(data).hexdigest()
    if anchor is not None and digest != anchor:
        raise PublishError("provenance is not the one builder1 recorded for this tag; "
                           "the staging bucket may have been altered")
    if digest != sums[PROVENANCE]:
        raise PublishError("provenance does not match its SHA256SUMS entry")
    try:
        prov = json.loads(data, object_pairs_hook=_no_duplicate_keys)
    except ValueError:
        raise PublishError("provenance is not JSON") from None
    if not isinstance(prov, dict):
        raise PublishError("provenance is not an object")
    expected = {"schema": SCHEMA, "tag": tag, "tag_object": tag_object,
                "commit": commit, "signer": SIGNER, "repo_url": REPO_URL}
    for key, want in expected.items():
        if prov.get(key) != want:
            raise PublishError(f"provenance {key} is {prov.get(key)!r}, expected {want!r}")
    if not isinstance(prov.get("builder"), dict):
        raise PublishError("provenance has no builder record")
    artifacts = prov.get("artifacts")
    if not isinstance(artifacts, dict):
        raise PublishError("provenance has no artifact list")
    listed = {n: d for n, d in sums.items() if n != PROVENANCE}
    if artifacts != listed:
        missing = sorted(set(listed) - set(artifacts))
        extra = sorted(set(artifacts) - set(listed))
        raise PublishError(f"provenance artifacts differ from SHA256SUMS "
                           f"(only in SHA256SUMS: {missing}, only in provenance: {extra}, "
                           f"or a hash differs)")
    return prov


def run(command, **kwargs):
    """Run without a shell; a failure is an error, never a warning."""
    try:
        return subprocess.run(command, check=True, **kwargs)
    except FileNotFoundError:
        raise PublishError(f"{command[0]} is not installed") from None
    except subprocess.CalledProcessError as e:
        raise PublishError(f"{command[0]} {command[1] if len(command) > 1 else ''} "
                           f"failed (exit {e.returncode})") from None


def git(*args):
    return run(["git", "-C", str(ROOT)] + list(args), stdout=subprocess.PIPE,
               text=True).stdout.strip()


def local_tag(tag):
    """(tag_object, commit) for a tag signed by the pinned release key."""
    ref = f"refs/tags/{tag}"
    # By URL, not remote name; a different existing local tag makes git refuse.
    run(["git", "-C", str(ROOT), "fetch", "-q", "--no-tags", REPO_URL, f"{ref}:{ref}"])
    if git("cat-file", "-t", ref) != "tag":
        raise PublishError(f"{tag} is not an annotated tag")
    status = subprocess.run(["git", "-C", str(ROOT), "verify-tag", "--raw", ref],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if status.returncode != 0 or not re.search(rf"^\[GNUPG:\] VALIDSIG {FPR} ",
                                               status.stdout, re.M):
        raise PublishError(f"{tag} is not signed by {FPR}")
    return git("rev-parse", ref), git("rev-parse", f"{ref}^{{commit}}")


def wrangler_fetch(tag, name, dest):
    # cwd is the download directory, so no stray wrangler config picks the account.
    run(["wrangler", "r2", "object", "get", f"{BUCKET}/{tag}/{name}", "--remote",
         "--file", str(dest)], stdout=subprocess.DEVNULL, cwd=str(Path(dest).parent))


def fetch_and_verify(tag, directory, tag_object, commit, fetch=wrangler_fetch, anchor=None):
    """Fetch the staged release into a fresh directory and check every byte."""
    directory.mkdir(mode=0o700, parents=True)
    fetch(tag, SUMS, directory / SUMS)
    sums = parse_sums((directory / SUMS).read_bytes())
    fetch(tag, PROVENANCE, directory / PROVENANCE)
    prov = check_provenance((directory / PROVENANCE).read_bytes(), sums, tag,
                            tag_object, commit, anchor)
    for name in sorted(sums):
        path = directory / name
        if name != PROVENANCE:
            fetch(tag, name, path)
        if path.is_symlink() or not path.is_file():
            raise PublishError(f"{name} is not a regular file")
        if sha256_file(path) != sums[name]:
            path.unlink()
            raise PublishError(f"{name} does not match SHA256SUMS")
    return sums, prov


def release_exists(tag):
    result = subprocess.run(["gh", "release", "view", tag, "--repo", REPO, "--json", "tagName"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def gpg_tty_env():
    env = os.environ.copy()
    if not env.get("GPG_TTY") and sys.stdin.isatty():
        env["GPG_TTY"] = os.ttyname(sys.stdin.fileno())
    subprocess.run(["gpg-connect-agent", "updatestartuptty", "/bye"], env=env,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return env


def sign_and_verify(directory):
    sign = [sys.executable, str(ROOT / "scripts" / "release-sign.py")]
    run(sign + ["sign", ALIAS, str(directory / SUMS)], env=gpg_tty_env())
    # The alias registry picks the signing key; the release must be the pinned one.
    status = run(["gpg", "--status-fd", "1", "--verify", str(directory / SIG),
                  str(directory / SUMS)], stdout=subprocess.PIPE,
                 stderr=subprocess.DEVNULL, text=True).stdout
    if not re.search(rf"^\[GNUPG:\] VALIDSIG {FPR} ", status, re.M):
        raise PublishError(f"{SIG} is not signed by {FPR}; check the {ALIAS} alias")
    run(sign + ["verify-release", ALIAS, str(directory)])


def github_tag_object(tag):
    out = run(["gh", "api", f"repos/{REPO}/git/ref/tags/{tag}"], stdout=subprocess.PIPE,
              text=True).stdout
    try:
        return json.loads(out)["object"]["sha"]
    except (ValueError, KeyError, TypeError):
        raise PublishError(f"could not read the GitHub tag {tag}") from None


def require_github_tag(tag, tag_object):
    if github_tag_object(tag) != tag_object:
        raise PublishError(f"the GitHub tag {tag} no longer points at the verified tag object")


def draft_release_id(tag):
    # `gh release view` sees drafts; GitHub's releases/tags/<tag> endpoint does not.
    out = run(["gh", "release", "view", tag, "--repo", REPO, "--json", "databaseId,isDraft"],
              stdout=subprocess.PIPE, text=True).stdout
    try:
        info = json.loads(out)
        release_id, draft = info["databaseId"], info["isDraft"]
    except (ValueError, KeyError, TypeError):
        raise PublishError(f"could not read the {tag} release") from None
    if not isinstance(release_id, int) or draft is not True:
        raise PublishError(f"the {tag} release is not the draft this run created")
    return release_id


def release_assets(tag, release_id):
    """{name: "sha256:<hex>"} for the draft, read by id."""
    out = run(["gh", "api", f"repos/{REPO}/releases/{release_id}"], stdout=subprocess.PIPE,
              text=True).stdout
    try:
        release = json.loads(out)
        if release["tag_name"] != tag or release["draft"] is not True:
            raise PublishError(f"release {release_id} is not the {tag} draft")
        assets = {a["name"]: a.get("digest") for a in release["assets"]}
    except (ValueError, KeyError, TypeError):
        raise PublishError(f"could not read the {tag} release assets") from None
    missing = sorted(n for n, d in assets.items() if not d)
    if missing:
        raise PublishError(f"GitHub reported no sha256 digest for {missing}; cannot verify "
                           f"the upload, so the release stays a draft")
    return assets


def publish_files(directory, sums):
    """{path: "sha256:<hex>"} for every asset, re-hashed and checked against SUMS."""
    files = [directory / n for n in sorted(sums)] + [directory / SUMS, directory / SIG]
    wanted = {}
    for f in files:
        if f.is_symlink() or not f.is_file():
            raise PublishError(f"{f.name} is not a regular file")
        wanted[f] = "sha256:" + sha256_file(f)
    for name, digest in sums.items():
        if wanted[directory / name] != "sha256:" + digest:
            raise PublishError(f"{name} changed after it was verified")
    return wanted


def publish(tag, directory, sums, tag_object):
    """Draft first; go public only if every uploaded byte matches."""
    wanted = publish_files(directory, sums)
    require_github_tag(tag, tag_object)
    command = ["gh", "release", "create", tag, "--repo", REPO, "--verify-tag", "--draft",
               "--title", f"Blunix {tag}", "--notes-file", str(directory / NOTES)]
    if is_prerelease(tag):
        command.append("--prerelease")
    run(command + [str(f) for f in wanted])
    release_id = draft_release_id(tag)
    if release_assets(tag, release_id) != {f.name: d for f, d in wanted.items()}:
        raise PublishError(f"the draft's assets differ from the verified files; it stays "
                           f"a draft: inspect, then gh release delete {tag} --repo {REPO}")
    require_github_tag(tag, tag_object)
    # Un-draft the exact release that was checked, by id.
    run(["gh", "api", "-X", "PATCH", f"repos/{REPO}/releases/{release_id}",
         "-F", "draft=false"], stdout=subprocess.DEVNULL)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tag")
    ap.add_argument("--provenance-sha256", metavar="HEX",
                    help="provenance_sha256 from builder1's state for this tag "
                         "(required unless --dry-run)")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and verify only; sign and publish nothing")
    ap.add_argument("--dir", type=Path,
                    help="download directory; must not exist (default ~/blunix-releases/TAG)")
    args = ap.parse_args(argv)
    try:
        tag = check_tag_name(args.tag)
        anchor = check_anchor(args.provenance_sha256)
        if anchor is None and not args.dry_run:
            raise PublishError("--provenance-sha256 is required to publish; read it from "
                               f"builder1: vpsexec builder1 "
                               f"'cat /var/lib/blunix-builder/built/{tag}.json'")
        directory = (args.dir or Path.home() / "blunix-releases" / tag).expanduser()
        if directory.exists():
            raise PublishError(f"{directory} already exists; move it aside or pass --dir")
        exists = release_exists(tag)
        if exists and not args.dry_run:
            raise PublishError(f"the GitHub release {tag} already exists")
        tag_object, commit = local_tag(tag)
        print(f"release-publish: {tag} is signed by {FPR} (commit {commit[:12]})")
        sums, prov = fetch_and_verify(tag, directory, tag_object, commit, anchor=anchor)
        print(f"release-publish: {len(sums)} files verified in {directory}; "
              f"built {prov.get('started_at')} to {prov.get('finished_at')} by "
              f"{prov['builder'].get('hostname')}")
        if anchor is None:
            print("release-publish: provenance NOT checked against builder1 "
                  "(no --provenance-sha256)")
        if args.dry_run:
            print("release-publish: dry run; nothing signed or published"
                  + (" (the GitHub release already exists)" if exists else ""))
            return 0
        sign_and_verify(directory)
        publish(tag, directory, sums, tag_object)
        print(f"release-publish: published https://github.com/{REPO}/releases/tag/{tag}")
        return 0
    except (PublishError, OSError) as e:
        print(f"release-publish: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
