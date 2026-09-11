# Store Windows agent: MOMO SKU price sync

Install `youzi_sync_agent.py` and `momo_price_sync.py` beside the existing desktop agent's `config.json` and `lib` directory. Keep credentials and library files unchanged. Never put `config.json` in this repository.

The product editor queues only changed platform prices. The bridge returns MOMO targets separately from Coupang targets for backward compatibility. The store agent uses the existing MOMO token and registered IP, queries the exact SKU, preserves its market price, submits `GoodsdtPriceModify` with Taiwan's current date, and queries the price again before reporting success. Missing market prices fail closed. The bridge rejects stale reports for prices changed while synchronization was running. Explicitly queued MOMO prices that failed are retried on the next sync.

Official contract: MOMO API v0.11.4, 2026-08-19, section 3.1; section 5 for price queries. Old `GoodsPriceModify` is not used.

Tests: `python -m unittest discover -s store-agent -p "test_*.py"` and `node --test tests/momo-price-agent.test.js`.

To reload after installation without initiating an extra order sync, stop the idle existing watcher and launch `pythonw.exe youzi_sync_agent.py watch --skip-startup-sync`. Existing scheduled tasks continue using the same script path. Do not stop a running sync.
