# Third-party snapshot and intercompany entries

## Third-Party Snapshot On Journal Lines

`accounting_entry_lines` carries an optional, denormalized third-party snapshot:
`third_party_id`, `third_party_type`, `third_party_name`, `third_party_tax_id`.
These are populated from an `AutoEntryThirdParty` object attached to individual
`AutoEntryLine`s (e.g. the AP line in `onPurchaseOrderReceived` carries the
`supplier` third party; the AR/revenue line in `onInvoiceValidated` can carry the
`customer`).

- **It is a historical snapshot, never a live lookup.** `createAutoEntry` reads
  `line.third_party?.id/.type/.name/.tax_id` directly from the payload the
  emitter already attached — it does NOT query `suppliers`/`users`/`customers`
  here. Emitters must resolve and attach the third party themselves (e.g.
  `purchase-orders.service.ts` already loads `result.updated_po.suppliers`) and
  pass it through the event payload; do not add a lookup inside
  `AutoEntryService`.
- Optional per line — most lines (cash, inventory, tax lines) have no
  counterparty and leave all four fields `null`.
- Used for third-party-hierarchical auxiliary books/ledgers (`libros
  auxiliares por tercero`) added in this epic's Ola 3 hydration pass; wired on
  purchase (`supplier`) and sales/invoice (`customer`) flows so far — extend the
  same pattern (attach `AutoEntryThirdParty` on the relevant line) when a new
  flow needs its counterparty to show up in third-party reports.

## Intercompany Stock Transfer Entries

When `operating_scope=ORGANIZATION` and `fiscal_scope=STORE`, a cross-store stock transfer is operationally allowed but fiscally intercompany. The `stock_transfer.completed` listener calls `AutoEntryService.onStockTransferCompleted()`, which branches to intercompany handling through `FiscalScopeService.isIntercompanyTransfer()`.

Required mapping keys:

- `intercompany_transfer.shipped.receivable` — debit CxC vinculados, default PUC `1365`.
- `intercompany_transfer.shipped.inventory` — credit inventory from source store, default PUC `1435`.
- `intercompany_transfer.received.inventory` — debit inventory in destination store, default PUC `1435`.
- `intercompany_transfer.received.payable` — credit CxP vinculados, default PUC `2355`.

Rules:

- Create two posted accounting entries, one for the source store entity and one for the destination store entity.
- Link them through `intercompany_transactions` with `origin='stock_transfer'`, `source_type='stock_transfer'`, and `source_id=transfer_id`.
- If fiscal scope is ORGANIZATION or source/destination stores are the same/missing, fall back to the normal stock-transfer entry.
- Log when stock-transfer auto-entry flow is disabled or when a transfer is not intercompany; silent skips make accounting diagnosis difficult.

