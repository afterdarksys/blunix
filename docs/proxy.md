# blunix proxy

The build-proxy runs on an operator's Linux or macOS machine on the install
LAN. It publishes one encrypted build per machine through the API, then
serves those builds, an iPXE script, and install addresses to machines that
netboot.

**Netboot is for trusted LANs only until images are signed.** The kernel,
initrd and squashfs travel over plain http. `serve` checks them against
`SHA256SUMS` at startup, which proves only that they match the sums file you
trusted, not who made them. Contract: `docs/designs/blunix-install-plane.md`, "The build-proxy".

Needs Python 3.9 or newer, PyYAML, and `age` on the PATH (Debian `age`, or
Homebrew `age` on macOS).

## Commands

```
blunix proxy init [--api URL] [--key-file PATH] [--listen HOST:PORT]
blunix proxy plan SITE.yaml [--check]
blunix proxy publish SITE.yaml [--out DIR]
blunix proxy serve [--site SITE.yaml] [--media DIR [--sums PATH]] [--listen HOST:PORT] [--advertise HOST:PORT]
blunix proxy dnsmasq SITE.yaml [--interface IF] [--range START,END] [--proxy HOST:PORT] [--tftp-root DIR]
```

Every command takes `--config PATH`. The default is `~/.config/blunix/proxy.yaml`.

### init

Writes `proxy.yaml` with mode 0600:

```yaml
api: https://api.blunix.io
key_file: /home/you/.config/blunix/proxy.key
listen: 0.0.0.0:8750
```

- The account key is a `blx_` program key with the `hosts:write` scope. Create it in the portal.
- If the key file exists, it must be a regular file you own with mode 0600. Otherwise init refuses.
- If the key file does not exist, init reads the key from the terminal (echo off) or from stdin, and creates the file with mode 0600.
- A `blx_join_` token is refused. A key on the command line is refused.
- init prints only the key's fingerprint, the first 12 hex digits of its SHA-256.
- `--api http://localhost:8787` is accepted for `wrangler dev`. Plain http to any other host is refused.

### plan

Prints one sentence per machine: its label, URL, hostname, network, disk and access.
It renders and validates every node document, and makes no network call.
With `--check` it also calls `GET /v1/hosts` to say which labels are already yours.

### publish

First it renders and validates every document. If any machine is refused, nothing is sent.
Then, for each machine in order:

1. Reserve the label with `POST /v1/hosts`. A 409 means the label exists. If `GET /v1/hosts` lists it, the label is yours and publish continues. If not, publish stops and says which label belongs to another account.
2. Generate a key (100 bits, Crockford base32).
3. Encrypt the document with `age --passphrase`.
4. Append a pending install card, with the key and the label, to `DIR/keys.txt`, and fsync it.
5. Upload the ciphertext with `POST /v1/hosts/{label}/builds`, then check the returned sha256 and size against the upload.
6. Append `Published:` with the version, pinned URL and sha256 to the card, and record the result in `DIR/state.json`. If the upload fails, append `Not confirmed:` instead and stop.

The key is on disk before the upload because the API can record a version and the answer can still be lost. A `Not confirmed` card says this run did not see the upload land; if the label's latest version is newer than your last card, that key opens it.

About the output files:
- `keys.txt` is created with `O_EXCL` and mode 0600. If it already exists, publish refuses, so an earlier card is never overwritten.
- `state.json` holds MACs, labels, versions, sha256s and URLs. It never holds a key.
- `DIR` defaults to `./blunix-publish-YYYYmmdd-HHMMSS`.

Keys are never sent to the API and never printed.

Every run uploads a new version for every machine. That is intended: the latest URL moves to the new build, and older pinned URLs keep working.

An install card reads:

```
Install card for ada. Pending: written before the upload.
Machine hostname: ada-1. MAC: 00:50:56:aa:bb:01.
Latest URL: https://ada.blnx.io/
Key: k7m2q-9dx4t-ab3fz-0wnr8
Date: 2026-09-29.
Published: ada version 3.
Pinned URL: https://v3.ada.blnx.io/
SHA-256 of the ciphertext: <hex>
```

Print the cards or copy them off, then delete `keys.txt`.

### serve

A LAN HTTP server on the configured listen address. It serves GET and HEAD only; any other method gets 405.

| Route | Serves |
|---|---|
| `GET /healthz` | `ok` |
| `GET /v1/build/{host}` | The ciphertext from `https://{host}/`, as `application/octet-stream`, with `x-blunix-sha256`. |
| `GET /v1/netconfig/{mac}` | `{"address", "gateway", "dns"}` for a static machine in `--site`. Otherwise 404. |
| `GET /v1/boot.ipxe` | The iPXE script, when the proxy has an address to name. Otherwise 404. |
| `GET /media/{vmlinuz,initrd.img,blunix.squashfs}` | Files from `--media DIR`, checked at startup. Nothing else. |

