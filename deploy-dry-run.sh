#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# A complete release includes both entry points and every local module they import.
sudo -n python3 "$source_dir/deploy-isolated.py" --prepare "$source_dir"
sudo -n python3 "$source_dir/deploy-isolated.py" --init-dry-run
