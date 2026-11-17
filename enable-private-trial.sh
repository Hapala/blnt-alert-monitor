#!/usr/bin/env bash
set -euo pipefail
# Legacy user-service activation could create a second sender after migration.
printf '%s\n' 'Legacy activation is disabled. Configure and verify the isolated private runtime at /var/lib/blnt-alert-monitor, then use deploy-isolated.py to prepare/activate a tested release. Changing dry-run to live still requires explicit posting authorization.' >&2
exit 1
