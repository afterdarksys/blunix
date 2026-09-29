#!/bin/bash
# Prove the library inside Debian 13, where age is the distro package.
set -eu
set -o pipefail
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD":/src -w /src debian:trixie-slim \
  bash -lc 'apt-get update -qq && apt-get install -y -qq python3 python3-yaml age >/dev/null && PYTHONPATH=lib python3 -m unittest discover -s tests -v'
