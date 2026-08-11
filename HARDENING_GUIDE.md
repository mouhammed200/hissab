# Atomic posting update

Run migration `004_atomic_post_record.sql` after migrations 002 and 003. The confirmation route now makes one RPC call only. PostgreSQL owns contact/invoice/items/journal/audit inserts in one transaction, and the `Idempotency-Key` prevents duplicate retries.

If any insert fails, the whole transaction rolls back. Existing historical duplicate records are not removed automatically.

Run:

```bash
npm install
npm run build
node tests/smoke.test.mjs
```
