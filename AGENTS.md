# Agent instructions — BLNT Alerts

These instructions apply to this alert-monitor repository. Read [SYSTEM_SPEC.md](SYSTEM_SPEC.md) and the relevant operational guide before changing behavior. The spec describes requirements; this file describes how to work on them. Current explicit user instructions take precedence over older repository guidance.

## Work in small, reviewable changes

1. Understand the requested outcome and why it matters. Identify the affected requirement IDs in the system spec. When asked “What do you recommend?” or “Does that make sense?”, evaluate the idea and its tradeoffs before treating it as an instruction to implement.
2. Implement **one small feature, bug fix or coherent documentation change at a time**. Do not bundle unrelated improvements. Separate larger work into ordered changesets and explain dependencies.
3. Inspect the working tree first. Preserve others' edits. Make the smallest complete change, including necessary requirements, documentation and regression tests.
4. Run checks appropriate to the change. Do not mistake passing tests for a code review.
5. Stage only the intended files or hunks, then inspect the **exact staged diff** (`git diff --cached`, `git diff --cached --check`, `git status --short`). Do not use an indiscriminate repository-wide add.
6. Review the staged change for correctness, security/privacy, regressions, requirement drift, deployment/rollback effects and test gaps. Include documentation/spec changes in this review. Use a fresh review pass; do not claim an independent reviewer participated unless one actually did.
7. If there are findings in the changeset, fix them, rerun affected checks, restage and review again. Do not commit unresolved findings introduced by that changeset. Existing tracked gaps outside its scope may remain explicitly documented; never claim they are resolved. If a changeset finding cannot be addressed within the authorized scope, explain it and leave the changes reviewable without claiming approval.
8. When the staged review has **no findings** and relevant checks pass, commit with a focused message and push the intended branch. Recheck the staged content if it changes after review. Follow any explicit user request not to commit/push.
9. Report what changed and why, what was reviewed/tested, any remaining limits, and the commit/CI result. Distinguish source edits, pushed commits, prepared releases and actual live deployment.

Do not create additional agents or a separate chat unless the user or applicable higher-priority instructions explicitly request that workflow. A review does not require delegation.

## Requirements and spec maintenance

- Keep the system spec under version control and update the affected requirements when accepted behavior changes. Requirements need a purpose, observable behavior and an acceptance check.
- Clearly distinguish **accepted user intent**, **verified implementation**, **known implementation gaps** and **recommendations awaiting a decision**. Do not rewrite the spec to conceal a defect.
- Ask the user to review meaningful requirement changes, especially data sources, access, privacy, alert meaning/thresholds, recipients, retention and live activation. Do not repeatedly ask for approval for work already authorized within those boundaries.
- Guidance is not automatic implementation permission. Sample commands or numbers are never permission to activate personal rules.
- Write alerts in plain, concise language: lead with the asset/pool and the value that changed, then the trigger or comparison. Use bold figures and a short footer for qualifications; avoid filler, repeated disclaimers and internal diagnostics. Public rules never enable personal thresholds.
- Keep the shared channel focused on meaningful changes. Scheduled shared daily reports are disabled; do not re-enable them without a new request. Rate changes are percentage points of borrow APR, not supply APY; price moves are oracle prices, not market capitalization.
- Review the spec itself during each relevant changeset. Existing dates, success claims and operational snapshots are evidence, not guarantees that the live state remains unchanged.

## Security and scope boundaries

- This project reads public BLNT/Stellar data and sends Discord notifications. It does not sign/submit transactions, trade, manage wallet keys, call the private/local RPC or run AI chat/exec handlers.
- Never request, print, log, commit or place in screenshots a secret key, seed phrase, Discord token, webhook credential, private database or real subscriber wallet-to-Discord association. Use synthetic wallet fixtures. Keep runtime identity/configuration files and data outside Git.
- BLNT Alerts has its own pinned bot identity and token. Never fall back to personal OpenClaw credentials or expose its tools. Neither worker may read personal OpenClaw files, SSH/cloud credentials or Windows home files.
- Preserve fixed endpoint/method allowlists, contract/WASM/oracle bindings, data freshness and recipient-isolation checks. Do not weaken them to make a test or live check pass.
- Verify pool-status meanings and reserve accounting against the registry's evidence revision, not an unrelated or newer protocol checkout. Keep liquidity estimates distinct from actual cash or guaranteed withdrawals. Monitoring-health messages may publish generic component names only; keep raw errors and subscriber details private. The local watchdog cannot promise off-host outage coverage.
- Personal borrowing-capacity and borrow-APR rules default off. The project owner's rules must remain off unless that owner explicitly authorizes particular thresholds. Preserve other subscribers' settings and consent.
- Shared channel visibility is a user decision: **server-visible #price-alerts**, with personal alerts in DMs. Use `audience:shared` routing metadata, preserve actual channel permissions and never treat a metadata label as proof of visibility. Historical private labels may be accepted for upgrade compatibility; do not reintroduce them into user-facing messages or examples.
- Modify only this monitor and its managed runtime within the authorized task. Do not modify protocol repositories, unrelated RPC/Core/PM2 services or personal OpenClaw configuration as a side effect.

## Checks and reviews

For executable changes, normally run:

```sh
npm ci --ignore-scripts --no-audit --no-fund  # when dependencies need installation
npm test
npm audit --audit-level=moderate
python3 check-secrets.py
git diff --cached --check
```

Use Node 24. Dependencies are locked. Tests must use synthetic data/fake delivery unless a live check is explicitly authorized. Choose regression tests that demonstrate the actual failure or user-visible contract, rather than duplicating implementation details.

For documentation-only changes, inspect requirements against current source, check relative links and examples, and run whitespace/credential checks. Do not restart services or deploy merely to publish documentation. GitHub CI still runs its configured suite after a push.

Pay particular attention to:

- definitely unsent cancellation/rearming versus sent, in-flight or uncertain outcomes;
- category/pool/user isolation and consent after preference or membership changes;
- fixed-point arithmetic, threshold equality, currency denomination and variable APR versus APY;
- stale/partial inputs, whole-cycle latency and provider failures;
- aggregate Discord message limits and partial multi-message delivery;
- complete initial installation, stopped-writer backups, immutable releases, rollback and preserved worker states;
- actual process/permission checks, not just status files or historical receipts.

## Live operations

- A push does not authorize a deployment, restart, real test message, visibility/access change or rule activation. Continue an explicitly authorized deployment without asking for the same approval again.
- Use `deploy-isolated.py --prepare <source>` to test a complete candidate under the isolated account before activation. Do not replace running files or install dependencies into an active release.
- Activate only after preparation passes and the user has authorized deployment. Preserve subscriber settings, consent, data and previous worker states; use stopped-writer backups or SQLite's backup API.
- Verify the candidate's release-specific worker heartbeats, public-ledger freshness, website cross-check, credential isolation and expected bot/command identity. Use a labelled real delivery test only when authorized. Record sender identity and timestamp; do not count a receipt from the old bot as current delivery proof.
- Never automatically replay an uncertain delivery. Report it for review.
- Do not call the project continuously available or production-ready solely because tests pass. Windows/WSL availability, public providers and the remaining operational work in the spec still matter.
