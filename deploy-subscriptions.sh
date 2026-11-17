#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Prepare and verify without stopping either live worker, then activate with rollback.
sudo -n python3 "$source_dir/deploy-isolated.py" --prepare "$source_dir"
sudo -n python3 "$source_dir/deploy-isolated.py" --activate
