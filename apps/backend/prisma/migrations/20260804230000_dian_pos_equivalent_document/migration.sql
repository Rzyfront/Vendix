-- DATA IMPACT:
-- Tables affected: NONE. Only three enum types gain values:
--                  dian_configuration_type_enum  (+1 value)
--                  invoice_type_enum             (+2 values)
--                  fiscal_document_type_enum     (+2 values)
-- Expected row changes: NONE. No UPDATE, no DELETE, no INSERT, no column drop,
--                       no table drop, no default change, no constraint change.
-- Destructive operations: none
-- FK/cascade risk: none — no constraint is created, dropped or altered.
-- Idempotency: every statement uses ADD VALUE IF NOT EXISTS.
-- Approval: additive-only schema change; no production row is read or written by
--           this migration, so it carries no data risk to approve.
--
-- Purpose: represent the **documento equivalente electrónico del tiquete de
-- máquina registradora con sistema P.O.S.** (Res. 000165/2023, Anexo Técnico de
-- documento equivalente electrónico v1.0) as a first-class fiscal document.
--
-- WHY three enums and not one:
--
--  1. `dian_configuration_type_enum` — the DIAN habilita el software POR TIPO de
--     documento, each with its own set de pruebas and its own
--     `enablement_status`. The equivalent document is a separate habilitación
--     from the FEV, exactly like `support_document` and `payroll` already are.
--     Folding it into `invoicing` would make one `enablement_status` speak for
--     two independent DIAN authorizations, so a store enabled for FEV would look
--     enabled to emit DE it was never authorized for.
--
--  2. `invoice_type_enum` — `invoices.invoice_type` is what the flow dispatches
--     on to pick the builder and the unique code. A POS ticket is NOT a
--     `sales_invoice`: it carries CUDE (Software-PIN), not CUFE (ClTec).
--
--  3. `fiscal_document_type_enum` — `invoice_resolutions.document_type`. The DE
--     consumes its OWN authorized numbering range. Sharing the sales-invoice
--     range would burn FEV consecutives on POS tickets, which is not reversible
--     once the DIAN accepts them.
--
-- The two adjustment notes ('93' débito / '94' crédito, numeral 16.3) are added in
-- the same step because a document type that cannot be adjusted is incomplete:
-- the DE has no credit note of its own, only these notes.

-- 1. Software habilitación for documento equivalente.
ALTER TYPE "dian_configuration_type_enum" ADD VALUE IF NOT EXISTS 'equivalent_document';

-- 2. Document kind on the invoice record.
ALTER TYPE "invoice_type_enum" ADD VALUE IF NOT EXISTS 'pos_equivalent_document';
ALTER TYPE "invoice_type_enum" ADD VALUE IF NOT EXISTS 'equivalent_adjustment_note';

-- 3. Numbering-range document type (its own authorized range).
ALTER TYPE "fiscal_document_type_enum" ADD VALUE IF NOT EXISTS 'pos_equivalent_document';
ALTER TYPE "fiscal_document_type_enum" ADD VALUE IF NOT EXISTS 'equivalent_adjustment_note';
