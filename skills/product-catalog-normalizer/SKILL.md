---
name: product-catalog-normalizer
description: >
  Turn a messy client product list (xlsx, csv, pdf, image, Word, plain text) into a filled copy of
  an official import template, preserving the template's columns, order, styles, validations and
  sheets. Governs extraction from any source format, deterministic normalization of names,
  volumes, prices, categories and brands, a mandatory 3-record preview gate for column-mapping
  approval before writing, and an .xlsx deliverable plus a processing summary.
  Trigger: Converting a client price list or product catalog into an import template, filling a
  product template from a supplier file, normalizing product names/volumes/prices/categories/brands
  for bulk upload, extracting products from a PDF/image/Word/Excel catalog, or preparing a
  bulk product upload file for a Vendix store.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Converting a client price list or product catalog into an official import template"
    - "Filling a product import template from a supplier or client file"
    - "Normalizing product names, volumes, prices, categories or brands for bulk upload"
    - "Extracting products from a PDF, image, Word or Excel product catalog"
    - "Preparing a bulk product upload file for a Vendix store"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Product Catalog Normalizer

## Purpose

Convert an unstructured client product list into a filled copy of an **official import template**,
without inventing data and without degrading the template.

Governs: source extraction, normalization rules, column mapping, the approval gate, file
generation, and the delivery summary.

Does **not** govern: creating templates, calling the Vendix import API, pricing/margin logic
(`vendix-product-pricing`), or generating reports from Vendix data (`vendix-report-xlsx`).

## Inputs

| # | File | Role |
| --- | --- | --- |
| 1 | Official template | Defines the final shape. Its columns, order, headers, sheets, styles, validations and formulas are law. |
| 2 | Client catalog | Source of truth for the data. Any format: `.xlsx`, `.csv`, `.pdf`, image, `.docx`, `.txt`. |

If either file is missing, ask for it. Do not proceed with a guessed template.

## Critical Rules

1. **Never invent data.** No product, price, brand, volume or category that is not in the client
   file or is not an unambiguous reading of the product text. When unsure, leave the cell empty and
   report it. An empty cell is a correct answer; a plausible guess is a defect.
2. **Never change a price's magnitude.** Only its punctuation. `45.000` is `45000`, never `45`.
3. **Never alter the template's headers, column order, or sheet names.** Add no columns. If a
   column is genuinely required and absent, stop and ask.
4. **Never write the output file before the preview gate is approved** (phase 5).
5. **Deliver `.xlsx`** unless the user explicitly asks for another format.
6. **Read every sheet, page and section** of the client file. Partial extraction reported as
   complete is the worst failure mode of this skill.
7. **Batch large catalogs.** Reading 400 rows in one shot invites silent token truncation and rows
   vanish without an error. Process in chunks of ~50 and reconcile counts against the source.

## Workflow

### Phase 1 — Template preflight

```bash
python3 skills/product-catalog-normalizer/assets/inspect_template.py <plantilla.xlsx>
```

Reports sheets, header row, exact headers, example rows, data validations, merged cells, and
**what openpyxl will drop**. openpyxl preserves styles, column widths, merges, data validations,
conditional formats and defined names; it destroys charts, images, pivot tables and form controls.
If the preflight flags any of those, warn the user before continuing.

### Phase 2 — Extract everything from the client file

| Source | How |
| --- | --- |
| `.xlsx` / `.xlsm` | `extract_source.py <file>` — dumps every sheet, every row |
| `.csv` / `.tsv` / `.txt` | `extract_source.py <file>` — sniffs delimiter and encoding |
| `.xls` (legacy) | `libreoffice --headless --convert-to xlsx <file>` first |
| `.pdf` | `pdftotext -layout file.pdf -` first; if the layout is unusable or the PDF is scanned, use the **Read tool** with `pages` (max 20 per call) |
| Image | **Read tool** — it renders images visually |
| `.docx` | `textutil -convert txt file.docx -stdout` (macOS), or unzip and read `word/document.xml` |

`extract_source.py` uses `data_only=True`, so formula cells yield their cached value instead of
`=B2*1.19`. A workbook never opened in Excel has no cache and those cells come back empty — say so
rather than treating them as blank prices.

Extraction discipline:

- Dump raw first, interpret second. Do not filter while reading.
- Headers are rarely in row 1. Client files start with a title, a logo row and blank rows.
- Prices frequently live in a column named `VALOR`, `PRECIO PUBLICO`, `P.V.P` or nothing at all.
- Check for a second table further down the sheet, and for hidden sheets (`state` in the preflight).
- Count the source rows. That count is the reconciliation target for phase 6.

