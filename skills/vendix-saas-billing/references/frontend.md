# SaaS billing: frontend

Store UI: `apps/frontend/src/app/private/modules/store/subscription/`. Super-admin UI: `apps/frontend/src/app/private/modules/super-admin/subscriptions/`.

## Frontend Subscription UI

Store subscription routes include overview, plans, picker, payment, history, timeline, invoice detail, checkout, and dunning.

Key frontend facts:

- `SubscriptionFacade` exposes observables and signals with `toSignal(..., { initialValue })`.
- Plan catalog groups by billing cycle and supports coupon validation.
- Picker is the soft `no_plan` path and filters promotional plans unless `show_in_picker === true`.
- Checkout preview/commit handles free plans, trial swap, proration, resubscribe, scheduled-cancel revert, Wompi widget, polling, and invoice gateway sync fallback.
- Dunning board shows deadline, total due, overdue invoices, features lost/kept, retry payment, and support CTA.
- Super-admin plan form includes overview, AI matrix, pricing, trial/grace tabs; pricing default drives canonical `base_price`, `billing_cycle`, and `currency`.

