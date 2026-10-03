# Release signing

Run `python3 scripts/release-sign.py --help`. Requires Python 3.9+ and GnuPG
2.2+ on Linux or macOS. This is a local signing tool; it does not publish
releases or enable installer signature enforcement.

## Create the Blunix key

Run in your own terminal so GPG can ask for a passphrase:

```sh
python3 scripts/release-sign.py create blunix-releases \
  --uid 'Blunix Release Signing <sign-releases@blunix.io>'
python3 scripts/release-sign.py export blunix-releases blunix-releases.asc
python3 scripts/release-sign.py list
```

Creation uses an Ed25519 certification/signing primary key with a two-year
expiry; override with `--expires`. Private keys and passphrases remain under
GPG's control. Back up the private key and GPG-generated revocation certificate
securely outside the repository. The tool never exports secret keys.

Aliases map to complete primary fingerprints in
`~/.config/blunix/signing-keys.json`. Protect this registry against unauthorized
changes. `--registry PATH` and `--homedir PATH` select alternative locations and
must precede the subcommand. To use an existing key, including a public-only key
for verification:

```sh
python3 scripts/release-sign.py register blunix-releases FULL_PRIMARY_FINGERPRINT
```

## Files and releases

```sh
python3 scripts/release-sign.py sign blunix-releases build/image.raw
python3 scripts/release-sign.py verify blunix-releases build/image.raw
python3 scripts/release-sign.py sign-release blunix-releases build/release \
  image.raw installer.iso
python3 scripts/release-sign.py verify-release blunix-releases build/release
```

File signatures default to `FILE.asc`; override with `--signature PATH`.
Release signing hashes the explicitly listed, flat filenames into `SHA256SUMS`
and signs it as `SHA256SUMS.asc`. Use a finished, quiescent release directory.
Verification checks the signature against the alias and checks every listed
artifact hash; unlisted files are not covered. Symlinks and path traversal are
rejected. Existing outputs are never overwritten. If interrupted between
publishing the manifest and signature, keep the artifacts and regenerate in a
fresh directory. Existing image builds that already produce `SHA256SUMS` can
use `sign blunix-releases build/release/SHA256SUMS` instead.

Distribute the public key and its fingerprint through a trusted channel;
downloading a key alongside a release does not establish trust by itself.

## Rotate and certify

```sh
python3 scripts/release-sign.py rotate blunix-releases \
  --uid 'Blunix Release Signing 2028 <sign-releases@blunix.io>'
python3 scripts/release-sign.py export blunix-releases blunix-releases-2028.asc
python3 scripts/release-sign.py register blunix-releases-2026 OLD_FULL_FINGERPRINT
python3 scripts/release-sign.py sign-key blunix-releases-2026 NEW_FULL_FINGERPRINT
```

Rotation creates a new key and switches the alias only after GPG succeeds.
Use a distinct UID for each generation to avoid GPG's duplicate-identity prompt.
Previous fingerprints remain in the registry, and old keys remain in GPG.
Register an old fingerprint under a separate alias to verify historical releases.
Rotation does **not** revoke old keys or automatically make clients trust the
replacement. Publish the new public key, update verifier trust, and retire or
revoke the old key as appropriate. If registry storage fails after creation,
recover the generated fingerprint from GPG and register it explicitly.

`sign-key` certifies an already-imported public key using the selected alias;
it is different from signing a key file's bytes. Verify the target fingerprint
independently before certifying it. Export the target key with GPG afterward
if you need to distribute the certification. The script uses GPG's standard
[key management commands](https://www.gnupg.org/documentation/manuals/gnupg/OpenPGP-Key-Management.html).

## Tests

```sh
python3 -m unittest discover -s tests -p test_release_sign.py
```

Tests generate unprotected, disposable keys in a temporary keyring; production
key creation uses GPG's normal passphrase prompt.
