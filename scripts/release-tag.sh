#!/usr/bin/env bash
# Cut a signed release tag that the release build server will build. Laptop only.
#
#   scripts/release-tag.sh v0.1.1-rc.1
#
# The build server builds only annotated tags of afterdarksys/blunix signed by the
# pinned release key (keys/blunix-releases.asc). This script refuses unless:
# the name matches the builder's tag pattern, the tree is clean, main is the
# commit GitHub has (push main first), the tag does not exist here or on GitHub,
# and the release secret key is in this keyring. It signs with that key only
# (gpg asks for the passphrase), checks the signature against the pinned
# fingerprint, then pushes the tag and nothing else.
#
# Threats: a tag signed by the wrong key (the builder would reject it, but we
# refuse first), a tag on a commit GitHub does not have, an existing tag being
# moved, and pushing anything but the one tag.
set -euo pipefail

FPR=62F736BEA2AB2E1FA16D5138BCB3426C090ADF92
die() { echo "release-tag: $*" >&2; exit 1; }

[[ $# -eq 1 ]] || die "usage: scripts/release-tag.sh vMAJOR.MINOR.PATCH[-alpha|beta|rc.N]"
tag=$1
# Same pattern as the builder's TAG_RE.
[[ $tag =~ ^v(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})(-(alpha|beta|rc)\.(0|[1-9][0-9]{0,3}))?$ ]] ||
  die "'$tag' is not a release tag name the builder accepts"

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -z "$(git status --porcelain)" ]] || die "the working tree is not clean"
[[ "$(git branch --show-current)" == main ]] || die "check out main first"
git fetch -q origin main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] ||
  die "main is not what GitHub has; push main first (git push origin main)"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists here"
[[ -z "$(git ls-remote --tags origin "refs/tags/$tag")" ]] || die "tag $tag already exists on GitHub"
gpg --list-secret-keys "$FPR" >/dev/null 2>&1 || die "the release secret key is not in this keyring"

echo "release-tag: signing $tag on $(git rev-parse --short HEAD) with $FPR"
git -c gpg.format=openpgp tag -s -u "$FPR" -m "blunix $tag" "$tag"

# The signature must be from the pinned key, by full fingerprint.
status=$(git verify-tag --raw "$tag" 2>&1) || { git tag -d "$tag" >/dev/null; die "signature check failed"; }
grep -q "^\[GNUPG:\] VALIDSIG $FPR " <<<"$status" ||
  { git tag -d "$tag" >/dev/null; die "tag was not signed by $FPR"; }

git push origin "refs/tags/$tag"
echo "release-tag: pushed $tag. The build server polls every 10 minutes."
