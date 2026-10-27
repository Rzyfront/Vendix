# SaaS billing: plans, partners, commissions and payouts

Paths: `apps/backend/src/domains/superadmin/subscriptions/`, `apps/backend/src/domains/store/subscriptions/services/partner-commissions.service.ts`, `apps/backend/src/jobs/`.

## Plans And Partners

Super-admin plan service facts:

- `is_free` forces `base_price=0` and `setup_fee=null`.
- `plan_type` supports `base`, `partner_custom`, and `promotional`.
- Promotional flag mirrors `plan_type === 'promotional'`.
- `setDefault()` clears existing default and sets one active plan as default in a serializable transaction.

Partner facts:

- Partners are `organizations` with `is_partner=true`.
- Overrides are `partner_plan_overrides` keyed by `(organization_id, base_plan_id)`.
- `PartnersService.createOverride()` enforces `margin_pct <= plan.max_partner_margin_pct`.
- Current code does not fully block overrides on promotional plans in `PartnersService`; billing skips commission for promotional plans. Treat this as a known implementation gap if product policy requires blocking overrides.

## Commissions And Payouts

Commission accrual paths:

- `PartnerCommissionsService.accrueCommission(invoiceId)` upserts `partner_commissions(state='accrued')` from `invoice.split_breakdown.partner_share`.
- `commission-accrual.job.ts` processes `commission_accrual_pending`, upserts commission as `pending_payout`, and promotes existing `accrued` to `pending_payout`.
- `partner-payout-batch.job.ts` runs `0 4 5 * *`, creates monthly draft batches for previous-month `accrued` commissions, and transitions them to `pending_payout`.

Known current inconsistency: `commission-accrual.job.ts` promotes commissions to `pending_payout`, while `partner-payout-batch.job.ts` selects only `accrued`. Do not document the payout lifecycle as perfectly consistent until this is resolved.

Admin payout service:

- `approve()` moves draft batch to approved.
- `rejectBatch()` releases commissions back to `accrued`.
- `markPaid()` requires approved batch and sets batch plus commissions to `paid`.

