# Public pool-condition alerts

These messages use public, identity-verified pool data. They never query wallet positions or configure personal rules. Scheduled shared daily reports remain disabled.

## Pool status

The oracle collector reads `Config.status` from the pool instance it already verifies. The first valid value is a silent baseline; later observed changes create one concise coloured message with old/new labels and current restrictions. Admin and automatic statuses remain distinct.

| Codes | Label | Pool-level restriction |
| --- | --- | --- |
| 0 / 1 | Active (admin) / Active | New borrowing enabled; other transaction checks still apply. |
| 2 / 3 | On ice (admin) / On ice | New borrowing disabled. |
| 4 / 5 | Frozen (admin) / Frozen | New borrowing and supplies disabled. |
| 6 | Setup | New borrowing and supplies disabled. |

These meanings were checked against revision `771059f6dd232fd35ea29b7b2a987f0e13bb2372`, `pool/src/pool/status.rs` and `pool/src/pool/pool.rs::require_action_allowed`, matching the registry evidence revision. The saved reference checkout was verified at that exact revision; a newer protocol checkout is not evidence for deployed meanings. No protocol files were modified.

Unknown values or failed identity/schema checks exclude the pool instead of inventing a status. A missing pool suppresses its definitely unsent status messages. Valid later data can regenerate a cancelled change. Sent, in-flight and uncertain messages do not automatically replay. A restriction that returns to its previous status before delivery cancels the unreported message. Several changes between polls can be missed; a notification is an observed transition, not a complete on-chain event history.

Changes to risk parameters, reserve enabling/removal and supply APY are separate from these status alerts.

## Liquidity warnings

Every five minutes, the existing public `get_reserve` previews also provide supplied/borrowed balances and token precision. There are no additional RPC calls per reserve. Liquidity checks keep that schedule even if public APR alerts are disabled. Configure `liquidityAlerts` to disable or change the shared thresholds; absent configuration uses the documented defaults.

- **90% borrowed:** amber warning, once per episode.
- **95% borrowed:** red escalation, once per episode; may bypass the six-hour warning cooldown.
- **85% or below:** green recovery after a confirmed delivered warning. Rearm high warnings with a six-hour cooldown per asset.

Supply is `floor(b_supply × b_rate / 10^12)`; debt is `ceil(d_supply × d_rate / 10^12)`. These conversions match the pinned `reserve.rs::total_supply` and `total_liabilities` source. Comparisons use exact integer ratios. The message shows a rounded utilization percentage and an estimated unborrowed supplied balance, `max(supply − debt, 0)`, in that asset's units. Zero-supply/zero-debt reserves produce no warning; outstanding debt with zero supply gets a critical notice with no invented utilization percentage.

This is a reserve accounting estimate. It does not read the token contract's actual cash balance, account for every restriction/claim, simulate a withdrawal/borrow, or guarantee executable liquidity. Pool status, utilization caps, authorization and other checks can independently block a transaction. It is not DEX depth, slippage, market capitalization or trading volume.

Missing/stale/disabled reserve coverage suppresses definitely unsent messages. Cancelled/expired eligible warnings can regenerate; uncertain or accepted sends never replay automatically. Recoveries require a confirmed warning. Personal thresholds, mutes and subscriptions are unchanged.
