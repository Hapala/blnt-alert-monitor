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
