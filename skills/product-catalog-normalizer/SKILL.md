---
name: product-catalog-normalizer
description: >
  Turn a messy client product list (xlsx/csv/pdf/image/Word/text) into a filled Vendix import
  template, with normalization and a 3-record preview gate. Trigger: /product-catalog-normalizer,
  catalog or price list to import template, bulk product upload.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
disable-model-invocation: true
---

# Product Catalog Normalizer

Inputs: (1) the official template — its columns, order, headers, sheets, styles, validations and
formulas are law; (2) the client catalog in any format. Missing either → ask. Does not create
templates, call the import API, or set pricing (`vendix-product-pricing`).

## Critical rules

1. **Never invent data.** Unsure → empty cell + report. A plausible guess is a defect.
2. **Never change a price's magnitude**, only punctuation (`45.000` → `45000`, never `45`).
3. **Never alter headers, column order or sheet names**; add no columns. Required column missing → stop and ask.
4. **Never write the output before the preview gate is approved.**
5. Deliver `.xlsx` unless another format is explicitly requested.
6. Read every sheet, page and section; partial extraction reported as complete is the worst failure.
7. Batch large catalogs (~50 rows) and reconcile counts against the source.

## Workflow (`A=skills/product-catalog-normalizer/assets`)

1. **Template preflight:** `python3 $A/inspect_template.py <plantilla.xlsx>` — sheets, header row,
   validations, merges and what openpyxl drops (charts, images, pivots, form controls → warn the user).
2. **Extract everything:** `python3 $A/extract_source.py <file>` for xlsx/xlsm/csv/tsv/txt; other
   formats per the reference. Dump raw first, interpret later; count source rows (reconciliation target).
3. **Normalize deterministically:** `python3 $A/normalize.py --self-test`, then
   `python3 $A/normalize.py --in raw.json --out norm.json --name-key DESCRIPCION --price-key VALOR`.
   Rules for name, volume (`<n> ml`), price, category, brand, cleanup and duplicates:
   `references/normalization-rules.md` (leer bajo demanda).
4. **Map columns** accent/case-insensitively, never renaming headers; volume to the presentation
   column if any, otherwise already in the name.
5. **Preview gate (mandatory):** `python3 $A/fill_template.py --template <t.xlsx> --rows rows.json --preview 3`
   writes nothing; show coverage map, `NO MAPEADAS` keys, example-row count and 3 records. Ask about
   `SIN DATO` columns, unmapped keys, keeping/clearing example rows and generated values (SKU). Re-run
   after each correction until approved.
6. **Generate:** `python3 $A/fill_template.py --template <t.xlsx> --rows rows.json --out final.xlsx --clear-existing`.
   Verify: rows written == rows extracted minus reported exclusions; headers byte-identical; names
   title-cased, volumes `<n> ml`, prices numeric; file reopens with `openpyxl.load_workbook`.
7. **Deliver** the file + summary: products processed, with category, with brand, incomplete rows and
   field, and every judgment call (inferred volumes, discarded prices, merged duplicates, generated SKUs).

## Vendix bulk product template

Importer: `apps/backend/src/domains/store/products/products-bulk.service.ts`.

| Column | Contract |
| --- | --- |
| `Nombre` | Required |
| `SKU` | Required, unique per store; duplicates inside the file are rejected |
| `Precio Venta` | **Required** (`MISSING_PRICE`), numeric, non-negative |
| `Marca` | Brand name (auto-created) or numeric id; prefer the name |
| `Categorías` | Comma-separated names (auto-created) or ids |
| `Tipo` | `físico` / `servicio` |
| `Estado` | `activo` / `inactivo` |
| Booleans | `sí`/`no` (also `si`, `yes`, `true`, `verdadero`, `1`, `x`, `activo`) |

Only the **first sheet** is read; the upload runs a dry-run validation first — read its warnings before
committing. A row without a verified price will be rejected: flag it, never fill a guess. No SKU in the
source → derive deterministically (slug of name + volume, e.g. `RON-VIEJO-DE-750`) and flag it in the
preview; the user picks the scheme.

## Related Skills

- `vendix-product-pricing`, `vendix-inventory-stock` (`Controla Inventario`), `vendix-report-xlsx` (reverse direction)
