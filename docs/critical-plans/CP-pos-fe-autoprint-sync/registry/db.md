# Database Contract Registry
| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|----------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | invoices | id, order_id, invoice_number, status, cufe, transmission_status | R/W | Scoped by store_id | none | PosFiscalEmissionService, PrintFiscalGateService | Una sola factura vigente por orden | prisma studio / query orders.invoices | [x] |
| DB-02 | orders | id, store_id, order_number, state, payment_status | R | Scoped by store_id | none | PosOrderConfirmationComponent, PrintFiscalGateService | Pedido pertenece a la tienda activa | prisma studio / query orders | [x] |
| DB-03 | store_settings | store_id, settings (invoicing.pos.auto_emit, pos.auto_print_receipt) | R | Scoped by store_id | none | StoreSettingsFacade, PaymentsService | Configuración válida JSON | SELECT settings FROM store_settings WHERE store_id = 1 | [x] |