### Phase 3 — Deterministic normalization

```bash
python3 skills/product-catalog-normalizer/assets/normalize.py --self-test
python3 skills/product-catalog-normalizer/assets/normalize.py \
  --in raw.json --out norm.json --name-key DESCRIPCION --price-key VALOR
```

Run the code, do not normalize by hand. The rules below are exact, and per-row LLM judgment on
exact rules produces inconsistency across a 300-row catalog.

**Name** — clean → volume → title case, in that order.

| Input | Output |
| --- | --- |
| `RON VIEJO DE CALDAS 750ML` | `Ron Viejo De Caldas 750 ml` |
| `BAILEYS ORIGINAL 700 ml.` | `Baileys Original 700 ml` |
| `cerveza corona six pack 6x330ml` | `Cerveza Corona Six Pack 6x330 ml` |

Every word capitalized, including `De`. Unit tokens stay lowercase (`ml`, `l`, `cc`, `oz`).
Acronyms stay uppercase (`XO`, `VSOP`, `IPA`) — title-casing `XO` into `Xo` is wrong. Tokens
starting with a digit keep their internal letter lowercase (`6x330`). Already mixed-case tokens are
left alone.

**Volume** — always `<integer> ml`, with a space.

`750ML`→`750 ml` · `0,75 L`→`750 ml` · `1 L`→`1000 ml` · `35 cl`→`350 ml` · `1 cc`→`1 ml`.
Ounces convert at 29.5735 and are flagged as approximate. A bare `750` is reported as a
*candidate*, never converted automatically — `BOTELLA 750` becomes `750 ml` only when the agent
confirms the catalog is beverages. Multipacks keep their `6x330 ml` form; the volume is per unit.

**Price** — punctuation only, magnitude never.

| Input | Output |
| --- | --- |
| `$45.000` / `45,000` / `45.000,00` / `45 000` | `45000` |
| `COP 120.000` | `120000` |
| `1.234.567` | `1234567` |
| `120000.00` | `120000` |
| `2x45.000` / `consultar` | empty + flagged |

The disambiguation rule: with both separators, the rightmost is the decimal. With one separator
followed by exactly 3 digits it is a thousands separator; followed by 1–2 digits it is a decimal.
Two distinct numbers in one cell is ambiguous → empty + flag, never a guess.

**Category** — keyword match with accent-aware word boundaries, first match wins, specific before
generic (Champagne before Vino, Crema De Licor before Licor).

Word boundaries are mandatory, not stylistic: a substring match on `ron` fires on `Patrón`, `Cerón`
and `Ronda` and silently miscategorizes a whole catalog. Likewise, brand words that collide across
categories (`Cristal` → Agua / Cerveza / Aguardiente) are deliberately absent from the keyword map.

Vertical covered by the built-in map: Tequila, Vino, Ron, Whisky, Vodka, Ginebra, Brandy, Cognac,
Aguardiente, Aperitivo, Champagne, Espumante, Cerveza, Licor, Crema De Licor, Sangría, Vermouth,
Mezcal, Energizante, Gaseosa, Agua, Otro. For another vertical, extend `CATEGORY_RULES` in
`normalize.py` rather than classifying row by row.

Unresolved → `Otro`, or empty when the template restricts the column.

**Brand** — the one field that needs judgment.

Priority: (1) an explicit brand column in the source, verbatim; (2) the brand named in the product
text; (3) empty. `brand_candidate()` strips category words, volumes and descriptors and returns a
*hint* — confirm it, never paste it blindly. It returns empty when the brand doubles as a category
keyword (`Baileys`, `Antioqueño`), so fill those in yourself.

Never invent a brand. `Vino Tinto Reserva 750 ml` has no brand: leave it empty.

**Cleanup**, applied throughout: trim, collapse double spaces, strip control and zero-width
characters and stray leading/trailing punctuation, keep correct accents, never translate brands,
never touch client internal codes.

**Duplicates**: same name *and* same volume → one row. Different volume → distinct rows; they are
different sellable products.

### Phase 4 — Column mapping

Map source fields onto template headers. Match accent- and case-insensitively; never rename a
header. Fill required columns with the best supported information; leave the rest empty.

Volume goes into the presentation column when one exists; otherwise it must already be inside the
name (phase 3 guarantees this).

### Phase 5 — Preview gate (mandatory)

