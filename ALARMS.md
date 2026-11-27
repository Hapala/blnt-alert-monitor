# Severity and shared alarms

Severity is independent of whether a message was delivered. Shared automatic delivery posts only **Sev 1/2**. Sev 3/4 queue entries become `recorded` without a Discord request or retry; this is not a delivery receipt. Existing personal subscriptions, thresholds, mutes and DM delivery are unchanged. No existing subscriber is opted into new rules.

| Severity | Meaning | Initial classification |
| --- | --- | --- |
| 1 | Critical | Critical liquidity; frozen/setup pool restrictions |
| 2 | Warning | Large shared price move; high borrow APR; ordinary liquidity warning; borrowing restriction; monitoring delay and meaningful recovery notices |
| 3 | Advisory | Smaller shared price move; one-point borrow APR movement |
| 4 | Informational | Reserve additions; changes between active pool statuses; monitoring-resumed gap event; optional digests/samples |

Existing financial thresholds, cooldowns and freshness checks remain in effect. Severity is printed in shared embed footers; existing colours can still convey movement direction or recovery. A recovery can post at Sev 2 so an earlier channel warning is not left unexplained. Personal messages retain their previous formatting and delivery policy. Legacy queued rows migrate as Sev 2 to avoid losing previously eligible warnings. Recorded events advance movement comparisons but never count as confirmed warnings for recovery.

Severity configuration is internal rule metadata in this first version, not a new user preference interface. Persistent active-alarm state and its read-only view are separate additions. No Q4W collection, API source change, DSL, DM-default migration or repository transfer is included. Source commits do not activate these changes on the live host.
