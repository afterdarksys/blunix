# Design: blunixservice

Date: 2026-09-29
Status: DRAFT. Design only. No daemon, unit, API server, Terraform provider, or Ansible collection is in the tree, and none of them are on the booted disk.
Host design: `docs/designs/blunix-os.md`. This file is the management client that design's premise 7 allows. The site contract is the Service page in `~/development/blunix.io`, a separate directory.
Threats: a stolen account key, a stolen or replayed join token, a world-readable ciphertext on a guessable label, a daemon that rewrites `/etc` or runs a script from the document, a check-in or cloud user-data path that leaks the passphrase, TLS that does not verify, a floating GitHub fetch, a classroom reboot, a copied machine key. This design does not stop a malicious hypervisor, a physical attacker with the disk open and no TPM, or a publisher key that signs a bad image. That last one stays with the Blunix Log.

## The job

blunixservice runs on every Blunix machine. It is the client that joins the machine to `https://api.blunix.io/v1`, gives it a spoken hostname in the Blunix ecosystem, and carries upgrade, patch, and deployment as two artifacts the machine already understands: a Blunix Log image, and an age-encrypted node document.

Red Hat Network is the familiar shape. A host joins an account, reports what it is running, and takes errata from a console. The unit of change there was a package. The unit of change here is a signed image and a ciphertext. A CVE is a new log row. The errata view is which machines last reported the previous digest.

The daemon dials out. It does not listen on the network. Schools, NATs, and banks all look the same on the wire: one TLS client. The local control socket is a Unix socket. The laptop CLI, the website, Terraform, and Ansible are clients of the same API. There is no second control plane.

Boot does not wait for the API. The last document the machine successfully applied is the one it boots. A dead link leaves the console usable.

## What the daemon refuses

These are the rules, matching premise 7 and section 9 of the host design.

- It does not edit `/etc` by hand. Apply calls `blunix node apply` and systemd-sysupdate. Those programs exit. Hand edits still die on the next render.
- It does not run apt, dnf, ansible-pull, or a shell script from the document or the bundle.
- It does not poll GitHub, and it does not fetch `latest`. A tool arrives as a version and a digest already in the model, selected on the web, carried by the next document or the next image.
- It does not start speech, Orca, or a desktop. The access profile in the document does that, through the renderer that already exists.
- It does not install Debian packages the web named. The package set is the image. "Package selection" on the web is choosing models the image already ships.
- It does not send the passphrase, the account API key, or the join token after enroll. Logs store a SHA-256 fingerprint when a token must be named.

The spike still refuses a non-empty `sysexts` list (`refused sysexts`) and still accepts only the channel `stable`. The web offers those controls in the closed position until the schema changes. Orca stays the optional sysext from the host design, so a school can add it later without the cloud image growing a desktop.

## Two names

A profile and a machine are different names. One ciphertext shared by a classroom cannot also be one hostname. Today's node schema requires `hostname` and `_publish_hostname` writes `/etc/hostname`, so one document is one name. That is the pinned case, and it is the only case the spike can apply. The shared case is specified here and is not built.

| | Profile | Machine |
|---|---|---|
| Example | `ada` | `ada-1` |
| Where it appears | `https://ada.build.blunix.io/` | `/etc/hostname`, the inventory, the spoken name |
| Who shares it | Every machine enrolled on that profile | One machine |
| Secret | The age passphrase | The machine's Ed25519 key |

The profile label keeps the site's rule: one ASCII DNS label, a letter, then letters, digits, or hyphens, up to 32 characters, no punycode. Reserved names stay `www`, `api`, `updates`, `log`, `mail`. Lookalike labels are still not rejected.

The machine hostname uses the name rule `parse_node` already enforces (`_NAME` in `lib/blunix/schema.py`): a single label, a letter, then letters, digits, or hyphens. `ada-1` and `lab-3` match. A dotted bank name does not, and `/etc/hostname` stays the spoken label. The API may record a separate `dnsName` (`core-tx-04.bank.example`) as inventory. Publishing that FQDN as the hostname is an open question below.

