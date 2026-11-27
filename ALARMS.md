# Severity and shared alarms

Severity is independent of whether a message was delivered. Shared automatic delivery posts only **Sev 1/2**. Sev 3/4 queue entries become `recorded` without a Discord request or retry; this is not a delivery receipt. Existing personal subscriptions, thresholds, mutes and DM delivery are unchanged. No existing subscriber is opted into new rules.

| Severity | Meaning | Initial classification |
| --- | --- | --- |
| 1 | Critical | Critical liquidity; frozen/setup pool restrictions |
| 2 | Warning | Large shared price move; high borrow APR; ordinary liquidity warning; borrowing restriction; monitoring delay and meaningful recovery notices |
| 3 | Advisory | Smaller shared price move; one-point borrow APR movement |
| 4 | Informational | Reserve additions; changes between active pool statuses; monitoring-resumed gap event; optional digests/samples |

Existing financial thresholds, cooldowns and freshness checks remain in effect. Severity is printed in shared embed footers; existing colours can still convey movement direction or recovery. A recovery can post at Sev 2 so an earlier channel warning is not left unexplained. Personal messages retain their previous formatting and delivery policy. Legacy queued rows migrate as Sev 2 to avoid losing previously eligible warnings. Recorded events advance movement comparisons but never count as confirmed warnings for recovery.

## Persistent state

The shared worker stores the latest episode per public rule/pool/asset in SQLite, separately from its outbox. The independent watchdog stores its own monitoring episode in `health.sqlite`. Conditions are **active**, **resolved**, or **unknown**; missing, stale, unverified or paused inputs cannot resolve an episode. Reads also show old observations as unknown if the collector stops. Fresh observations restore the same episode, and only verified recovery closes it. Severity changes do not create a new episode. Notification mutes, cooldowns, failures and silent recording do not define alarm health.

Price conditions use the existing rolling-hour trigger and rearm thresholds; missing continuous history or website verification makes an unresolved price condition unknown. High APR and liquidity use their existing recovery thresholds. A verified empty reserve can resolve liquidity risk. Restricted pools appear as active conditions even on the silent first baseline; normal status resolves them. Monitoring alarms use the existing five-minute degradation / one-minute recovery debounce. Verified rate/liquidity data remains usable for three minutes, so the read-only state can be unknown between five-minute collections; the watchdog retains its separate ten-minute rate-coverage allowance.

APR movements, reserve additions, normal-to-normal status changes and monitoring-resumed notices are **recent events**, with a one-hour lifetime rather than a claim of ongoing risk. Re-reading the same event does not extend its expiry. They are distinguished from ongoing conditions by an expiry timestamp. Resolved rows may be pruned after eight days; active and unknown unresolved episodes survive ordinary history retention. Only the latest episode is retained in this table, not an unlimited transition audit.

Tracking is shared/public only in this phase. Personal wallet/position results are never copied into the shared alarm table, and no subscriber preferences or consent are rewritten. Live and dry-run states are isolated.

## View alarms in Discord

Use **`/blnt-alerts active`**, optionally `page:<number>`, in the server or a verified member DM. A personal subscription is not required. The response and follow-up pages are ephemeral, with ten entries per results page. It combines both public alarm stores, includes all four severities, separates ongoing conditions from one-hour recent events, and shows severity, value/detail and duration or expiry. Unknown values are explicitly last verified, not current. Unavailable databases, unevaluated rules, pauses and unavailable source-clock calibration are shown explicitly; an empty list never claims an all-clear. Reads do not change alarm state, outboxes or settings.

The watchdog's database remains separate from the main database and private to the existing shared service group; its unit creates data with group-private permissions so the DM service can read the public alarm view. Its independent delivery and opposite-credential restrictions remain intact. No additional Discord permissions or intents are required. An automatically edited pinned board remains separate work; this command is an on-demand private view, not a new scheduled report.

Severity configuration is internal rule metadata in this first version, not a new user preference interface. No Q4W collection, API source change, DSL, DM-default migration or repository transfer is included. Source commits do not activate these changes on the live host.
