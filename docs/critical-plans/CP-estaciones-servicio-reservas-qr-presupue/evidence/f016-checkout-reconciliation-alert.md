# F-016 checkout reconciliation alert

- The notification enum and an idempotent additive migration define `checkout_reconciliation_required`.
- Primary storefront checkout persists a store notification when order/payment cancellation or partial stock release fails, when booking cleanup fails, or when a settled order/payment must be preserved for reconciliation.
- WhatsApp checkout persists a store notification when partial stock release or order cancellation cannot be confirmed.
- The notification carries `order_id`, `order_number`, and a bounded reason. Notification errors or a null result fall back to the checkout logger and do not replace the original checkout error.
- Verification: `git diff --check` only. No build or tests run; runtime compensation and concurrency verification remain pending in D.1.