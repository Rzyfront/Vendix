---
name: vendix-pila-flatfile
description: >
  Generation of the Colombian PILA flat file (Planilla Integrada de
  Liquidación de Aportes, Resolución 2388/2016) in Vendix: fixed-width type-1
  header and type-2 contributor records, IBC caps, novelty mapping
  (ING/RET/VSP/LMA/IGE/VAC/IRL), the positional layout serializer, and the
  export endpoint. Trigger: generating or editing the PILA flat file, its
  record layout, novelty flags, or IBC caps.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Generating or editing the PILA flat file (Resolución 2388/2016)"
    - "Working with PILA record types 1/2, positional layout, or IBC caps"
    - "Mapping PILA novelties ING/RET/VSP/LMA/IGE/VAC/IRL"
    - "Working under apps/backend/src/domains/store/payroll/pila"
---

# Vendix PILA Flat File (Res. 2388/2016)

## Purpose

Governs the official PILA flat file that reports social-security contributions
per contributor. Covers the fixed-width record layout, IBC caps, novelty
mapping, and serialization. Payroll calculation itself lives in
`vendix-payroll`; accounting of contributions lives in `vendix-accounting-rules`.

Dir: `apps/backend/src/domains/store/payroll/pila/`
- `pila-report.service.ts` — data aggregation + record building
- `pila-flat-file.layout.ts` — positional layout + serializer
- `pila-report.controller.ts` — endpoints
- `interfaces/pila-report.interface.ts` — novelty flags/dates contracts

## Generation Flow

`generateFlatFile(year, month, store_id)` (`pila-report.service.ts:890`):

1. `getContributionsForPeriod()` — aggregates non-draft/cancelled `payroll_items` per employee, applies IBC caps, marks exoneration, derives novelties.
2. `resolveAportanteIdentity()` — employer razón social + NIT via `FiscalScopeService`.
3. `buildType1Record()` (header) + one `buildType2Record()` per contributor.
4. Join with `\r\n`, trailing `\r\n`; filename `pila_${year}_${MM}.txt`.
5. `recordSubmission({ status: 'exported' })` into `pila_submissions`.

Note: `exportCsv()` (separator `;`) is a **different**, support-only output — not the official flat file.

## Record Structure (fixed-width, positional)

Layout constants + serializer in `pila-flat-file.layout.ts`; values assigned in the service.

- **Type 1 (header)** — total length **359**, `PILA_TYPE1_LAYOUT` / `buildType1Record()`. Key fields: tipo `'01'`, razón social (200, upper), tipo doc `'NI'` + NIT + DV, tipo planilla `'E'` (empleados), periods (`aaaa-mm`), total cotizantes, total IBC, tipo aportante `1`.
- **Type 2 (contributor)** — total length **686**, 97 fields, `PILA_TYPE2_LAYOUT` / `buildType2Record()`. Groups: 1–30 id + novelties, 31–35 administradora codes (emitted **blank**), 36–39 contributed days, 40–45 salary/IBC (41 = integral `'X'`), 46–63 pension/health/ARL (tarifa + value), 64–73 parafiscales (CCF/SENA/ICBF), 74–97 finals + novelty dates (76 exonerated `S/N`).

Per-contributor values: `ibc = round(emp.ibc)`, `days = clamp(worked_days,0,30)`, `pension_total`/`health_total` = employee+employer, tarifa via `computeTarifa(value, ibc) = round(value/ibc*10000)`.

## IBC Caps

`clampIbc(raw_ibc, worked_days, minimum_wage)` (`pila-report.service.ts:714`):

- floor (prorated) = `round(minimum_wage * days/30)`, `days = clamp(worked_days,0,30)`
- ceiling = `minimum_wage * 25`
- result = `round(min(max(raw_ibc, floor), ceiling))`

`calculateIbc()` (:567) = base_salary + overtime + commissions + taxable bonuses (transport subsidy excluded). SMMLV via `resolveMinimumWage()` → `PayrollRulesService.getRulesForYear`. Exoneration flag: `SMMLV>0 && ibc < 10*SMMLV && sena===0 && icbf===0`.

## Novelty Mapping

Table novelties (`payroll_novelties`, `status='applied'`, in `PILA_NOVELTY_TYPES`) via `buildNoveltyMeta()`; contract-derived novelties via `applyEmployeeNovelties()`.

| PILA code | Field | Source |
| --- | --- | --- |
| ING (ingreso) | 15 | `hire_date` within period |
| RET (retiro) | 16 | `termination_date` within period |
| VSP (var. permanente) | 21 | base_salary ≠ previous period's |
| VST (var. transitoria) | 23 | **reserved, no source → always blank** |
| SLN (licencia no rem.) | 24 | `leave_unpaid` |
| IGE (incap. general) | 25 | `incapacity_general` |
| LMA (lic. maternidad) | 26 | `maternity_leave` (paternity also maps here) |
| VAC-LR | 27 | `vacation` |
| IRL (incap. laboral) | 30 | `incapacity_laboral` (numeric, days, capped 30) |

Novelty dates go to fields 80–94.

## Export Endpoint

`pila-report.controller.ts` — `@Controller('store/payroll/pila')`, `@Get('flat-file')` = `GET store/payroll/pila/flat-file` (perm `store:payroll:runs:read`). Returns `Content-Type: text/plain; charset=utf-8` + `Content-Disposition: attachment` download. Query: `year`, `month`. Other endpoints: `report` (screen), `generate`, `export` (CSV), `submissions`.

## Serialization Rules

`pila-flat-file.layout.ts`:

- `formatPilaField(spec, value)`: type `N` → digits only, right-justified, zero-padded, **throws if it exceeds length**; type `A` → strip `\r\n\t`, truncate to length, right-pad spaces.
- `buildPilaRecord(layout, expectedLength, values)`: validates position contiguity (`spec.start === offset+1`) and total length against `expectedLength` (throws on mismatch).
- NIT helpers: `parseNit`, `computeNitDv` (módulo-11 DIAN).

## Caveats (Read Before Trusting Output)

- **Layout not validated against a certified operator.** It is based on public sources (Anexo Técnico 2 v09 2019, third-party docs). Validate a real file before production (plan Step 16).
- **`computeTarifa` decimals unconfirmed** (ARL may need more precision).
- **Administradora codes (AFP/EPS/CCF/ARL) are emitted blank** — a real submission likely needs them filled.
- **Many header fields are hardcoded** (modalidad, radicación, fecha de pago, código operador) for the operator to reassign.
- **VST always blank** (no data source).
- The class docstring at `pila-report.service.ts` still says flat-file generation is "out of scope" — that is **stale**; `generateFlatFile` does produce it. Fix the docstring if you touch that block.

## Related Skills

- `vendix-payroll` — payroll calculation, IBC, novelties (upstream of PILA).
- `vendix-accounting-rules` — PUC accounting of contributions.
- `vendix-fiscal-scope` — employer NIT / razón social resolution.
