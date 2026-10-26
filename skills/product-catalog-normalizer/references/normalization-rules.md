# Normalization rules (implemented in `assets/normalize.py`)

Run the code; do not normalize by hand. Order: clean → volume → title case.

## Extraction details

- `.xls` legacy: `libreoffice --headless --convert-to xlsx <file>` first.
- `.pdf`: `pdftotext -layout file.pdf -`; scanned or unusable layout → Read tool with `pages` (max 20/call).
- Image: Read tool. `.docx`: `textutil -convert txt file.docx -stdout` (macOS) or unzip `word/document.xml`.
- `extract_source.py` uses `data_only=True`: formula cells yield cached values; a workbook never opened
  in Excel has no cache and those cells come back empty — say so, do not treat them as blank prices.
- Headers are rarely in row 1 (titles, logos, blanks). Prices hide in `VALOR`, `PRECIO PUBLICO`,
  `P.V.P` or unnamed columns. Look for a second table lower in the sheet and hidden sheets (`state` in the preflight).

## Name

| Input | Output |
| --- | --- |
| `RON VIEJO DE CALDAS 750ML` | `Ron Viejo De Caldas 750 ml` |
| `BAILEYS ORIGINAL 700 ml.` | `Baileys Original 700 ml` |
| `cerveza corona six pack 6x330ml` | `Cerveza Corona Six Pack 6x330 ml` |

Every word capitalized (including `De`); unit tokens lowercase (`ml`, `l`, `cc`, `oz`); acronyms stay
uppercase (`XO`, `VSOP`, `IPA`); digit-led tokens keep internal letters lowercase (`6x330`); mixed-case
tokens untouched.

## Volume — always `<integer> ml`

`750ML`→`750 ml` · `0,75 L`→`750 ml` · `1 L`→`1000 ml` · `35 cl`→`350 ml` · `1 cc`→`1 ml`. Ounces ×29.5735,
flagged approximate. A bare `750` is only a *candidate* (convert only once the catalog is confirmed as
beverages). Multipacks keep `6x330 ml` (per-unit volume).

## Price — punctuation only, never magnitude

| Input | Output |
| --- | --- |
| `$45.000` / `45,000` / `45.000,00` / `45 000` | `45000` |
| `COP 120.000` | `120000` |
| `1.234.567` | `1234567` |
| `120000.00` | `120000` |
| `2x45.000` / `consultar` | empty + flagged |

Both separators → the rightmost is decimal. One separator + exactly 3 digits → thousands; + 1–2
digits → decimal. Two numbers in one cell → empty + flag.

## Category

Keyword match with accent-aware word boundaries, first match wins, specific before generic
(Champagne before Vino, Crema De Licor before Licor). Substring matching is forbidden (`ron` hits
`Patrón`, `Ronda`). Ambiguous brand words (`Cristal`) are excluded from the map. Built-in vertical:
Tequila, Vino, Ron, Whisky, Vodka, Ginebra, Brandy, Cognac, Aguardiente, Aperitivo, Champagne,
Espumante, Cerveza, Licor, Crema De Licor, Sangría, Vermouth, Mezcal, Energizante, Gaseosa, Agua, Otro.
Other verticals: extend `CATEGORY_RULES` in `normalize.py`. Unresolved → `Otro`, or empty when the
template restricts the column.

## Brand (judgment)

Priority: explicit brand column verbatim → brand named in the text → empty. `brand_candidate()` is a
hint (strips category words, volumes, descriptors) and returns empty when the brand doubles as a
category keyword (`Baileys`, `Antioqueño`): fill those yourself. `Vino Tinto Reserva 750 ml` has no brand.

## Cleanup and duplicates

Trim, collapse spaces, strip control/zero-width chars and stray edge punctuation, keep accents, never
translate brands, never touch client codes. Same name + same volume → one row; different volume →
different products.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Prices ÷1000 | `45.000` read as decimal | `normalize_price` |
| Whole catalog `Ron` | Substring match | `detect_category` |
| Fewer rows than source | Truncated long read or first sheet only | Batches of ~50, reconcile counts |
| Template loses logo | openpyxl drops drawings | Preflight warning |
| Dead dropdowns on new rows | Validation `sqref` not extended | `fill_template.py` extends it |
| Prices as text | Written as `str` | Write `int`/`float` |
| `750 Ml` | Title case before volume | Keep the order |
