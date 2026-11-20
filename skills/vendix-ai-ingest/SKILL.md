---
name: vendix-ai-ingest
description: >
  Common AI file-reading pipeline (common/ai-ingest): sheets mapped deterministically, PDF/photos
  by pages with native text first, JSON schema + ajv + repair + split on length, AI_INGEST_* errors,
  caps and observability. Trigger: adding or changing an AI load/scanner that reads files.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding an AI import or scanner that reads a sheet, PDF or photo"
    - "Adding an ai-ingest profile (IngestProfile / DocumentIngestProfile)"
    - "Changing page/row caps, batches or the repair/split policy of an AI load"
    - "Mapping AI extraction failures to a scanner's own error codes"
    - "Debugging why an AI load failed, was cut (finish_reason length) or did not validate"
---

## Source of Truth

- `apps/backend/src/common/ai-ingest/` (`AiIngestModule`): `ingest-file.detector.ts`, `sheets/`, `documents/`, `images/image-prep.ts`, `extraction/`, `profiles/`.
- Reference consumers: customers (`customers/ai-import/customer-ingest.profile.ts`, list), purchase invoice (`orders/purchase-orders/purchase-invoice-ingest.profile.ts`, document), fiscal forms (`invoicing/fiscal-scanners.ingest.spec.ts`).

## Pipeline (never skip a step)

1. **Detect by bytes** (`detectIngestFile`), never by the client mimetype; reject unknown types with `AI_INGEST_UNSUPPORTED_TYPE`.
2. **Sheets → AI only maps.** `SheetParserService` reads xlsx/csv with hard caps (`sheetRowCap(maxRows)`, `MAX_COLUMNS = 200`, `MAX_CSV_LINE_CHARS`). Columns map by `columnSynonyms` (accent-free); at most ONE AI call maps the headers (`columnMappingSchema`) when required/wanted groups stay uncovered. Rows are normalized by `normalizeRow` in code; the model never re-types rows.
3. **Documents by pages, native text first.** `DocumentPagesService.prepareForAi`: a PDF page with native text goes as text (`classifyPageText`), a scanned page as an image; photos are straightened (EXIF) and resized to `AI_IMAGE_MAX_EDGE` (tall photos in strips). Fiscal forms use `renderTextPages` (text + image). Never send a raw PDF (`data:application/pdf`) to the model.
4. **Extraction** (`AiExtractionService`): `run(appKey, vars, messages, { responseSchema, quotaKey, logContext })`; ajv validates (lenient schema, strict one to the provider, opt-in `supports_json_schema`); invalid → ONE repair call with the ajv errors; `finish_reason === 'length'` → the batch is halved (depth ≤ 3) and the halves know they are partial; still cut → `AI_INGEST_INCOMPLETE`.
5. **Merge** (`readDocumentWithAi` / `readDocumentsWithAi`, `mergeFormAnswers`): header from the first batch, totals from the last, a repeated boundary line counted once with a warning; never recompute money.
6. **Background only**: through the `ai-scan` queue (`vendix-ai-queue`) with real progress (`reportProgress` by rows/pages) and preview before saving.

## Adding a profile

1. Pick `mode`: `list` (`IngestProfile`: records, `columnSynonyms`, `requiredFields`, `normalizeRow`, `dedupeKey`/`merge`) or `document` (`DocumentIngestProfile`: `documentSchema`, page caps). Add its key to `IngestProfileKey`.
2. Prompt and model live in `ai_engine_applications` (`appKey`); never change the linked model, seeds or `max_tokens` from a profile PR.
3. Register in the service `onModuleInit` (`IngestProfileRegistry.register` throws on duplicates); import `AiIngestModule` in every module that provides the scanner.
4. One `newIngestQuotaKey()` per load: every batch, repair and split shares it (one quota unit per load).
5. Keep the scanner's error contract with `toScannerError(error, { parseFail, aiFail })`: invalid → `*_PARSE_FAIL`, provider → `*_AI_FAIL` with its message, credits/rate limit → `AI_PROVIDER_003/004`. `AI_INGEST_*` (`NO_PAGES`, `TOO_MANY_PAGES`, `UNSUPPORTED_TYPE`, `INVALID_FILE`, `PARSE_FAIL`, `INCOMPLETE`) travel untouched; the frontend shows them as "No pudimos leer tu documento".

## Caps (defaults; change only with a business decision)

| Input | Cap |
|---|---|
| Sheets | `maxRows` per profile (5.000 customers), 200 columns |
| PDF / photos | `DEFAULT_MAX_PDF_PAGES = 10` per file; multi-file documents also cap the total (invoice draft: 10 per file, 20 total) |
| Batch | `rowsPerBatch` / `pagesPerBatch`, concurrency 3 |
| Image | 1536 px edge, 40 MP input, ≤ 10 strips |

## Observability

Every `run()` row in `ai_engine_logs` carries `finish_reason`, and ai-ingest calls add `attempt` (1 first, +1 repair, +1 per split level) and `validation_error` (ajv paths or `not_json`, never the model text, ≤ 500 chars). Super admin → Motor de IA → **Salud por app** (`GET superadmin/ai-engine/app-health`) shows % error, % cut and % validation per `app_key`. Logging never breaks a load.

## Tests

- Specs per profile with a fixed answer: the normalized output (amounts, taxes, fiscal fields) must stay identical to the old path.
- Mock `AIEngineService` (`jest.mock(... { AIEngineService: class {} })`) to avoid type-checking the whole engine graph.
- Every new spec goes into the literal `--runTestsByPath` list of its job in `.github/workflows/ci.yml` (documental P4 for `common/ai-ingest`, Flujos P1 for domain scanners).

## Related Skills

`vendix-ai-queue`, `vendix-ai-engine`, `vendix-bulk-operations`, `vendix-error-handling`.
