#!/bin/bash
# Mutable Debian 13 test disk. This is not the signed UKI image.
set -eu
set -o pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ "$(uname -s)" = "Darwin" ]; then
  if [ "${1:-}" = "--inside" ]; then
    echo "blunix: image build refused" >&2
    exit 1
  fi
  python3 "$ROOT/image/prepare-secrets.py"
  mkdir -p "$ROOT/build"
  set +e
  docker run --rm --privileged \
    -v "$ROOT":/src -w /src \
    debian:trixie-slim \
    bash /src/image/build-test-disk.sh --inside
  code=$?
  set -e
  if [ "$code" -ne 0 ]; then
    printf '%s\n' FAILED > "$ROOT/build/image-status.txt"
    exit "$code"
  fi
  exit 0
fi

if [ "${1:-}" != "--inside" ]; then
  echo "blunix: image build refused" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export LANG=C
export LC_ALL=C

DISK=/var/tmp/blunix-test.raw
ROOTFS=/var/tmp/blunix-rootfs
CACHE=/src/build/rootfs.tar
MNT=/mnt/blunix
LOOP=""

cleanup() {
  code=$?
  if [ -n "$MNT" ]; then
    umount "$MNT/proc" 2>/dev/null || true
    umount "$MNT/sys" 2>/dev/null || true
    umount "$MNT/dev" 2>/dev/null || true
    umount "$MNT/boot/efi" 2>/dev/null || true
    umount "$MNT" 2>/dev/null || true
  fi
  if [ -n "$LOOP" ]; then
    kpartx -d "$LOOP" 2>/dev/null || true
    losetup -d "$LOOP" 2>/dev/null || true
  fi
  rm -f "$DISK"
  rm -rf "$ROOTFS"
  mkdir -p /src/build
  if [ "$code" -eq 0 ]; then
    printf '%s\n' DONE > /src/build/image-status.txt
  else
    printf '%s\n' FAILED > /src/build/image-status.txt
  fi
  exit "$code"
}
trap cleanup EXIT

echo "blunix: builder packages"
apt-get update -qq
apt-get install -y -qq \
  mmdebstrap parted e2fsprogs dosfstools kpartx rsync \
  python3 python3-yaml age ca-certificates >/dev/null

pkgs=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ""|\#*) continue ;;
  esac
  case "$line" in
    *[!A-Za-z0-9.+-]*)
      echo "blunix: refused package" >&2
      exit 1
      ;;
  esac
  if [ -z "$pkgs" ]; then
    pkgs=$line
  else
    pkgs="$pkgs,$line"
  fi
done < /src/image/packages.txt

stamp=$(sha256sum /src/image/packages.txt | awk 'NR==1 { print $1 }')
# The Mac share folds PAM.7.gz onto pam.7.gz and dpkg loops. Unpack here.
rm -rf /src/build/rootfs "$ROOTFS"
mkdir -p "$ROOTFS"
use_cache=0
if [ -f /src/build/mmdebstrap.done ] \
  && [ "$(cat /src/build/mmdebstrap.done)" = "$stamp" ] \
  && [ -s "$CACHE" ]; then
  echo "blunix: mmdebstrap cache"
  if tar -C "$ROOTFS" -xf "$CACHE" && [ -x "$ROOTFS/usr/bin/apt" ]; then
    use_cache=1
  else
    echo "blunix: mmdebstrap cache refused"
    rm -rf "$ROOTFS"
    mkdir -p "$ROOTFS"
  fi
fi
if [ "$use_cache" -ne 1 ]; then
  echo "blunix: mmdebstrap"
  rm -f /src/build/mmdebstrap.done "$CACHE"
  mmdebstrap --variant=apt --architectures=amd64 \
    --aptopt='APT::Install-Recommends "false"' \
    --aptopt='APT::Install-Suggests "false"' \
    --include="$pkgs" \
    trixie "$ROOTFS" \
    "deb http://deb.debian.org/debian trixie main" \
    "deb http://deb.debian.org/debian trixie-updates main" \
    "deb http://deb.debian.org/debian-security trixie-security main"
  tar -C "$ROOTFS" -cf "$CACHE" .
  printf '%s\n' "$stamp" > /src/build/mmdebstrap.done