```bash
python3 skills/product-catalog-normalizer/assets/fill_template.py \
  --template <plantilla.xlsx> --rows rows.json --preview 3
```

Writes nothing. Prints the column→coverage map, unmapped keys, the count of template example rows,
and 3 fully rendered records.

Show this to the user and **wait for approval**. Client files put prices in `OBS`, mix two products
per line, and hide the real name in a "detalle" column — the coverage map (`SIN DATO`, `0/10 con
dato`) exposes exactly that before 300 rows are written wrong. Explicitly ask about anything the
preview reveals as a judgment call:

- a column showing `SIN DATO` that the user expected to be filled;
- keys reported as `NO MAPEADAS`;
- whether the template's example rows should be kept or cleared;
- generated values such as a derived SKU, if the template requires one the source lacks.

Re-run the preview after each correction. Iterate until the user approves.

### Phase 6 — Generate and validate

```bash
python3 skills/product-catalog-normalizer/assets/fill_template.py \
  --template <plantilla.xlsx> --rows rows.json --out final.xlsx --clear-existing
```

Preserves header styles, column widths, merges and number formats; inherits the template's data-row
style; extends data validations and the autofilter to the new rows; uses `keep_vba` for `.xlsm`.

Then verify, and state the result:

- row count written == row count extracted (minus reported exclusions);
- headers byte-identical to the template;
- names title-cased, volumes as `<n> ml`, prices numeric with no symbols or separators;
- the file reopens cleanly (`openpyxl.load_workbook(out)`).

### Phase 7 — Deliverables

1. The `.xlsx` file (another format only on explicit request).
2. A short summary: products processed; how many got a category; how many got a brand; rows with
   incomplete data and which field; and every judgment call made — inferred volumes, discarded
   ambiguous prices, merged duplicates, generated SKUs.

Report gaps plainly. "9 of 10 prices loaded, `Tequila Patrón Silver` said *consultar*" is the
deliverable working correctly.

## Vendix Product Template

When the template is the Vendix bulk product template (headers `Nombre`, `SKU`, `Tipo`, `Estado`,
`Controla Inventario`, `Precio Venta`, …), the importer is
`apps/backend/src/domains/store/products/products-bulk.service.ts` and it imposes:

| Column | Contract |
| --- | --- |
| `Nombre` | Required. |
| `SKU` | Required and unique per store. Duplicates inside the file are rejected. |
| `Marca` | Accepts a **brand name** (auto-created if new) or a numeric brand id. Prefer the name. |
| `Categorías` | Comma-separated **names** (auto-created) or numeric ids. |
| `Tipo` | `físico` / `servicio`. |
| `Estado` | `activo` / `inactivo`. |
| Boolean columns | `sí`/`no` — the importer also accepts `si`, `yes`, `true`, `1`, `x`, `activo`. |
| `Precio Venta` | Numeric, non-negative. |

Two further constraints: the importer reads **only the first sheet**, so products must stay on
sheet 1; and it runs a dry-run validation pass first, so upload the file and read its warnings
before committing.

When the source has no SKU, derive one deterministically (slug of the name + volume, e.g.
`RON-VIEJO-DE-750`) and **flag it in the preview** as generated. A SKU is a system identifier, not
a business fact, so deriving one is not inventing data — but the user still chooses the scheme.

## Failure Modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Prices divided by 1000 | Read `45.000` as a decimal | Use `normalize_price`; 3 digits after a lone separator means thousands |
| Whole catalog is `Ron` | Substring match without word boundaries | `detect_category` — never `if 'ron' in name` |
| Fewer rows than the source | Silent token truncation on a long read, or only the first sheet parsed | Batch by ~50 and reconcile counts against phase 2 |
| Template loses its logo | openpyxl drops drawings | Caught by the phase 1 preflight — warn before generating |
| Dropdowns dead on new rows | Validation `sqref` still covers only the example rows | `fill_template.py` extends each `sqref`; do not hand-edit |
| Prices arrive as text in Excel | Value written as a string | Write numerics as `int`/`float`, not `str` |
| `750 ml` became `750 Ml` | Title case applied before volume normalization | Order is clean → volume → title case |

## Related Skills

- `vendix-product-pricing` — pricing, cost and margin semantics once products are in the system
- `vendix-inventory-stock` — what `Controla Inventario` and initial quantity actually do
- `vendix-report-xlsx` — the reverse direction: generating xlsx from Vendix data
- `vendix-currency-formatting` — how money is displayed in-app, not how it is parsed here
- `how-to-dev` — required before changing the scripts under `assets/`