Default allocation is `{profile}-{n}`, spoken, assigned by the API. Offline, the operator passes `--hostname lab-3`. A pinned document already contains its hostname, and the daemon does not ask a second time.

The older numbered installer host (`ada-1042.build.blunix.io`) was doing the job a machine key does. `require_build_host` in the schema still matches that numbered form. The site's installer URL is the label form. This design records the split and leaves the open question on the host design in place: whether the first-install URL itself should be numbered.

Hostname policy on the profile:

- `pinned`. The ciphertext names one hostname. This is what the current schema can apply.
- `assigned`. The document is shared. The daemon supplies the hostname from enrollment or from `--hostname`. One ciphertext does not pin one name. This needs a schema change: `require_name` rejects an empty hostname, and it does not know the token `assigned`. Until that lands, the web can publish only pinned documents.

## Enrollment

First boot still follows the install page. The person picks menu keys 1 through 5, the machine speaks if that entry speaks, then it asks for the build hostname and the passphrase. Echo stays off. Speech announces the prompt and does not speak the keystrokes. `--passphrase` stays refused.

The daemon generates an Ed25519 key on first start, from the OS CSPRNG, and stores it at `/var/lib/blunix/service/machine.key` mode `0600`. The implementation uses Debian's `python3-cryptography` for Ed25519. It does not implement the curve, and it does not pip-install one. TPM or LUKS sealing of that key is the existing metal disk plan. This design stores the key on `/var` until that sealing exists.

The public key is what the API binds. The account API key never sits on a fleet machine.

A join token is how a machine is allowed onto a profile.

- Prefix `blx_join_`. Drawn from the OS CSPRNG. Shown once. Stored as a SHA-256 hash, compared in constant time. High entropy, so it is hashed, not stretched with Argon2id. Argon2id remains the rule for any password a person memorizes. This platform still has no local account password.
- Single use, unless the mint sets a cap. Expiry is required. A missing expiry is refused. Proposal, still open: default 24 hours, maximum 7 days.
- Sent once, over TLS, on enroll. Discarded. Never written to the machine disk, never logged. A log line may carry the hash as a fingerprint.
- Rejected if presented as an account key. An account key is `blx_` and is not `blx_join_`. A join token presented to any other route is a 401.

After enroll, requests are signed by the machine key. Proof of possession is that signature. The signature covers the method, the path, a timestamp, and the SHA-256 of the body. The server allows a five-minute skew and refuses a repeated signature inside that window. Algorithm is Ed25519 only. `none` does not apply, because this is not a JWT. Human calls keep the existing JWT allowlist, and `none` stays rejected there.

`visibility` on a profile:

- `public`. Anonymous `GET /` on the label stays, for the spoken first install. The passphrase is the document secret. Ciphertext is world-readable on purpose.
- `enrolled`. Only a bound machine key can fetch the ciphertext. This is the default for a profile created for the service. Banks use this. A school that wants the spoken URL picks `public`.

Enrolled does not replace the passphrase. A stolen machine key can download ciphertext and still cannot decrypt it. The server never decrypts.

Fail closed, and apply nothing new, when any of these are true: TLS verification fails, the signature is bad, the body is oversized, a field is unknown, a field is named like key material, the plaintext is a shell script, the join token is expired, reused, or revoked, the hostname collides, or the document does not decrypt. The machine keeps the document it already applied.

Audit rows store the time, the machine-key fingerprint, the profile, the hostname, the document sha256, and the image digest. They do not store the passphrase, the key, the token, or the document.

## The daemon

Unit `blunixservice.service`, when an image eventually ships it:

```
[Service]
Type=notify
After=network-online.target
Wants=network-online.target
Restart=on-failure
```

It is not ordered before a boot target. A missing network or a missing API does not stall the console.