fi

if [ ! -x "$ROOTFS/usr/bin/apt" ]; then
  echo "blunix: apt missing" >&2
  exit 1
fi

echo "blunix: partition"
rm -f "$DISK"
truncate -s 8G "$DISK"
parted -s "$DISK" mklabel gpt
parted -s "$DISK" unit MiB mkpart ESP fat32 1 513
parted -s "$DISK" set 1 esp on
parted -s "$DISK" unit MiB mkpart root ext4 513 100%
# max_part=0 in this VM, so losetup -P never creates p1/p2. kpartx does.
LOOP=$(losetup -f --show "$DISK")
kpartx -av "$LOOP" >/dev/null
PART1=/dev/mapper/$(basename "$LOOP")p1
PART2=/dev/mapper/$(basename "$LOOP")p2
ready=0
n=0
while [ "$n" -lt 50 ]; do
  if [ -b "$PART1" ] && [ -b "$PART2" ]; then
    ready=1
    break
  fi
  n=$((n + 1))
  sleep 0.2
done
if [ "$ready" -ne 1 ]; then
  echo "blunix: partitions missing" >&2
  exit 1
fi
mkfs.vfat -F 32 -n ESP "$PART1"
mkfs.ext4 -F -L blunix-root "$PART2" >/dev/null
mkdir -p "$MNT"
mount "$PART2" "$MNT"

echo "blunix: rootfs"
if ! rsync -aHAX --delete "$ROOTFS/" "$MNT/"; then
  rsync -aHA --delete "$ROOTFS/" "$MNT/"
fi
mkdir -p "$MNT/boot/efi"
mount "$PART1" "$MNT/boot/efi"

if [ ! -e "$MNT/vmlinuz" ]; then
  src=$(find "$MNT/boot" -maxdepth 1 -type f -name 'vmlinuz-*' | sort | tail -n 1)
  if [ -z "$src" ]; then
    echo "blunix: kernel missing" >&2
    exit 1
  fi
  ln -s "boot/$(basename "$src")" "$MNT/vmlinuz"
fi
if [ ! -e "$MNT/initrd.img" ]; then
  src=$(find "$MNT/boot" -maxdepth 1 -type f -name 'initrd.img-*' | sort | tail -n 1)
  if [ -z "$src" ]; then
    echo "blunix: initrd missing" >&2
    exit 1
  fi
  ln -s "boot/$(basename "$src")" "$MNT/initrd.img"
fi

