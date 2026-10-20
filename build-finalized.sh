#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
python3 scripts/prepare-finalized-source.py
exec env PUBLIC_BUILD=1 bash build-both-firmware.sh "${1:-j4-standard}"
