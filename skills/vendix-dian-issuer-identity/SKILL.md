---
name: vendix-dian-issuer-identity
description: >
  Issuer fiscal identity for Colombian electronic invoicing: who the merchant IS
  (VAT-responsible, INC-responsible, which printable calidades), how that is
  derived from RUT box 53, and how it projects into the signed XML and the graphic
  representation. Trigger: Reading or writing tax_responsibilities / tax_regime,
  editing PartyTaxScheme or TaxLevelCode, printing anything about the issuer's
  fiscal status, or debugging an invoice that declares an obligation the merchant
  does not have.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Reading or writing fiscal_data.tax_responsibilities or tax_regime"
    - "Editing cac:PartyTaxScheme, cbc:TaxLevelCode or the issuer party block in UBL"
    - "Printing the issuer's fiscal status on an invoice, ticket or PDF"
    - "Debugging an invoice that declares an obligation the merchant does not have"
    - "Deciding whether a merchant may charge IVA or INC"
    - "Adding a new RUT responsibility code to forms, scanners or seeds"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix DIAN Issuer Identity

## Purpose

Governs the **issuer's fiscal identity**: whether the merchant is responsible for
IVA, for INC, for both or neither; which calidades may be printed; and how those
answers reach `cac:PartyTaxScheme`, `cbc:TaxLevelCode` and the paper.

Does **not** govern the classification of a *tax* (`vendix-tax-typing`), which NIT
owns an accounting entity (`vendix-fiscal-scope`), or tax math
(`vendix-calculated-pricing`). This skill answers *who the merchant is*, not *what
the tax is*.

## Core Rules

- **The declared list beats the inferred regime.** A non-empty
  `fiscal_data.tax_responsibilities` (RUT box 53) is **total authority**.
  `tax_regime` is consulted **only** when that list is empty or absent.
- **A full box 53 without `O-48` is a declaration of non-responsibility**, not a
  gap for the regime to fill. It is conclusive (`declared_without_vat_code`), not
  indeterminate — no wizard CTA.
- **`tax_regime` is derogated vocabulary.** «Régimen común» and «simplificado»
  were abolished by Ley 1943/2018 art. 18 and Ley 2010/2019 art. 20, replaced by
  the responsable/no-responsable dichotomy. What is stored today is legacy dragged
  in by seeds and forms — **the RUT has no regime box**. Never add a new reader of
  `tax_regime`, and never default it in a form.
- **IVA and INC are independent axes of the same box 53.** `O-48` affirms IVA,
  `O-49`/`O-53` deny it; `O-33` affirms INC, `O-50` denies it. Never gate one on
  the other's predicate. There is **no regime fallback for INC**: COMUN/SIMPLIFICADO
  never spoke about INC, so inferring it would be invention.
- **Art. 426 E.T.**: serving food and drink is EXCLUDED from IVA and subject to INC.
  A restaurant without a franchise contract cannot be IVA-responsible for that
  service, so inferring it from a stale `tax_regime` asserts something the law
  forbids.
- **Normalize before comparing.** `resolveTenantFiscalIdentity` does NOT normalize;
  a tenant that stored `'13'` instead of `'O-13'` loses its calidad in silence.
  Always run `normalizeFiscalResponsibilityCode` first.
- Fail-closed: no signal at all ⇒ `responsible: false`, `indeterminate: true`.

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

## Source of Truth

- `apps/backend/src/common/helpers/vat-responsibility.helper.ts` — `resolveVatResponsibility`, `resolveIncResponsibility`, `isVatResponsible`, `isIncResponsible`, `resolveFiscalResponsibilityFlags`, `assertCanChargeVat`
- `apps/backend/src/common/constants/fiscal-responsibilities.ts` — `normalizeFiscalResponsibilityCode`
- `apps/backend/src/common/helpers/fiscal-identity.helper.ts` — `resolveTenantFiscalIdentity`, `projectTenantIdentityToDian`
- `.../dian-direct/constants/dian-tax-codes.ts` — `DIAN_PARTY_TAX_SCHEMES`, `resolveDianPartyTaxScheme`
- `.../dian-direct/constants/dian-tax-level-codes.ts` — `DIAN_TAX_LEVEL_CODES`, `toDianTaxLevelCode`, `DIAN_TAX_LEVEL_CODE_MAX_LENGTH`
- `.../dian-direct/xml/ubl-common.builder.ts` — `buildSupplierParty` (serves invoice, credit note, debit note, POS equivalent document and support document)
- `.../print-formats/services/fiscal-issuer-identity.ts` — `PRINTABLE_FISCAL_QUALITIES`, `resolveFiscalQualitiesLine` (**sole owner** of the printed line)

## Decision Rules

| Situation | Action |
| --- | --- |
| Need to know if a merchant may charge IVA | `isVatResponsible` / `assertCanChargeVat`. Never read `tax_regime` directly |
| Need to know if a merchant owes an INC return | `isIncResponsible`. Never reuse the IVA predicate |
| Emitting the issuer party block | `resolveDianPartyTaxScheme(flags)` — four states |
| Emitting `cbc:TaxLevelCode` | `toDianTaxLevelCode(list)`; expect most tenants to collapse to `R-99-PN` |
| Printing the issuer's fiscal status | `resolveFiscalQualitiesLine`; omit the line when it returns `undefined` |
| Adding a new surface that prints the issuer | Import the shared function. Web/mobile replicate it under their own specs (`mobile-dev` RULE 4 forbids cross-app imports) |
| A tenant charges IVA but has no `O-48` | Fix the **data** (add `O-48` to box 53), never the resolver |
| A form or scanner needs a regime value | It does not. The RUT has no regime box — do not default `tax_regime` |

## Anti-Patterns

- Defaulting `tax_regime` to `'COMUN'` in a `nonNullable` FormControl that is always
  PATCHed. Writing only a NIT then persists a responsibility nobody declared.
- Prompting an AI RUT scanner to choose among regimes the document does not contain.
- A second copy of the printed label. There were **four** divergent copies, one of
  which printed the false legend on Vendix's own SaaS invoices and only surfaced
  when the typecheck broke.
- A validator that **requires** the derogated legend to approve a print format.
- Gating `inc_return` on `isVatResponsible`.
- Reading only `tax_responsibilities[0]` — it discards every code but the first.

## Related Skills

- `vendix-tax-typing` — the `tax_type` of a *tax*; this skill is the identity of the *issuer*
- `vendix-fiscal-scope` — which NIT owns the accounting entity the identity is read from
- `vendix-accounting-rules` — PUC accounts the classification lands on (IVA `2408`, INC `2436`)
- `vendix-prisma-migrations` — remediating persisted `fiscal_data` requires a versioned migration
