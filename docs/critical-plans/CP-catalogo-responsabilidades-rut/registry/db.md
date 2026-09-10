# Database Contract Registry

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `organization_settings` | `fiscal_data` (JSONB) | W | scoped via organization_id | none | `organization-fiscal.service.ts` | `tax_responsibilities` contiene códigos canónicos válidos | `SELECT fiscal_data->'tax_responsibilities' FROM organization_settings LIMIT 1;` | [x] |
| DB-02 | `store_settings` | `fiscal_data` (JSONB) | W | scoped via store_id | none | `store-fiscal.service.ts` | `tax_responsibilities` contiene códigos canónicos válidos | `SELECT fiscal_data->'tax_responsibilities' FROM store_settings LIMIT 1;` | [x] |
| DB-03 | `organizations` | `fiscal_responsibilities` (TEXT[]) | W | scoped via id | none | `organization-fiscal-columns.helper.ts` | Array en sync con `fiscal_data.tax_responsibilities` | `SELECT fiscal_responsibilities FROM organizations LIMIT 1;` | [x] |
| DB-04 | `ai_engine_applications` | `system_prompt` (TEXT) | W | global | SQL UPDATE en A.3, seed solo crea | `AiEngineRunnerService` | Prompt sin lista restrictiva ni R-99-PJ | `SELECT system_prompt FROM ai_engine_applications WHERE key='rut_scanner';` | [x] |
| DB-05 | `users` | `fiscal_responsibilities` (TEXT[]) | W | scoped client por store | none | `customers.service.ts` | Array con códigos canónicos válidos | `SELECT fiscal_responsibilities FROM users WHERE store_id='<id>' LIMIT 5;` | [x] |
