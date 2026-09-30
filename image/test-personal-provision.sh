#!/bin/bash
# Real chroot provisioning in a disposable container; never touches host disks.
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm -i -v "$PWD":/src:ro -w /src debian:trixie-slim bash -s <<'INNER'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-yaml >/dev/null
# A copy of the container root provides an actual chroot, with its own apt DB.
mkdir -p /tmp/target/dev /tmp/target/proc /tmp/target/sys /tmp/target/run /tmp/target/tmp
cp -a /bin /sbin /lib /usr /etc /var /root /tmp/target/
if [ -e /lib64 ]; then cp -a /lib64 /tmp/target/; fi
chmod 1777 /tmp/target/tmp
# Regular placeholders suffice for apt in this throwaway chroot; no host devices.
touch /tmp/target/dev/null
chmod 666 /tmp/target/dev/null
PYTHONPATH=lib python3 - <<'PY'
import base64
from pathlib import Path
import subprocess
from blunix.personal import provision
root = Path('/tmp/target')
key = 'ssh-ed25519 ' + base64.b64encode(bytes.fromhex('0000000b7373682d6564323535313900000020') + b'x' * 32).decode()
dns = (root/'etc/resolv.conf').read_bytes()
provision(str(root), ['git', 'curl', 'nginx'], {'name':'operator', 'sshPublicKey':key})
assert (root/'etc/resolv.conf').read_bytes() == dns
assert not (root/'usr/sbin/policy-rc.d').exists() or (root/'usr/sbin/policy-rc.d').read_text() != '#!/bin/sh\nexit 101\n'
assert (root/'home/operator/.ssh/authorized_keys').stat().st_uid >= 1000
assert (root/'home/operator/.ssh/authorized_keys').stat().st_mode & 0o777 == 0o600
assert 'git=' in (root/'var/lib/blunix/packages.lock').read_text()
subprocess.run(['chroot', str(root), 'visudo', '-cf', '/etc/sudoers'], check=True)
(root/'run/sshd').mkdir(exist_ok=True)
subprocess.run(['chroot', str(root), 'ssh-keygen', '-A'], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['chroot', str(root), '/usr/sbin/sshd', '-t'], check=True)
config = subprocess.check_output(['chroot', str(root), '/usr/sbin/sshd', '-T'], text=True)
assert 'passwordauthentication no' in config
assert 'permitrootlogin no' in config
assert 'pubkeyauthentication yes' in config
assert (root/'etc/systemd/system/multi-user.target.wants/ssh.service').is_symlink()
print('Personal provisioning: apt, admin ownership, sudo, SSH, manifest and restoration passed.')
PY
INNER
