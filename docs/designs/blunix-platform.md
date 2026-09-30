> Implementation update (2026-09-30): the personal-build/community implementation
> described in `docs/personal-builds.md` supersedes the earlier exclusion of
> selectable packages. It uses the released base image plus an encrypted personal
> configuration. It does not yet provide a server-side custom-image build farm.

# Design: the blunix.io platform

Date: 2026-09-29
Status: DRAFT. Design only. No builder, no API server, no troubleshoot collector, and no support queue is in the tree or on the booted disk.
Host design: `docs/designs/blunix-os.md`. Machine client: `docs/designs/blunix-service.md`. The site contract is the Platform page in `~/development/blunix.io`, a separate directory.
Threats: a cloud job that opens a shell on a machine, a free-text command treated as code, a customer script running on the image builder, a mirror that serves bytes other than the published digest, a troubleshoot report that contains a passphrase or a key, a support key that can read ciphertext, a regional fork of a node document, a classroom collect or reboot that starts because nobody answered, a ticket that stores a secret. This design does not stop a malicious hypervisor, a person who already has the root shell, or a publisher key that signs a bad image.

## The job

blunix.io is the platform. It builds one Blunix image in the cloud, deploys that image and a node document onto machines anywhere, and can ask a machine to collect a report. Companies buy a support scope on the same API. The website is that console. It is specified and not open.

A system is a profile with machines enrolled on it. The profile holds the age ciphertext. The machines hold the spoken hostnames. Deploy is enroll, then apply, then the image from the log. There is no second desired state that can disagree with the document.

The machine still dials out. The platform does not SSH to it, does not open an inbound port on it, and does not place an agent beside blunixservice. Troubleshoot, support, Terraform, and Ansible are clients of `https://api.blunix.io/v1`. Nothing is listening.

## Build

The cloud builder runs the image build the repository already specifies. Official Debian packages. Pinned tools with digests. The output is one Blunix Log row: version, digest, predecessor, channel, and a list of https mirrors.

`log:publish` is the only scope that can append that row. An ordinary account key, a support key, and a machine signature are refused. The publisher route accepts the row. It does not accept a script, a Dockerfile, or a git URL from the account. A customer system is a node document on top of the one image, not a private image fork.

A mirror is a cache. The machine downloads from a mirror on the row and checks the digest. A mismatch, a TLS failure, or an oversized body is refused, and the machine does not try the next mirror in cleartext. Regions do not carry their own configuration. A machine in a bank and a machine in a school install the same bytes for that digest.

## Deploy

On the web, a person composes the node document the schema already accepts: disk model, network model, access profile, channel, and tools that already have a digest. The browser encrypts with age. The upload is ciphertext. The passphrase stays in that browser.

Deploy then means:

1. Register the profile label, or reuse one.
2. Set visibility. Public for a spoken first install. Enrolled for every machine that comes back later. New service profiles default to enrolled.
3. Mint a join token, or assign the spoken hostname.
4. The machine, wherever it has a route out, enrolls and applies at its window. A site with no route uses the JSON bundle on a USB stick. The sentences are the Blind ready list in the service design.

A headless node in a cloud still uses `blunix-cloud` only to place a join token from instance user-data into a credential, then exit. The passphrase does not travel in user-data. Until blunixservice is in the image, that oneshot remains the cloud path the host design already describes.

Global, in this design, means the machine can sit behind a NAT, in a school, or in a bank, and the deploy is the same dial-out. It does not mean a different node document per region. One API origin. Image mirrors are caches of one digest.

## Troubleshoot

A troubleshoot is a collect. The cloud requests it. The machine runs a fixed collector that shipped in the image. v1 scope is `collect`. A job whose scope is `shell`, and a job that contains a command field, are refused. The platform cannot mint a root key, open a reverse shell, or tell the machine to run apt.

Who may request: an account key or a support key with `troubleshoot:request`. `machines:read` cannot. `hosts:write` cannot, unless the key also has the troubleshoot scope. Image and Fleet packages do not include it. Support and Desk do.

The job id comes from the OS CSPRNG. The body is: hostname, reason, expiry. Reason is an allowlist: `behind`, `decrypt`, `network`, `speech`, `other`. The `other` text is at most 200 characters, is stored for the ticket, and is never executed. Proposal: default expiry 2 hours, maximum 24 hours. The numbers are open. An expired job is closed.

The job rides back on the check-in response, the same desired generation the service design already returns. The machine does not poll a second host. The request is signed by the API the way the generation is authenticated for that machine. A job for a different hostname is ignored.

Speech and large print ask, and they read the question:

`blunix: troubleshoot requested for lab-3. Say yes to start.`

Silence, or any answer other than yes, does not collect. The machine says `blunix: troubleshoot refused.` The applied document stays. A quiet profile may set `troubleshoot: allow` for `collect` only, only inside the maintenance window, and only after time is synchronized. The default is ask. Unsynchronized time does not start a collect.

The collector takes no command string. It does not read the passphrase credential, the machine private key, the join token, or key files. It does not upload journal text. The report is an allowlist, cap 64KiB:

