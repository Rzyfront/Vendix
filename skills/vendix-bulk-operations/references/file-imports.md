# Bulk file imports (XLSX/CSV)

Detail of `vendix-bulk-operations`. Read on demand.

Reference: `products-bulk.service.ts` (analyze → S3 session → paged commit),
`bulk-upload-modal.component.ts`, `pop-bulk-data-modal.component.ts`.

- **Header matching:** `parseFile` normalizes headers (trim + lowercase + NFD,
  accents stripped) before looking them up in `HEADER_TRANSLATIONS`. Keys MUST
  be accent-free (`'codigo de barras'`, not `'código de barras'`). A header that
  is missing from the map is dropped silently, which is how a column "works in
  the template" yet never persists.
- **Codes are text, not numbers:** barcode, NIT, phone and similar cells come
  back from `.xlsx` as `number`. Convert with `String(v)` only when
  `Number.isSafeInteger(v)`. Reject scientific notation (`/e[+-]?\d+$/i`) with
  a row error asking the user to format the column as text. Format the
  template column as text (`z: '@'` in SheetJS; `numFmt = '@'` in ExcelJS) so
  leading zeros survive. A number Excel has already rounded cannot be
  recovered.
- **Never pad a template with empty cells:** writing `{t:'s', v:''}` to
  pre-format a column makes `sheet_to_json` read those rows as non-empty, and
  the re-uploaded file carries hundreds of phantom rows. Format only rows that
  hold data. In the reader, drop rows whose cells are all empty strings.
- **Paged session commit:** `POST .../upload-session {session_id, offset?, limit≤100}`
  re-parses the S3 file on each page (parsing is deterministic) and processes
  `slice(offset, offset+limit)`. `row_number` is the source sheet row stored
  by `parseFile` (`__row_number`); fall back to `offset + rowIndex + 2` only
  for payloads that did not come from a file. Delete
  the S3 file only on `done`. Without offset/limit the request keeps the
  legacy full commit. The client walks the pages with `expand` so the
  server's `total` wins, with `catchError` per page. On close it cancels the
  session and unsubscribes in `destroyRef.onDestroy`, never through
  `complete`.
- **The commit re-reads the WHOLE file:** the session commit parses every row
  again, including the ones the analysis marked `error`. A check that lives only
  in `analyzeProducts` is cosmetic. Put the pure checks in one helper
  (`validateVariantRows`) and call it from both analyze and `uploadProducts`
  (`assertFileVariantsValid`), throwing per row before any write.
- **Parent/child rows (product variants):** a row with `SKU Padre` is a variant
  of the product in the SAME file with that SKU (case-insensitive, parent before
  or after). `Atributo N`/`Valor N` (1–3) become `attributes`
  (`Record<string,string>`, same shape as the product editor). Group in
  `parseFile` (`groupVariantRows`) so analysis, commit and paging see the same
  tree and a page never splits a family. An orphan becomes its own item with
  `VARIANT_PARENT_NOT_FOUND` and is `skipped` at commit. A variant with no price
  inherits (no `price_override`). Product-only columns on a variant row raise a
  warning; they are not silently ignored.
- **Persist children through the owner service, atomically:** new parent →
  `variants` inside the `ProductsService.create` DTO (same transaction).
  `product_variants` has no cascade, so create-then-add-children leaves a parent
  that cleanup cannot delete. Existing parent → upsert by SKU
  (`upsertVariantsBySku`). NEVER pass `variants` to `ProductsService.update`:
  it deletes every variant missing from the array. `createVariant` does not
  check tiers ⊕ variants, so the bulk path asserts it
  (`assertVariantsAllowedOnExisting`).
- **Export mirrors import:** `exportCurrentProductsAsTemplate` writes one row
  per variant after its parent, so export → edit → re-upload round-trips.
- **Batch only where there is real cost:** parsing ≤1000 rows in memory
  (POP) takes milliseconds, and a progress bar there is cosmetic. Page the
  server round-trips, not local maps.

