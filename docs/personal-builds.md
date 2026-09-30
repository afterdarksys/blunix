# Personal builds and community

## User journey

1. Visit `blunix.io`; continue to the portal and the configured OIDC provider to
   create an account or sign in. The provider must have self-service enrollment
   enabled; the Blunix callback creates an account on first successful login.
2. Reserve a build label, choose packages and access profile, set hostname/network,
   provide an administrator username and Ed25519 SSH public key, and select an
   exact target disk/serial. Explicitly authorize erasing that disk in the portal.
3. Publish. The browser generates a 100-bit build password, encrypts the complete
   Node document with age, and verifies the API's returned ciphertext digest.
   Download the install card and offline bundle before dismissing the password.
4. Boot current installer media. Wired DHCP supplies bootstrap networking. Enter
   the build address and build password. Installation uses the exact authorized
   target and configured reboot behavior, without further questions.
5. Connect by SSH as the configured administrator. This account has passwordless
   sudo; password SSH and root SSH login are disabled.

`blunix.io` and `build.blunix.io` are local symlinks into `blunix/site` and
`blunix/portal`. The unrelated sibling `blunix-not-open` Worker is a 404 placeholder;
its live routes must be checked during deployment. Do not delete it blindly.

## What a build contains

The personal artifact is the encrypted Node configuration plus the existing
version/digest metadata and downloadable offline bundle. The installer combines
that artifact with a digest-verified released OS image. It provisions packages
on the target using Debian apt; it is **not** a cloud service producing a separate
raw disk/ISO for every user. Images and installer media must be rebuilt to include
this Python implementation before these documents are issued to users.

The current supported disk is a mutable ext4 root expanded to its target disk.
The old `cloud-vm` model name remains for compatibility, but its planned A/B roots,
verity, and TPM encryption are not provisioned by this release path. The portal
no longer offers `metal-luks`; new unattended documents requesting it are refused
before any disk write. Disk-model rendering remains for legacy commands.

Package choices are allowlisted, not arbitrary shell or apt arguments. The image's
configured Debian repositories determine versions at installation time. Actual
versions are recorded in `/var/lib/blunix/packages.lock`; repeated installation is
not yet byte-for-byte reproducible. Snapshot repositories/version pins and offline
package artifacts are follow-up work. A provisioning failure does not produce a
bootstrap-complete marker, though the OS image may already have been written.

The build password is generated client-side and is never uploaded or recoverable.
Publishing a newer version changes the latest URL and generates a new password.
Keep each version's card; pinned `vN.label.blnx.io` addresses are shown only when
`PINNED_HOSTS_TLS=on` and certificates are available. The full build address is
accepted by the installer, with no credentials, port, query, fragment, or path.

## Node additions

```yaml
packages: [git, curl]
target: "disk-serial"
install:
  erase: true
  reboot: false
admin:
  name: "operator"
  sshPublicKey: "ssh-ed25519 <public-key-base64>"
```

`target` matches exactly one usable disk by kernel name or serial. A serial is
preferred; names such as `sda` can change with hardware order. Installation media,
mounted/in-use/read-only disks, insufficient space, ambiguity, and hot-swaps remain
refused. The erase authorization is encrypted with the personal document. Legacy
Node documents without `install` still require disk and reboot confirmations.

Offline package provisioning temporarily supplies DNS and a service-start blocker
inside the mounted image, restoring the previous files/symlinks on failure or
success. Commands use argv lists, never a shell. Administrator keys are Ed25519
public keys only. Private keys and passwords are not configuration fields.

## Configuration library API

All JSON writes require `application/json` and fit within the existing 8 KiB limit.
All mutations use the existing session, Origin, and CSRF checks. Host-scoped bearer
keys cannot read or mutate the template library.

| Method | Route | Behavior |
|---|---|---|
| GET | `/v1/configurations?offset=0` | Owner's live templates, 50 per page |
| POST | `/v1/configurations` | Create private template `{title, recipe}` or fork `{title, source: {id, revision}}` |
| GET | `/v1/configurations/{id}` | Owner detail and revisions |
| POST | `/v1/configurations/{id}/revisions` | Append `{revision: expectedHead, recipe, message}`; stale edits return 409 |
| POST | `/v1/configurations/{id}/publication` | Set `{visibility: "public" | "private"}` |
| DELETE | `/v1/configurations/{id}` | Soft-delete and remove from public/owner views |
| GET | `/v1/community?offset=0` | Public templates; no login needed |
| GET | `/v1/community/{id}` | Public template and revisions; no login needed |
| POST | `/v1/community/{id}/reports` | Session-only `{reason: "spam" | "abuse" | "unsafe"}` |

A recipe has exactly `packages` (unique supported names) and `access`. Unknown
fields, private machine configuration, arbitrary packages/scripts, and unsupported
profiles are refused. The portal constructs a fresh recipe object; it never sends
its personal document to these endpoints. Titles (100 characters) and revision
notes (240 characters) are free text and can contain personal information if a user
puts it there: publication explicitly warns about this. Server responses are
rendered as text, never HTML.

Limits: 100 live templates per account, 100 revisions per template, 30 create/revise
attempts per hour, 30 publication attempts per hour, 10 reports per hour. Quotas and
optimistic revision writes are enforced transactionally. Repeating the same
visibility does not bump the public feed. Lists return `nextOffset`; historical
revisions are immutable and fit in the 100-revision detail response.

Publication exposes all revisions. Forks copy the selected revision into a new
private template with source ID/revision provenance. Unpublishing/deleting the
source cannot recall existing forks. Public reads omit account IDs and personal
account attributes. Sharing UI asks permission for other members to use and adapt templates.

## Operations and rollout

1. Review and merge the branch. Reconcile the independent site/branding changes in
   the original checkout; this implementation was developed in an isolated worktree.
2. Configure D1 database ID, R2 bucket, OIDC issuer/client ID/secret, and the Authentik
   application's exact callback (`https://api.blunix.io/v1/auth/callback`). Enable
   self-service enrollment with verified email and appropriate abuse controls in
   the identity provider; test signup, callback, session expiry, and logout there.
3. Back up D1, then run the existing `scripts/deploy-api.sh` to test, apply migrations
   including `0003_configurations.sql`, and deploy. Verify Cloudflare routes and
   remove/replace conflicting placeholder routes only after the real API is ready.
4. Build and scan release images and installer media using the existing release
   scripts. Exercise BIOS and UEFI with throwaway disks and an actual build. Publish
   media only after that validation. Never publish the fixture/test image.
5. Deploy website and portal together after API migration and installer availability.
   Their existing deployment workflow runs on main, not this feature branch.
6. Verify community create/revise/share/fork/report as two distinct real accounts,
   then perform the two-input installation from the published release.

Reports are stored for maintainers; there is no automatic moderation or moderator
UI yet. Operators can inspect `community_reports` joined to `configurations` in D1,
then set `visibility='private'` or `deleted_at` after review. Assign an owner and a
response process before opening public enrollment. Do not use the public report
endpoint as an automatic takedown trigger.

Sponsorship is currently a community-page invitation to discuss support for build
infrastructure, release testing, documentation, and accessibility. No billing,
checkout, sponsor tiers, or promised benefits have been implemented.