State under `/var/lib/blunix/service/`:

- `machine.key`, `machine.pub`, mode `0600` for the private key.
- `enrollment.json`: hostname, profile, key fingerprint, visibility. No token, no passphrase.
- `applied.json`: document sha256, image digest, access profile name.
- `queue/`: check-ins waiting for a link. The same fields as a check-in. No secrets.
- Socket `/run/blunix/service.sock`, mode `0660`, owner root. No TCP listener.

Language is the same Python as the existing `blunix` tools, until there is a reason to split. TLS is 1.3 minimum, certificate verification on, hostname checked. The banned patterns in the host tests stay banned: no `CERT_NONE`, no verification skip, no `shell=True`, no `os.system`.

Check-in is a small JSON body, cap 64KiB: key fingerprint, hostname, profile, applied document sha256, running image digest, staged image digest if any, access profile, time. It may carry one `lastSentence`, and that sentence has to be one of the Blind ready lines. An unknown sentence is refused. Jitter is required so a lab does not stampede. Backoff is required on failure. The interval numbers are an open question. The properties are not.

The response is the desired generation: document sha256, where to fetch the ciphertext, channel, image digest, maintenance window, and the hostname when policy is `assigned`. It may also name one troubleshoot job for this hostname. The job is a collect, specified in `docs/designs/blunix-platform.md`. A job for another hostname is ignored. The machine does not poll a second host. The server still cannot read the document.

Apply, inside the window:

1. Fetch the ciphertext with the machine signature when the profile is `enrolled`, or by the anonymous label GET when it is `public`. Cap 256KiB.
2. Decrypt with the local credential. The passphrase is a systemd credential named `blunix.build-passphrase`. It is never an argument, never a log field, never uploaded.
3. Run `blunix node apply`. On failure, keep the previous document.
4. Stage the image with systemd-sysupdate. The previous slot still boots.
5. Reboot only under the window rules below.

A speech or large-print profile refuses `reboot: allow`. The console asks with the reboot sentence in Blind ready, and waits. A quiet cloud profile may set `reboot: allow`, and then only after time is synchronized, and only inside the window. Unsynchronized time does not reboot. A document apply is windowed too, because a network change can drop the room. On speech and large print, that apply also waits for the yes in Blind ready. The first install is the exception: the operator is there, and the hostname yes is the apply.

```yaml
window:
  days: [sat, sun]
  start: "01:00"
  end: "05:00"
  timezone: UTC
  reboot: ask
```

`ask` is the default.

`blunix-cloud` stays the oneshot from the host design. It reads instance metadata and exits. cloud-init stays uninstalled. On a later image it may place a join token from user-data into a credential, and it may request a hostname. It does not apply the document, and it does not stay running. User-data may carry the join token. User-data must not carry the passphrase. The metadata service is readable by anything on the instance, and cloud consoles show user-data. A headless node enrolls for a hostname and waits to apply until the passphrase credential exists. Absent that credential, the machine runs the image defaults.

## Upgrade, patch, deploy

Upgrade and patch are the same event. A publisher appends a Blunix Log row. The sysupdate manifest is generated from that log. The daemon stages that image at the window. Withdrawing a row drops it from the manifest a new boot will follow. The errata call is `GET /v1/machines?channel=stable&behind=1`, which lists machines whose reported digest is not the channel head. The filter is an allowlist of fields. It is not a query language.

Deploy is a new document generation. The web, the laptop, or Terraform composes a node document the schema already accepts: disk model, network model, access profile, AI pin, update URL, channel. Optional tools are selectable when they have a digest. A tool waiting on a digest is shown and cannot be selected. The browser encrypts with age's passphrase mode and uploads ciphertext. Republishing changes the generation enrolled machines take at the next window. It still changes the next spoken install of a public label. Deleting a label still stops serving. Machines that already applied a document keep it.

The Debian package set changes only by a new image. Selecting packages on the web means selecting models, a channel, and signed sysexts or tools the image already knows how to refuse or accept.

