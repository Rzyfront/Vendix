---
name: vendix-payroll
description: >
  Colombian payroll domain in Vendix: the payroll_runs and settlement state
  machines, the calculation engine (IBC caps, FSP, Ley 1607 exoneration,
  integral salary, art.383 withholding), novelty valuation, final settlement
  indemnification, DIAN electronic payroll (DSPNE), and the accounting events
  it emits. Trigger: working under apps/backend/src/domains/store/payroll, or
  editing payroll calculation, run/settlement state, novelties, advances,
  DIAN payroll, or bank export.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Editing payroll calculation, IBC, FSP, exoneration, or integral salary logic"
    - "Changing the payroll_runs or settlement state machine or its events"
    - "Working with payroll novelties, incapacity valuation, or final settlements"
    - "Working with DIAN electronic payroll (DSPNE), CUNE, or adjustment note 103"
    - "Working under apps/backend/src/domains/store/payroll"
---

# Vendix Payroll (Colombia)

## Purpose

Governs the Colombian payroll domain: how a `payroll_runs` moves through its
states, how the engine computes IBC / deductions / employer costs / provisions,
how novelties are valued, how final settlements and indemnification work, and
how DIAN electronic payroll (DSPNE) is emitted. It does NOT own the journal
entries themselves (see `vendix-accounting-rules` for PUC codes and debit/credit,
`vendix-auto-entries` for the listener/service wiring) nor the PILA flat file
(see `vendix-pila-flatfile`).

Base dir: `apps/backend/src/domains/store/payroll/`. Schema: `apps/backend/prisma/schema.prisma`.

## State Machine (payroll_runs)

Enum `payroll_status_enum` (`schema.prisma:3836`): `draft, calculated, approved, sent, accepted, rejected, paid, cancelled`.

Flow service: `payroll-runs/payroll-flow.service.ts` (`PayrollFlowService`). Valid transitions (`VALID_TRANSITIONS`):

- `draft → calculated | cancelled`
- `calculated → approved | draft | cancelled`
- `approved → sent | paid | cancelled`
- `sent → accepted | rejected | paid`
- `accepted → paid`
- `rejected → draft`
- `paid`, `cancelled` are terminal

Always validate through `validateTransition()` (throws `VendixHttpException(PAYROLL_STATUS_001)`). Do not mutate `status` directly.

### Events emitted (EventEmitter2) — consumed by accounting

- `calculate()` → `payroll.calculated` `{ payroll_run_id, employee_count }`.
- `approve()` → **no event** (approval only stamps `approved_by_user_id`/`approved_at`).
- `send()` → on success persists withholdings + emits DIAN-accepted accounting.
- `pay()` → `payroll.paid` with a rich payload (per-item earnings/deductions/employer_costs/provisions/net_pay). This is the payment-side accounting trigger.
- `emitPayrollDianAcceptedAccounting()` → `payroll.dian_accepted` (totals, health/pension deductions, retention, `cost_center_breakdown`). This is the accrual-side trigger on the electronic path.
- Settlement flow emits `settlement.calculated | approved | paid`.

Retention idempotency: `persistAcceptedRunWithholdings()` only writes `withholding_calculations` (concept `RTE_SALARIOS`) when `previous_dian_status !== 'accepted'`.

## Calculation Engine

Rules/constants: `calculation/colombian-rules.ts`. Engine: `calculation/payroll-calculation.service.ts` (`PayrollCalculationService.calculateForRun` → pure `calculateEmployeePayroll()`).

Critical legal rules (all in `colombian-rules.ts`):

- **IBC caps**: floor `1 SMMLV`, ceiling `25 SMMLV`, prorated by worked-days proportion. Integral salary contributes on **70%** (`INTEGRAL_IBC_FACTOR = 0.7`).
- **FSP** (Fondo de Solidaridad Pensional): only for IBC ≥ `4 SMMLV`; tiered rate via `getFspRate(ibc_in_smmlv)` (4–16→1%, then 1.2%…2% ≥20 SMMLV); split solidaridad/subsistencia.
- **Ley 1607 art.114-1 exoneration**: when `ibc_in_smmlv < 10`, employer health (8.5%), SENA (2%) and ICBF (3%) are **zeroed**; employer pension (12%), ARL and CCF (4%) are always paid.
- **Provisions** base = `ibc_base × integral_factor` (NOT capped at 25 SMMLV): cesantías (1/12), interest on cesantías (12%), vacation (15/360), service bonus (1/12).
- **Salary withholding (retefuente)** art.383/386 + art.387 deductions: `calculation/retefuente-art383.ts` (`calculateLaborWithholding`), needs UVT (`payroll_rules_service.getUvtValueForYear`); legacy 1% fallback only when no UVT.

Employee deductions: health 4%, pension 4%, plus FSP. Employer costs and provisions are itemized per concept (health/pension/ARL/SENA/ICBF/CCF + 4 provisions) so the accounting builder can map each to its PUC subaccount.

## Novelties

Valuation: `calculation/novelty-valuation.ts` (pure `valuateNovelty`). Enum `payroll_novelty_type_enum` (`schema.prisma:3934`). Invariant: `amount === employer_amount + reimbursable_amount`.

