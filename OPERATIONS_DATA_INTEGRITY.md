# Operations data-integrity rollout

## Verification

Run before merge and again from the release artifact:

```bash
npm test --prefix functions
npm run check --prefix functions
node --check operations-phase1.js
node --check operations-data-integrity.js
node --check barcode-print.js
```

## Rollout and monitoring

1. Deploy the frontend and sync function only to an isolated staging project backed by a disposable copy of production data. There is currently no dry-run toggle: every sync enables inventory application and will formally change staging inventory.
2. Before the first staging sync, confirm every local agent sends the platform's official line-item ID. If no official ID exists, the agent must leave `externalLineId` empty and send stable `platformIds`; it must never synthesize an array index as an ID.
3. Run staging with a small lookback window. Compare order-line counts, quantities, SKU matches, and staging inventory movements with each platform export. Check `opsPlatformSyncRuns.processing`, especially `errors`, `manualReview`, `returnReview`, and `unmatched`.
4. After staging reconciliation, deploy to production with the same small lookback window. Sample cancellation reversals against the original `online_<lineId>` inventory ledger and confirm quantity, product, and before/after stock.
5. Expand the production lookback window only after two clean runs. Keep `manual-identity-review`, `manual-correction-review`, and data-limit failures visible as blocking work queues.
6. During the first week, reconcile daily platform units, central-stock movements, FIFO cost completeness, and monthly-only platform fees.

## Known follow-ups (not fixed in this PR)

- The existing stocktake-correction implementation does not transactionally lock and re-check the original inventory record. Its new UI entry remains disabled; redesign it before exposing correction controls.
- Store partial returns still calculate prior returned quantities from client state. Concurrent submissions and repeated FIFO-segment restoration need a separate transaction-backed cumulative-return design.
- Cancellation reversal rebuilds a summarized cost layer from the recorded order/ledger cost. Finance should sample-check legacy reversals; exact original FIFO-layer reconstruction needs a separate migration.
- Platform quantity decreases and product remaps remain `manual-correction-review` because exact legacy FIFO restoration cannot be proven safely.
- Platform return handling remains single-completion. Cumulative partial-return support was intentionally not included until its inventory and concurrency model is transaction-safe.
