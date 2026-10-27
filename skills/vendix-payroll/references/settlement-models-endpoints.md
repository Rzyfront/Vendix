# Payroll reference: settlement, models, endpoints

## Final Settlement & Indemnification

Service: `settlements/settlement-calculation.service.ts` (`calculateSettlement`). State enum `settlement_status_enum` (draft, calculated, approved, paid, cancelled); flow `settlements/settlement-flow.service.ts` (paying also terminates the employee in the same tx).

Indemnification (Art.64 CST, `calculateIndemnification`) only when `termination_reason === 'without_just_cause'`, branched by `contract_type`:

- **fixed_term**: salaries for the remaining time up to `contract_end_date` (returns 0 + warn if the date is missing).
- **obra_labor**: remaining time, minimum 15 days.
- **apprentice / service**: 0.
- **indefinite / default**: `≤10 SMMLV` → 30 days first year + 20/year; `>10 SMMLV` → 20 + 15/year.

All day math is 30/360 (`calculateWorkedDays360`).

## Key Models (schema.prisma)

`employees` (contract_type, contract_end_date, salary_type, base_salary, EPS/pension/CCF, termination_*), `employee_stores` (N:M multi-store), `employee_fiscal_profiles` (art.387 dependents/deductions, retention_procedure), `payroll_runs` (status, DIAN fields, `applied_rules` snapshot, `accounting_entry_id`), `payroll_items` (per-employee JSON earnings/deductions/employer_costs/provisions, per-item DIAN fields), `payroll_novelties`, `payroll_settlements`, `employee_advances` (note: **not** "payroll_advances") + `employee_advance_payments` + `employee_advance_installments`, `pila_submissions`, `payroll_system_defaults` (yearly legal rules JSON), `uvt_values`, `withholding_calculations` (RTE_SALARIOS).

## Key Endpoints

- Runs `store/payroll/runs`: `POST :id/calculate`, `PATCH :id/approve|send|pay|cancel`, `POST :id/send-dian`, `GET :id/dian-status`, `GET :id/validate-bank-data`, `POST :id/items/:itemId/send-adjustment`, `POST :id/export-ach`, `GET bank-export/banks`.
- Employees `store/payroll/employees` (+ `/bulk`, fiscal-profile), Novelties `store/payroll/novelties`, Advances `store/payroll/advances`, Settlements `store/payroll/settlements`, Rules `store/payroll/rules`, Paystubs, Settings, PILA `store/payroll/pila`.