- hostname, profile, key fingerprint
- running image digest, staged digest if any
- document sha256, access profile name
- whether time is synchronized
- inet lines in the shape the host already speaks
- names of failed units, not their logs
- the last Blind ready sentence, if the machine has one
- free bytes on the data filesystem

Unknown fields, duplicate keys, and key-material field names fail closed. The machine signs the upload. One result closes the job. A late result, a result for a cancelled job, and a result signed by a different machine are refused.

`GET` of the report requires `troubleshoot:read`. The report is not on the public log and not on an anonymous URL. Audit stores the requester fingerprint, the hostname, the job id, the reason, the result sha256, and the time. The audit line does not store the report body, the passphrase, the account key, or the join token.

When the collect finishes the machine says `blunix: troubleshoot finished. Sent the report.` If the job expires first it says `blunix: troubleshoot expired.`

A person who still needs a shell uses the break-glass SSH the host already keeps. The ticket can show the spoken hostname and the inventory `dnsName`. The platform does not connect that shell.

## Support

Support is a scope, sold later as a package. v1 has no billing and no multi-tenant orgs. Nothing here is for sale until a machine can check in and a key can be revoked.

| Package | Scopes | What a person gets |
|---|---|---|
| Image | the public log | The channel. No view of their machines. |
| Fleet | `hosts:write`, `machines:read`, `log:read` | Many profiles on one account. Errata is who is behind. No troubleshoot. |
| Support | Fleet, plus `troubleshoot:request` and `troubleshoot:read` | Inventory, a collect, and a ticket. No ciphertext. No passphrase. |
| Desk | the Support scopes | The same collect, plus a person who will sit through a USB bundle. The customer types the passphrase. |

The API posts events to a ticket queue. The daemon does not hold a ticket-system token. Events are: machine behind on the channel, check-in overdue, troubleshoot finished, troubleshoot refused. The ticket body is the spoken sentence, the hostname, the profile, the image digest, and the document hash. Revoke the key and the posts stop. A site with no route exports the JSON bundle and a person opens the ticket by hand.

Check-in may carry one `lastSentence`, and that sentence has to be one of the Blind ready lines. An unknown sentence is refused. That is how "could not decrypt" reaches the queue without a collect and without the document.

## The website

The console is this site. Skip link, one heading level at a time, captions on tables, a 3px focus outline, Atkinson Hyperlegible, contrast at least 7:1. No page submits a passphrase. No page has a command box.

When the API exists, a machine row can deploy, and it can request a collect. The request screen shows the reason allowlist and the sentence the machine will hear. It does not ask for a shell command. Until then the Platform page says the platform is not open.

## API

Same host. Nothing is listening. Additions, on top of the service routes:

| Call | Who | Result |
|---|---|---|
| `POST /v1/machines/{hostname}/troubleshoots` | `troubleshoot:request` | Open a collect. `shell` and a command field are refused. |
| `GET /v1/machines/{hostname}/troubleshoots/{id}` | `troubleshoot:read`, or the machine | Status. The report body is not in the status line. |
| `DELETE /v1/machines/{hostname}/troubleshoots/{id}` | `troubleshoot:request` | Cancel. A later result is refused. |
| `POST /v1/machines/{hostname}/troubleshoots/{id}/result` | machine signature | One report, cap 64KiB. Closes the job. |
| `GET /v1/troubleshoots` | `troubleshoot:read` | Open jobs for the account. No report bodies. |

`POST /v1/log` stays the build. Mirrors are fields on the row, not a second publish path.

SQL, when a server exists, is parameterized. Size limits and timeouts apply to every body.

## Negative tests the implementation owes

Not written now. A security-domain implementation without these is unfinished.

- A job with scope `shell`, or with a command field, is refused and starts nothing.
- A speech or large-print profile does not collect on silence. The spoken result is `blunix: troubleshoot refused.`
- Unsynchronized time with `troubleshoot: allow` does not collect.
- An expired, cancelled, or reused job accepts no result.
- A result signed by a different machine is refused.
- An oversized report is refused.
- A report, a ticket, a journal line, and an audit row contain none of the passphrase, the account key, the join token, or the machine private key.
- `machines:read` without `troubleshoot:request` receives a 401 on create.
- A mirror whose bytes do not match the log digest is refused, and the running image stays.
- `POST /v1/log` with a script body, a git URL, or an ordinary account key is refused.
- The collector does not invoke apt and does not open a GitHub URL.
- The daemon opens no TCP port for the troubleshoot.

## Open questions

- Report retention. Proposal: 7 days, then delete the body. The audit row keeps the hash.
- Job lifetime. Proposal: 2 hours, maximum 24.
- Quiet profiles default to `troubleshoot: ask`. Confirm that a cloud node should not collect unless the profile opts in.
- Who holds `log:publish`, and who operates the mirrors. This is the same open question as who signs an image.
- Billing and a second company's machines on one support key wait. v1 is one account.

## Not in this pass

No cloud builder. No ticket queue. No collector in the image. No package added to `image/packages.txt`. No change to the booted disk. The website says the platform is not open.
