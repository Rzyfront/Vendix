-- =====================================================
-- platform_customers — clientes externos del riel de facturación de plataforma
-- (Vendix factura a terceros que no son tenants). Se alimenta con un upsert al
-- emitir POST superadmin/subscriptions/fiscal/sales-invoices con
-- customer.kind = 'external' y se consulta en customers/search (kind customer).
-- =====================================================
-- DATA IMPACT:
-- Tables affected: platform_customers (NUEVA)
-- Expected row changes: ninguna; solo crea la tabla y sus índices vacíos.
-- Destructive operations: none (sin DROP, DELETE, UPDATE, TRUNCATE).
-- FK/cascade risk: none — la tabla no tiene FKs entrantes ni salientes.
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE [UNIQUE] INDEX IF NOT EXISTS.
-- Approval: aditiva; no requiere snapshot.
-- =====================================================

CREATE TABLE IF NOT EXISTS "platform_customers" (
    "id" SERIAL NOT NULL,
    "document_type" VARCHAR(10) NOT NULL,
    "tax_id" VARCHAR(50) NOT NULL,
    "tax_id_dv" VARCHAR(1),
    "legal_name" VARCHAR(255) NOT NULL,
    "person_type" VARCHAR(1),
    "tax_regime_code" VARCHAR(10),
    "fiscal_responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "address_line" VARCHAR(255),
    "city" VARCHAR(100),
    "city_code" VARCHAR(10),
    "department_code" VARCHAR(10),
    "last_invoiced_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_customers_document_type_tax_id_key"
    ON "platform_customers"("document_type", "tax_id");

CREATE INDEX IF NOT EXISTS "platform_customers_tax_id_idx"
    ON "platform_customers"("tax_id");