## Offline, and the CLI on a laptop

The `blunix` CLI installs on the operator's computer. That computer is not a Blunix image. The CLI talks to the API when a link exists, and it writes a bundle when it does not.

`blunix service export lab.json` writes a bundle. The passphrase is not a field. An account key is not a field. Export from a machine exports the ciphertext it already holds, plus metadata.

```json
{
  "apiVersion": "blunix.io/v1",
  "kind": "ServiceBundle",
  "profile": "lab-west",
  "visibility": "enrolled",
  "hostnamePolicy": "assigned",
  "channel": "stable",
  "imageDigest": "sha256:example",
  "access": "console-speech",
  "document": {
    "encoding": "age",
    "sha256": "example",
    "body": "age-ciphertext"
  }
}
```

Unknown fields, duplicate keys, and key-material field names fail closed. The ciphertext member stays at 256KiB. The bundle file cap is 288KiB. YAML aliases do not arise, because the bundle is JSON. A decoder that keeps the last duplicate key is a bug.

`blunix service import lab.json --hostname lab-3` runs on the machine. The hostname is spoken back, and the machine waits for yes. Decrypt is a console prompt, echo off. `--passphrase` is refused. A join token, if the machine still needs one, is `--join-token-file` pointing at a mode `0600` file, or the same echo-off prompt. The token is used once and the file is removed. Speech does not speak the token.

The operator can carry that JSON on a USB stick. One laptop enrolls a lab. When a link returns, `blunix service checkin` sends the queued report and binds the machine. Until then the machine is configured and the API does not know it.

Local CLI sentences are whole sentences, listed in Blind ready. Status is a sentence a screen reader can read, and JSON on stdout for a program. Color is not the status. Secrets are not echoed.

## Blind ready

Speech and large print are blind-ready when the console can be finished without seeing it. The web pages are blind-ready when a screen reader can prepare the USB stick. The daemon does not start the synthesizer. The access profile does.

The menu beeps. It does not speak. Key 1 is full speech. Key 2 is console speech. Both already start BRLTTY, so the same line goes to a braille display. Three beeps mean speech was requested and did not start. Boot continues.

Every prompt and every result is one sentence. There is no spinner, no progress bar, and no ANSI color. The answer words are `yes` and `no`. Silence, or any other answer, is no. The machine repeats the question once. Then it keeps the applied document and says so. It does not reboot, and it does not apply.

The passphrase prompt is announced. Echo is off. Keystrokes are not spoken. The passphrase, the join token, and the account key never appear in a spoken line, a braille line, or a large-print line. Large print does not speak. It shows the same sentence in the 32-cell font.

`lab-3`, `lab-west`, and `0.1.1` below are examples. `0.1.1` is the example row on the log page.

| When | Sentence |
|---|---|
| Hostname | `blunix: hostname lab-3. Say yes to keep it.` |
| Passphrase | `blunix: passphrase. Type it. It will not be spoken.` |
| Enrolled | `blunix: enrolled as lab-3 on profile lab-west.` |
| Token consumed | `blunix: join token discarded.` |
| API down | `blunix: api unreachable. Keeping the applied document.` |
| New document | `blunix: new document for profile lab-west. Say yes to apply.` |
| Reboot | `blunix: image 0.1.1 is staged. Say yes to reboot.` |
| Decrypt failed, first install | `blunix: could not decrypt. Nothing applied.` |
| Decrypt failed, later | `blunix: could not decrypt. Keeping the applied document.` |
| Document refused | `blunix: document refused. Keeping the applied document.` |
| Answer was not yes | `blunix: keeping the applied document.` |
| Troubleshoot asked | `blunix: troubleshoot requested for lab-3. Say yes to start.` |
| Troubleshoot finished | `blunix: troubleshoot finished. Sent the report.` |
| Troubleshoot refused | `blunix: troubleshoot refused.` |
| Troubleshoot expired | `blunix: troubleshoot expired.` |