- **incapacity_general**: days 1–2 at 66.67% employer cost; day 3+ reimbursable by **EPS** (daily floor `SMMLV/30`).
- **incapacity_laboral**: 100% from day 1, reimbursable by **ARL**, never employer cost.
- **maternity_leave / paternity_leave**: 100%, `employer_amount = 0`, fully reimbursable by EPS.
- **vacation / leave_paid / bereavement_leave (luto)**: full daily value, entirely employer, no reimbursement.
- **leave_unpaid**: `days_adjustment`, amount 0 (reduces worked days → prorates the base).
- **bonus/commission** = manual earning; **other_deduction** = manual deduction.

Service: `novelties/novelties.service.ts` (`findPendingForPeriod`, `attachToRun`, `releaseFromRun` — cancelling a run releases its novelties).

## Final Settlement & Indemnification

Service: `settlements/settlement-calculation.service.ts` (`calculateSettlement`). State enum `settlement_status_enum` (draft, calculated, approved, paid, cancelled); flow `settlements/settlement-flow.service.ts` (paying also terminates the employee in the same tx).

Indemnification (Art.64 CST, `calculateIndemnification`) only when `termination_reason === 'without_just_cause'`, branched by `contract_type`:

- **fixed_term**: salaries for the remaining time up to `contract_end_date` (returns 0 + warn if the date is missing).
- **obra_labor**: remaining time, minimum 15 days.
- **apprentice / service**: 0.
- **indefinite / default**: `≤10 SMMLV` → 30 days first year + 20/year; `>10 SMMLV` → 20 + 15/year.

All day math is 30/360 (`calculateWorkedDays360`).

## DIAN Electronic Payroll (DSPNE)

Dir: `providers/dian-payroll/`. `DianPayrollProvider` (implements `PayrollProviderAdapter`) orchestrates per-employee send: loads `configuration_type='payroll'`, maps to Nómina structure, builds XML, signs `.p12`, ZIP+base64, SOAP `SendNominaSync`.

- `xml/nomina-individual.builder.ts` → `NominaIndividual` (TipoXML 102), returns `{ xml, cune }`.
- `xml/nomina-adjustment.builder.ts` → `NominaIndividualDeAjuste` **type 103** with `<ReemplazandoPredecesor>` (original CUNE); `TipoNota` 1=replace / 2=delete.
- `cune-calculator.ts` → CUNE = SHA-384 of concatenated fields.
- Shares `DianSoapClient`, `DianXmlSignerService`, `FiscalProductionReadinessService` with invoicing (`store/invoicing/providers/dian-direct/*`) — do not rebuild these.
- Generic adapter: `providers/payroll-provider.interface.ts` (`PAYROLL_PROVIDER`), with `mock-payroll.provider.ts` for dev.

Run-level DIAN actions live on `PayrollFlowService`: `sendToDian`, `getDianStatus` (may transition `sent→accepted|rejected`), `sendAdjustment`.

## Key Models (schema.prisma)

`employees` (contract_type, contract_end_date, salary_type, base_salary, EPS/pension/CCF, termination_*), `employee_stores` (N:M multi-store), `employee_fiscal_profiles` (art.387 dependents/deductions, retention_procedure), `payroll_runs` (status, DIAN fields, `applied_rules` snapshot, `accounting_entry_id`), `payroll_items` (per-employee JSON earnings/deductions/employer_costs/provisions, per-item DIAN fields), `payroll_novelties`, `payroll_settlements`, `employee_advances` (note: **not** "payroll_advances") + `employee_advance_payments` + `employee_advance_installments`, `pila_submissions`, `payroll_system_defaults` (yearly legal rules JSON), `uvt_values`, `withholding_calculations` (RTE_SALARIOS).

## Key Endpoints

- Runs `store/payroll/runs`: `POST :id/calculate`, `PATCH :id/approve|send|pay|cancel`, `POST :id/send-dian`, `GET :id/dian-status`, `GET :id/validate-bank-data`, `POST :id/items/:itemId/send-adjustment`, `POST :id/export-ach`, `GET bank-export/banks`.
- Employees `store/payroll/employees` (+ `/bulk`, fiscal-profile), Novelties `store/payroll/novelties`, Advances `store/payroll/advances`, Settlements `store/payroll/settlements`, Rules `store/payroll/rules`, Paystubs, Settings, PILA `store/payroll/pila`.

## Decision Rules

| Situation | Use |
| --- | --- |
| Which PUC account / debit-credit for a payroll entry | `vendix-accounting-rules` |
| Wiring the event listener / auto-entry service | `vendix-auto-entries` |
| PILA flat file (Res. 2388/2016) | `vendix-pila-flatfile` |
| art.383/387 withholding math detail | read `calculation/retefuente-art383.ts` |
| Schema/migration change to employee/contract fields | `vendix-prisma-schema`, `vendix-prisma-migrations` |

## Known Gaps

- No `is_exonerated` flag in schema — exoneration is decided purely by the 10-SMMLV threshold (`TODO(exoneration-flag)` in `payroll-calculation.service.ts`). Assumed applicable for SAS/Ltda.
- PILA rates/structure not yet validated against a certified operator file (see `vendix-pila-flatfile`).
- Some GET controllers return an error object with HTTP 200 instead of throwing (body-404 pattern) — prefer throwing `VendixHttpException`.

## Related Skills

- `vendix-accounting-rules` — PUC codes and debit/credit for payroll entries.
- `vendix-auto-entries` — event listener + AutoEntryService wiring.
- `vendix-pila-flatfile` — social-security flat file.
- `vendix-tax-typing` — withholding concepts and declarations.
- `vendix-backend` / `vendix-prisma-schema` — domain and schema conventions.