echo "blunix: overlay"
rm -rf "$MNT/usr/lib/blunix-python"
mkdir -p "$MNT/usr/lib/blunix-python/blunix"
cp -a /src/lib/blunix/*.py "$MNT/usr/lib/blunix-python/blunix/"
rm -rf "$MNT/usr/share/blunix/models"
mkdir -p "$MNT/usr/share/blunix"
cp -a /src/models "$MNT/usr/share/blunix/models"
for launcher in /src/apply/blunix /src/apply/blunix-*; do
  install -m 0755 "$launcher" "$MNT/usr/bin/$(basename "$launcher")"
done
mkdir -p "$MNT/etc/systemd/system"
install -m 0644 /src/image/units/*.service "$MNT/etc/systemd/system/"

enable_unit() {
  unit=$1
  if [ -f "$MNT/etc/systemd/system/$unit" ]; then
    target="../$unit"
    srcfile="$MNT/etc/systemd/system/$unit"
  elif [ -f "$MNT/usr/lib/systemd/system/$unit" ]; then
    target="/usr/lib/systemd/system/$unit"
    srcfile="$MNT/usr/lib/systemd/system/$unit"
  elif [ -f "$MNT/lib/systemd/system/$unit" ]; then
    target="/usr/lib/systemd/system/$unit"
    srcfile="$MNT/lib/systemd/system/$unit"
  else
    echo "blunix: missing unit $unit" >&2
    exit 1
  fi
  wants=$(awk -F= '
    /^\[/ { section=$0 }
    section=="[Install]" && $1=="WantedBy" { print $2 }
  ' "$srcfile")
  if [ -z "$wants" ]; then
    echo "blunix: unit has no WantedBy $unit" >&2
    exit 1
  fi
  for item in $wants; do
    dir="$MNT/etc/systemd/system/${item}.wants"
    mkdir -p "$dir"
    ln -sfn "$target" "$dir/$unit"
  done
}

for unit in \
  systemd-networkd.service \
  systemd-resolved.service \
  systemd-timesyncd.service \
  ssh.service \
  containerd.service \
  open-vm-tools.service \
  blunix-access.service \
  blunix-bootstrap.service \
  blunix-node-boot.service \
  systemd-networkd-wait-online.service
do
  enable_unit "$unit"
done

for unit in espeakup.service speech-dispatcher.service brltty.service systemd-repart.service; do
  ln -sfn /dev/null "$MNT/etc/systemd/system/$unit"
done

python3 /src/apply/blunix-net render dhcp-any \
  --models /src/models \
  --dest "$MNT/usr/lib/systemd/network"

cat > "$MNT/etc/fstab" <<'EOF'
LABEL=blunix-root / ext4 defaults 0 1
LABEL=ESP /boot/efi vfat umask=0077 0 2
EOF
printf '%s\n' blunix > "$MNT/etc/hostname"
cat > "$MNT/etc/hosts" <<'EOF'
127.0.0.1 localhost
127.0.1.1 blunix
EOF
rm -f "$MNT/etc/resolv.conf"
ln -s /run/systemd/resolve/stub-resolv.conf "$MNT/etc/resolv.conf"
: > "$MNT/etc/machine-id"
rm -f "$MNT/etc/ssh/ssh_host_"*
mkdir -p "$MNT/etc/systemd/system/ssh.service.d"
install -m 0644 /src/image/test/ssh-hostkeys.conf "$MNT/etc/systemd/system/ssh.service.d/hostkeys.conf"
mkdir -p "$MNT/etc/ssh/sshd_config.d"
install -m 0644 /src/image/test/sshd-test.conf "$MNT/etc/ssh/sshd_config.d/00-blunix-test.conf"
if ! grep -q '^Include /etc/ssh/sshd_config.d/\*\.conf' "$MNT/etc/ssh/sshd_config"; then
  echo "blunix: sshd include missing" >&2
  exit 1
fi

echo "blunix: grub"
mount --bind /dev "$MNT/dev"
mount --bind /proc "$MNT/proc"
mount --bind /sys "$MNT/sys"
chroot "$MNT" /usr/sbin/grub-install \
  --target=x86_64-efi \
  --efi-directory=/boot/efi \
  --boot-directory=/boot \
  --removable \
  --no-nvram
if [ -d "$MNT/boot/grub/x86_64-efi" ]; then
  mkdir -p "$MNT/boot/efi/EFI/BOOT"
  rm -rf "$MNT/boot/efi/EFI/BOOT/x86_64-efi"
  cp -a "$MNT/boot/grub/x86_64-efi" "$MNT/boot/efi/EFI/BOOT/x86_64-efi"
fi

echo "blunix: seal"
PYTHONPATH=/src/lib python3 /src/image/seal-root.py "$MNT"

umount "$MNT/proc"
umount "$MNT/sys"
umount "$MNT/dev"

mkdir -p "$MNT/boot/grub" "$MNT/boot/efi/EFI/BOOT"
install -m 0644 /src/image/grub/grub.cfg "$MNT/boot/grub/grub.cfg"
install -m 0644 /src/image/grub/grub.cfg "$MNT/boot/efi/EFI/BOOT/grub.cfg"

echo "blunix: scan"
python3 /src/image/scan-root.py "$MNT"

echo "blunix: copy"
sync
umount "$MNT/boot/efi"
umount "$MNT"
kpartx -d "$LOOP"
losetup -d "$LOOP"
LOOP=""
cp --sparse=always "$DISK" /src/build/blunix-test.raw
if [ ! -s /src/build/blunix-test.raw ]; then
  echo "blunix: disk missing" >&2
  exit 1
fi
echo "blunix: disk ready"