A troubleshoot uses the same yes and no rule. Silence does not collect. The spoken result is `blunix: troubleshoot refused.` The collect itself is `docs/designs/blunix-platform.md`.

The site is the screen-reader path for the person preparing the bundle. Each page has a skip link, and the main target can take focus so the reader lands there. One `h1`, headings in order, a caption and header cells on every table, and a 3px focus outline in the eye color on the controls. Commands are text. No page submits a passphrase.

## The web

The account page is where a person composes the document. The service page is the contract for machines that come back later. The web console is for the teacher or the fleet operator. It keeps the site's rules: skip link, Atkinson Hyperlegible, contrast at least 7:1, tables with captions, no color-only state, no form that submits a passphrase. The passphrase stays in the browser that encrypts.

The service is not running. The pages say so.

## API

Same host the API page already assumes: `https://api.blunix.io/v1`. Nothing is listening. Bodies that fail the check are refused with a fixed error. The server does not echo the upload and does not decrypt.

Existing label, key, and log routes stay. Additions:

| Call | Who | Result |
|---|---|---|
| `PUT /v1/hosts/{label}` | account, `hosts:write` | Set `visibility` to `public` or `enrolled`. |
| `POST /v1/hosts/{label}/join-tokens` | account, `hosts:write` | Mint a `blx_join_` token. The response is the only time it appears. |
| `DELETE /v1/join-tokens/{fingerprint}` | account, `hosts:write` | Revoke that hash. Immediate. |
| `POST /v1/machines` | join token, once | Bind an Ed25519 public key to a hostname and a profile. Consume the token. |
| `POST /v1/machines/{hostname}/checkin` | machine signature | Report digests. Return the desired generation. |
| `GET /v1/machines/{hostname}/desired` | machine signature | The same generation, for a machine that woke up. |
| `GET /v1/machines` | account, `machines:read` or `hosts:write` | Inventory. Fingerprints and digests. No secrets. |
| `GET /v1/machines?channel=stable&behind=1` | account, same scope | Machines not on the channel head. |

`hosts:write` and `log:read` remain the default key. `log:publish` remains the image build. `machines:read` is a narrower key for a board that must not publish ciphertext. `troubleshoot:request` and `troubleshoot:read` are not on the default key. The five collect routes are in `docs/designs/blunix-platform.md`. This table does not repeat them. A machine signature is not an API key and has no scope list.

SQL, when a server exists, is parameterized. A string-built query is a defect. Size limits and timeouts apply to every body.

## Terraform and Ansible

The provider is named `blunix`. The Ansible collection calls the same routes. The connection is HTTPS. SSH is not the transport.

The provider encrypts on the operator's machine, with age, and stores the ciphertext sha256 in state. State is the drift signal. State does not store the API key, the passphrase, or the join token. The join token is write-only: the response fingerprint is what state keeps, and a refresh cannot read the token back. The API key comes from the environment (`BLUNIX_API_KEY`) and is not a committed variable. The passphrase is a file mode `0600` (`BLUNIX_PASSPHRASE_FILE`). A passphrase argument, a passphrase variable, and a passphrase in user-data are refused, because plans, state, and process lists keep them.

Ansible's inventory plugin may list machines so a human can open a break-glass shell. Collection playbooks do not mutate hosts over SSH, and they do not run apt.

The providers are not written in this pass.

## Four policies, one plane

The daemon is the same binary. The profile picks the policy.

| Place | Policy |
|---|---|
| Blind school | The Blind ready sentences. Short spoken hostnames. USB bundle from one laptop. Key 1 or key 2. Orca remains a sysext the cloud image does not install. Public label if the class needs a URL they can say, enrolled if they do not. |
| A link that drops | Small check-in. Resumable image via the A/B slot. Boot stays on the last good document. One laptop enrolls the lab offline. Jitter and backoff. The API being down is a normal state. |
| IT shop | One account, many profiles. Terraform stamps pinned documents. v1 has no billing and no multi-tenant orgs. |
| Bank | `enrolled` fetch. Expiring join tokens. Machine keys. Audit of digests and fingerprints. Maintenance window. Immutable image. Their DNS name recorded beside the spoken hostname. Quiet access profile. |

