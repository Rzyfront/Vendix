# RUT vs FE codes, PartyTaxScheme and printable calidades

## The Two Code Universes (the root of most bugs)

RUT box 53 codes and electronic-invoicing codes are **different catalogs**. They
look alike and are not interchangeable.

| | RUT box 53 (`fiscal_data.tax_responsibilities`) | FE anexo (`cbc:TaxLevelCode`) |
| --- | --- | --- |
| Size | Dozens (`O-05`, `O-07`, `O-13`, `O-14`, `O-15`, `O-23`, `O-33`, `O-42`, `O-47`, `O-48`, `O-49`, `O-50`, `O-52`, `O-55`…) | **Exactly 5** |
| Values | what the merchant declared to DIAN | `O-13`, `O-15`, `O-23`, `O-47`, `R-99-PN` |
| Purpose | source of truth for responsibility | what travels in the XML |

`O-33`, `O-48`, `O-49` and `O-50` **do not exist in electronic invoicing**.
`toDianTaxLevelCode` filtering seven declared codes down to `R-99-PN` is **correct
behaviour, not a bug** — do not "fix" it.

- `R-99-PN` is **exclusive**: it never combines with the other four.
- Multiple values join with `;` and the field caps at
  `DIAN_TAX_LEVEL_CODE_MAX_LENGTH = 30` (rule FAJ26, `1..1`).

## Issuer `PartyTaxScheme` — DIAN table 13.2.6.2

Four states, never two. Derive with `resolveDianPartyTaxScheme({vat_responsible,
inc_responsible})`:

| `vat` | `inc` | `cbc:ID` | `cbc:Name` |
| --- | --- | --- | --- |
| ✔ | ✔ | `ZA` | IVA e INC |
| ✔ | ✘ | `01` | IVA |
| ✘ | ✔ | `04` | INC |
| ✘ | ✘ | `ZZ` | No aplica |

Never reconstruct this from `tax_regime === '49'`. That binary was the defect: it
made `04` and `ZA` unreachable, so a restaurant declared itself under the IVA
scheme in a **signed** document.

## What May Be Printed

Only the **four calidades** of num. 12, art. 11, Res. DIAN 000165/2023 (restated by
Res. 000227/2025), and only «cuando corresponda»:

`O-23` agente retenedor de IVA · `O-15` autorretenedor de renta ·
`O-13` gran contribuyente · `O-47` régimen simple (SIMPLE)

- **The regime legend is deleted, not replaced.** No norm requires it: art. 506
  E.T. is derogated and art. 617 lit. i) only requires stating the RETENEDOR
  calidad. Printing «No responsable de IVA» instead is the same error with the
  sign flipped.
- If the issuer holds none of the four, **the line is not printed at all** —
  return `undefined`, never `''` (an empty string leaves a blank row on paper).
- Anexo FEV 1.9 §5.8 requires that what is printed be in the XML. A legend the XML
  does not carry is non-compliance on its own.
- Order is fixed by the enumeration, not by storage order, so two issuers with the
  same calidades print the same string and a spec can pin it.

> Res. 000042/2020 is **derogated** by art. 72 of Res. 000165/2023. Cite
> Res. 000165/2023 / Res. 000227/2025.