The build relay:
- **Hosts.** Only these are relayed: `{label}.blnx.io` and `v{n}.{label}.blnx.io`. The legacy `name-N.build.blunix.io` form, `*.build.blunix.io` user hosts and the bare `blnx.io` are refused. They must be lowercase, with no port, no userinfo, no IP literal, and no percent-encoding. Every other host gets 404, so the proxy is not an open proxy.
- **TLS.** The system CA store, a hostname check, and TLS 1.2 or higher. A TLS failure is a 502. There is never a retry over http.
- **Limits.** No redirects are followed. The body is capped at 256 KiB, and the whole fetch at 20 s. The body must be age binary or age armor.
- **Cache.** Held in memory, keyed by host. A pinned `v{n}` host is cached for 1 h. A latest host is cached for 60 s.

The iPXE script:
- The kernel line carries `blunix.proxy=HOST:PORT` and `boot=live fetch=http://HOST:PORT/media/blunix.squashfs` (live-boot fetches the squashfs into RAM; give the machine 2 GiB or more), the same line as `image/ipxe/blunix.ipxe`.
- `HOST:PORT` is `--advertise` when given, or else the `--listen` address when it is a specific address. The `Host` header is never used. With neither (listen on `0.0.0.0`, no `--advertise`), `boot.ipxe` answers 404 and the log says why.

The media:
- `--media DIR` needs a `SHA256SUMS` in `DIR`, or `--sums PATH` (the release's `SHA256SUMS` works; other entries are ignored). It must have an entry for each of `vmlinuz`, `initrd.img` and `blunix.squashfs`.
- At startup each file is opened without following symlinks and hashed. A missing sums file, a missing entry, a missing file, a symlink, or a mismatch stops `serve` with one sentence.
- A file that changes after startup (inode, size or mtime) is not served: 404, and the log says to restart.

Request limits:
- Request lines are capped at 4 KiB and headers at 8 KiB.
- Each request has a 30 s deadline from connect to last byte, 15 min for a media file. A slow trickle is cut off.
- At most 64 connections are served at once. More are closed at once, unanswered.
- Each client IP gets a token bucket of 60 requests, refilled at 1 per second. The table holds 4096 IPs; a new IP evicts the least recently seen one.
- The access log on stderr records the client IP, method, path without the query string, and status. It never records a body or a header.

The proxy never has a build key. `keys.txt` is not in `--media`'s allowlist, and a symlink in `--media` is refused.

### dnsmasq

Prints a dnsmasq config for the install VLAN to stdout. It does not start dnsmasq.
The config's header says netboot is for trusted LANs only until images are signed.
- `port=0`, so DNS is off.
- One `dhcp-host` per MAC. A static machine gets its install address, router and DNS options. A DHCP machine gets its hostname only.
- `dhcp-range`: the `--range START,END` you give. Otherwise, a static range for each subnet the static machines use.
- PXE for listed MACs only (the `known` tag):
  - iPXE clients get `http://PROXY/v1/boot.ipxe`.
  - Other clients get `ipxe.efi` (UEFI x86-64) or `undionly.kpxe` (BIOS) over TFTP from `--tftp-root` (default `/srv/tftp`), with `tftp-secure`.

`PROXY` is `--proxy HOST:PORT`, or the configured listen address if it is a specific address.

## Site file

See `examples/site.yaml`.

```yaml
defaults:            # optional
  disk: metal-luks   # disk model name
  access: regular    # access model name
  channel: stable    # only stable today
  dns: [192.0.2.53]  # used by static machines that give no dns
machines:
  - mac: "00:50:56:aa:bb:01"   # quote it
    label: ada                  # owns ada.blnx.io
    hostname: ada-1             # written to /etc/hostname
    network:                    # static install address
      address: 192.0.2.21/24
      gateway: 192.0.2.1
      dns: [192.0.2.53]         # optional if defaults.dns is set
    disk: metal-luks            # optional override
    access: full-speech         # optional override
    target: nvme0n1             # optional: kernel disk name or serial
  - mac: "00:50:56:aa:bb:03"
    label: linus
    hostname: linus-1
    dhcp: true                  # instead of network
```

The parser is strict:
- An unknown key anywhere is refused, and so is a duplicate YAML key, an alias, or a merge key.
- MACs are normalized to lowercase with colons. `00-50-56-AA-BB-01` and `005056aabb01` are accepted. Multicast and all-zero MACs are refused.
- Quote every MAC. YAML 1.1 reads some unquoted MACs as numbers, and the parser refuses those.
- Labels follow the contract: `^[a-z][a-z0-9-]{0,30}[a-z0-9]$`, no `--`, not reserved, and not `v` followed by digits.
- MACs, labels, hostnames and static addresses must each be unique.
- A machine has exactly one of `network` or `dhcp: true`.
- A static address needs a prefix. It must not be the network or broadcast address, and the gateway must be inside its subnet.
- `disk` and `access` must name models that exist.

Each machine becomes a node document with the inline network form:

```yaml
apiVersion: blunix.dev/v1
kind: Node
name: ada
hostname: ada-1
disk: metal-luks
network: {match: [en*], address: 192.0.2.21/24, gateway: 192.0.2.1, dns: [192.0.2.53]}
access: regular
ai: default
update: {url: https://updates.blunix.io/blunix, channel: stable}
sysexts: []
```

A `dhcp: true` machine gets `network: dhcp-any`.