## Negative tests the implementation owes

Not written now. A security-domain implementation without these is unfinished.

- A tampered machine signature applies nothing.
- An expired, reused, revoked, or cap-exhausted join token enrolls nothing.
- An oversized check-in, ciphertext, or bundle is refused.
- An unknown field, a duplicate JSON key, a shell script, and a key-material field name are refused.
- A TLS verification failure applies nothing and does not fall back to cleartext.
- A missing API does not block boot. The applied document stays.
- The passphrase, the account key, and the join token do not appear in a request log, a journal line, or an audit row. A test searches those sinks.
- An enrolled profile returns no ciphertext to an anonymous GET. A public profile still serves the anonymous GET.
- A speech or large-print profile with `reboot: allow` is refused.
- Silence, or any answer other than yes, does not reboot and does not apply. The spoken result is `blunix: keeping the applied document.`
- A speech or large-print profile does not collect on silence. The spoken result is `blunix: troubleshoot refused.`
- Collect, mirror, and publisher refusals are listed in `docs/designs/blunix-platform.md`.
- A captured spoken line, braille line, or large-print line contains none of the passphrase, the join token, or the account key.
- Unsynchronized time with `reboot: allow` does not reboot.
- The daemon does not invoke apt, does not open a GitHub URL, and does not write a unit except through the existing renderers.
- `--passphrase` is refused. A passphrase field in the bundle or in cloud user-data is refused.
- A `blx_join_` token presented as an account key is a 401. An account key presented to enroll is a 401.

## Open questions

- Who signs node documents, and where the public key lives in the UKI. Until that exists, the machine key proves the machine and the passphrase proves the document. A hostile portal plus a stolen passphrase could still aim `update.url`. The signature question on the host design stays open.
- Who issues the certificate for `api.blunix.io` and `*.build.blunix.io`, and whether the UKI pins it.
- The numbered installer URL versus the label URL. This file recommends the label as the profile and `{profile}-{n}` as the machine. The host design's question stays open.
- How `hostnamePolicy: assigned` overlays the required `hostname` field. Recommendation: the shared document carries `hostname: assigned`, the parser accepts that token only together with the policy, and the daemon writes the enrolled name. Not built. The spike still requires a concrete hostname.
- Whether `/etc/hostname` ever becomes the bank's `dnsName`. Recommendation for v1: the spoken ecosystem label is the hostname. `dnsName` is inventory.
- Check-in interval. Proposal: 15 minutes plus up to 3 minutes of jitter, backoff to 6 hours. Immediate on `blunix service checkin`.
- Join-token lifetime. Proposal: default 24 hours, maximum 7 days, cap default 1.
- The window clock on a machine with a dead RTC. `ask` does not need it. `allow` waits for synchronized time. Confirm that is enough for a site with no NTP.
- Hostname uniqueness across accounts. v1 is one account. Cross-account names wait.
- Whether Terraform's write-only attribute is the mechanism, or a local mode `0600` file outside state. The requirement is fixed either way: state holds the fingerprint.
- v1's job for the host image (container host, Kubernetes node, or CI runner) is still the host design's question. This service does not pick it.
- Lookalike labels remain unrejected.
- Collect retention, job lifetime, and the quiet-profile default are open in `docs/designs/blunix-platform.md`.

## Not in this pass

No unit file in the image. No package added to `image/packages.txt`. No provider. No server. No change to the booted disk. The next image build is what would carry the unit, after the negative tests exist. The cloud build, the deploy, and the collect are `docs/designs/blunix-platform.md`. No builder, no collector, and no ticket queue in this pass.
