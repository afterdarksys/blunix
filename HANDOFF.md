# Blunix handoff

## Branch and working copy

- Branch: `feat/personal-builds-community`
- Repository: `https://github.com/afterdarksys/blunix`
- Implementation worktree: `/Users/ryan/development/.worktrees/blunix-personal-builds`
- Original checkout: `/Users/ryan/development/blunix`, on `main`. Independent website, branding, and licensing work
  was committed there during implementation; the feature branch was rebased onto `de8d94a`, preserving
  the updated branding and licensing changes.
- No production deployment, production migration, release upload, or merge was
  performed as part of this work.

## Product flow delivered

The portal lets a signed-in user reserve a personal build hostname, choose supported
Debian packages, configure hostname/network/accessibility, provide an Ed25519 SSH
administrator key, choose an exact target disk/serial, approve erasing it, and select
reboot behavior. Publishing generates an age-encrypted personal configuration,
build address, one-time build password, install card, and downloadable bundle.

The updated installer obtains wired DHCP and asks for **build address** and
**build password**. New portal-generated configurations carry all other decisions.
The installer retains boot-media, mounted-disk, size, digest, and disk-change checks;
missing or ambiguous targets stop rather than guess. Package installation and SSH
administrator creation run noninteractively before installation is marked complete.

The community library supports private saved templates, immutable revisions,
explicit public sharing, exact-revision forks with provenance, unpublishing,
deletion, pagination, and abuse reports. Templates contain only package choices and
access profile. Personal machine settings and build passwords are excluded.
Public titles/notes are user-authored text and must not contain secrets.

A new community landing page explains sharing and contribution, with sponsorship
framed as a future conversation rather than a live billing product.

## Principal changes

| Area | Files |
|---|---|
| Personal schema/provisioning | `lib/blunix/personal.py`, `node.py`, `schema.py`, `installer.py`, `bootstrap.py` |
| Community storage/API | `platform/api/migrations/0003_configurations.sql`, `src/configurations.ts`, `src/index.ts` |
| Portal composer/library | `portal/index.html`, `lib.js`, `portal.js`, `portal.css` |
| Website/community | `site/community.html`, `site/index.html`, `site/install.html` |
| Tests/CI | `tests/test_personal.py`, updated installer tests, `tests/site/composer.test.mjs`, `tests/portal-browser.mjs`, `platform/api/test/configurations.test.ts`, `.github/workflows/verify.yml` |
| Real provisioning validation | `image/test-personal-provision.sh`; updated QEMU serial driver in `image/installer/drive-serial.py` |
| Contract and rollout | `docs/personal-builds.md`, updated component READMEs |

Read `docs/personal-builds.md` for endpoint bodies, limits, data-sharing semantics,
installation contract, and ordered rollout instructions.

## Validation

- API: **109 tests passed**, plus TypeScript checking. Covers owner isolation,
  CSRF, session-only template operations, public/private visibility, exact revision
  forks, concurrent revision conflicts, atomic quota enforcement, publication
  rate limits, reports, and the existing OIDC/host/build/key suites.
- Linux: **231 tests passed** in Debian 13 with real `age`, zstd, and filesystem
  tools; no skipped tests in that run. Includes the two-input flow, pre-write
  refusals, provisioning failure, and original release scanners/proxy tests. The
  four source-manifest tests added on main also passed separately after integration.
- Website/composer: **18 tests passed**, including browser-generated YAML checked
  by the actual Python schema and exclusion of personal data from shared recipes.
- Headless Chromium: reserve → configure → save → share → fork → revise → publish;
  decrypted the actual browser-produced age artifact and checked its personal
  fields. Also checked mobile overflow, page errors, and password clearing.
  Uses an in-memory API fixture; not a production OIDC or Cloudflare smoke test.
- Real Debian chroot provisioning: **passed**. Installed git/curl/nginx plus
  administrator prerequisites; checked ownership/modes, `visudo -cf`, `sshd -t`,
  effective SSH policy, service enablement, package manifest, and DNS/policy restore.
  This caught and fixed an existing Debian group collision in administrator creation.

Reproduce:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
(cd platform/api && npm ci && npm run typecheck && npm test)
image/run-unit-tests.sh
image/test-personal-provision.sh
```

Requires Node 22+, Python 3 with PyYAML, and Docker. For a locally installed
Chromium, set `CHROMIUM_PATH`. Test secrets are generated only in ignored `build/`.
CI runs verification on PRs and feature-branch pushes; deployment remains main-only.

## Deployment prerequisites and review boundaries

1. **Identity/storage:** the checked-in Worker still has a placeholder D1 ID and
   empty OIDC issuer/client settings. Configure the real D1/R2/Authentik resources
   and secret, enable provider signup/enrollment, and verify the callback. No
   bypass login or fake production account was added.
2. **Migration:** apply `0003_configurations.sql` before releasing the portal.
   Existing `scripts/deploy-api.sh` runs checks, migrations, and deployment.
3. **Installer release:** build, scan, and publish updated release images/media.
   Old installers reject the new fields. Test real BIOS and UEFI boots with
   disposable disks before release. This branch has not produced a new ISO or
   performed an end-to-end VM installation of published media.
4. **Cloudflare routing:** check whether the separate `blunix-not-open` placeholder
   still occupies API routes. Replace conflicting routes as part of deployment,
   not by deleting that local folder. Check build-host TLS and version-host TLS.
5. **Moderation:** reports are persisted in D1; assign a maintainer process to
   inspect them and unpublish/remove abusive templates. No moderator UI or
   automatic takedown is included. Public sharing uses an explicit permission-to-share prompt.
6. **Merge sequencing:** merging main can trigger the existing Pages deployment.
   Coordinate the API migration and installer-media availability first.

## Important scope distinctions

- A personal build artifact is an encrypted configuration. The installer combines
  it with the shared released base image and installs the selected packages. A
  cloud queue producing a distinct ISO/raw disk for each user is **not** implemented.
- Package versions resolve from Debian repositories at install time and are then
  recorded in `/var/lib/blunix/packages.lock`. Reproducible snapshot pins and
  offline package delivery are not implemented.
- The supported image is a mutable ext4 root. Planned A/B verity and TPM/LUKS
  layouts are not claimed as working; the portal only offers the supported layout.
- Legacy documents without the new installation policy retain disk/reboot
  confirmations. New portal builds follow the two-question path.
- Administrator access is SSH public-key login with passwordless sudo. Local
  password creation, arbitrary package repositories/scripts, and graphical desktop
  package profiles are outside this iteration.
- Sharing is for reusable package/access templates, not private machine documents.
  Forks remain with their owners after the source is unpublished or deleted.
- Community comments/profiles/follows, automated moderation, sponsor billing, and
  community subscription plans remain future work. Commercial code licensing is
  covered separately by the existing `COMMERCIAL.md`. The landing page does not claim those exist.

## Suggested next review

Review the encrypted erase policy and exact target selection first, then the
configuration revision/visibility rules and deployment sequencing. After merging,
prioritize a real signup-to-VM-install acceptance run and a release pipeline for
current media before inviting community users.
