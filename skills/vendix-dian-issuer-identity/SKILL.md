---
name: vendix-dian-issuer-identity
description: >
  Issuer fiscal identity for Colombian e-invoicing: VAT/INC responsibility and calidades from RUT box
  53, projected into signed XML and print. Trigger: tax_responsibilities/tax_regime,
  PartyTaxScheme/TaxLevelCode, issuer fiscal status.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
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
(`vendix-product-pricing`). This skill answers *who the merchant is*, not *what
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

## Codes, PartyTaxScheme and Print (summary)

Tables and legal citations: `references/dian-codes-and-print.md` (read on demand).

- RUT box 53 codes and FE `cbc:TaxLevelCode` are different catalogs. FE accepts only `O-13`, `O-15`, `O-23`, `O-47`, `R-99-PN` (`R-99-PN` exclusive; `;`-joined, max 30 chars). `O-33`/`O-48`/`O-49`/`O-50` do not exist in FE: `toDianTaxLevelCode` collapsing to `R-99-PN` is correct.
- Issuer `PartyTaxScheme` has four states via `resolveDianPartyTaxScheme({vat_responsible, inc_responsible})`: `ZA` (IVA e INC), `01` (IVA), `04` (INC), `ZZ` (No aplica). Never derive it from `tax_regime === '49'`.
- Print only the four calidades `O-23`, `O-15`, `O-13`, `O-47` (Res. DIAN 000165/2023, restated by 000227/2025), in fixed enumeration order, only if held; none → return `undefined` (no line), never `''`. No regime legend and no «No responsable de IVA». What is printed must be in the XML. Res. 000042/2020 is derogated.

## Source of Truth

- `apps/backend/src/common/helpers/vat-responsibility.helper.ts` — `resolveVatResponsibility`, `resolveIncResponsibility`, `isVatResponsible`, `isIncResponsible`, `resolveFiscalResponsibilityFlags`, `assertCanChargeVat`
- `apps/backend/src/common/constants/fiscal-responsibilities.ts` — `normalizeFiscalResponsibilityCode`
- `apps/backend/src/common/helpers/fiscal-identity.helper.ts` — `resolveTenantFiscalIdentity`, `projectTenantIdentityToDian`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/constants/dian-tax-codes.ts` — `DIAN_PARTY_TAX_SCHEMES`, `resolveDianPartyTaxScheme`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/constants/dian-tax-level-codes.ts` — `DIAN_TAX_LEVEL_CODES`, `toDianTaxLevelCode`, `DIAN_TAX_LEVEL_CODE_MAX_LENGTH`
- `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.ts` — `buildSupplierParty` (serves invoice, credit note, debit note, POS equivalent document and support document)
- `apps/backend/src/domains/store/print-formats/services/fiscal-issuer-identity.ts` — `PRINTABLE_FISCAL_QUALITIES`, `resolveFiscalQualitiesLine` (**sole owner** of the printed line)

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
