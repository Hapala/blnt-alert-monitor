# Personal borrowing-capacity and APR alerts

Implemented November 15, 2026. **All new rules default off. Michael explicitly chose to leave them off until selecting thresholds.** Existing price alerts, subscriptions, mutes and the private shared channel continue independently.

In your DM with **BLNT Alerts**, select the pool choice in Discord's command picker:

```
/blnt-alerts capacity pool:<Fixed V3> percent:20 amount:100
/blnt-alerts rate pool:<Fixed V3> apr:10
/blnt-alerts borrowing
/blnt-alerts capacity pool:<Fixed V3> clear:true
/blnt-alerts rate pool:<Fixed V3> clear:true
/blnt-alerts mute category:capacity
/blnt-alerts mute category:borrow_rate
```

These are examples, not activated settings. Configure YieldBlent separately if desired. Capacity percentage and amount rules are independent: either can trigger. Omitted parameters retain their prior setting; `clear:true` turns off that type of rule for that pool. Percent accepts 0–100, up to six decimal places. Amount accepts a plain nonnegative decimal string, up to seven decimal places, without commas or a currency symbol. APR accepts an annual percentage, up to six decimal places. Threshold comparisons are strictly below for capacity and strictly above for APR; equality does not trigger.

Rules apply only to currently selected pools, with existing pool mutes, category mutes, pause/snooze and unsubscribe respected. Default rate scope is `borrowed`: only reserves in which the wallet currently owes debt. The optional `scope:selected-pools` watches all enabled reserves in that selected pool, plus any still-borrowed disabled reserve. Add an unrelated pool explicitly with `add-pool` to select it; setting a threshold does not silently subscribe to a pool. Rate messages distinguish outstanding borrows from offered rates on reserves you are watching.

## Capacity definition

The currency amount is **risk-adjusted borrowing headroom in the pool oracle's quote**, rather than a promise that the same amount of any token can be borrowed. Fixed uses USD; YieldBlent uses USDC. They are not combined or converted, and no peg is assumed. The percentage is headroom divided by the risk-adjusted credit limit, multiplied by 100.

The calculation follows the pinned pool's conservative integer conversions:

1. Collateral bTokens convert to underlying with floor rounding at 12-decimal b_rate, then apply the 7-decimal collateral factor with floor rounding, then the oracle price with floor rounding.
2. Liability dTokens convert with ceiling rounding at 12-decimal d_rate, divide by the 7-decimal liability factor with ceiling rounding, then apply the oracle price with ceiling rounding.
3. Credit limit is floor(effective collateral / 1.0000100), incorporating the contract's minimum post-borrow health-factor margin. Headroom is max(limit − effective liabilities, 0). A pool status that blocks borrowing or collateral below its minimum produces zero headroom.
4. Deauthorized collateral contributes zero effective collateral, following the contract's optional `authorized(pool)` getter. A contract-level simulation failure of this optional extension uses the same fallback as the pool; RPC transport failures do not use that fallback.

Supply that has not been designated collateral and backstop deposits do not create borrowing capacity. A wallet with neither collateral value nor debt does not receive low-capacity warnings. A particular token's actual borrowing amount also depends on its liability factor, liquidity, utilization limits, access permissions, position limits and other protocol checks. This monitor does not simulate a proposed borrow or guarantee transaction execution.

## Rates, freshness and delivery

`get_reserve(asset)` is an unsigned read-only simulation that previews accrued reserve state at the current ledger. The annual **APR** follows the contract's three-segment utilization curve using its current rate modifier. The surcharge above 95% utilization is not multiplied by that modifier. Borrower APR is not supplier yield, net yield, or compounding APY. Rates are variable; these alerts are observations, not promises about future cost.

When any rule is configured, personal borrowing checks run with the DM worker's approximately one-minute cycle. The collector verifies the pinned pool/oracle identities and quote, reserve indices/precision, current reserve timestamps and unchanged wallet positions across collection. It uses fresh oracle prices from the primary snapshot; capacity requires matching, valid website checks for every position price. Missing/stale/mismatched prices suppress capacity while a valid reserve APR can still be evaluated. Failed pool reads suppress that pool's borrowing messages. Snapshot age must be at most three minutes and collection span at most two minutes; oracle age remains bounded by the existing configuration. Reads are sequential across ledgers, not an atomic transaction snapshot.

Alerts deduplicate while a condition stays breached. Re-arming requires recovery of two percentage points for percentage capacity (capped at 100% remaining), max(10% of threshold, one quote unit) for currency capacity, or min(10% of threshold, one percentage point) for APR; each rule has a one-hour cooldown. Pending messages are cancelled if the condition no longer breaches, a debt is repaid, data fails, selection/preferences change or notifications are muted. Existing DM expiration, rate-limit and uncertain-delivery handling applies. Changing a rule creates a new rule revision.

`/blnt-alerts borrowing` refreshes the caller's current personal data on demand, even while thresholds remain off. The response is ephemeral and never appears in the shared channel. No wallet keys or signed transactions are used. Private snapshots and alert state stay in the monitor database, excluded from Git.

## Evidence

Source revision: [771059f6](https://github.com/BLNT-Protocol/blnt-contracts-v3/tree/771059f6dd232fd35ea29b7b2a987f0e13bb2372). Reviewed `pool/src/pool/health_factor.rs`, `reserve.rs`, `interest.rs`, `submit.rs`, and the getter in `pool/src/contract.rs`. Tests reproduce the published mixed-decimal collateral/liability fixture, all rate-curve boundaries and its high-utilization surcharge; they also cover threshold equality, independent units, mutes, cooldowns, repayment, default-off rules and fail-closed collection.
