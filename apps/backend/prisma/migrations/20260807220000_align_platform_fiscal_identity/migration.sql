-- DATA IMPACT:
-- Tables affected: addresses (2 INSERT), organizations (1 UPDATE), accounting_entities (3 UPDATE)
-- Expected row changes: +1 billing address for organization 1 (Riohacha 44847);
--   +1 billing address for store 97 / HIDRO (Bogotá 11001, from its own RUT);
--   organization 1 fiscal columns derived from settings.fiscal_data;
--   accounting entities 18, 21, 95 realigned
-- Destructive operations: none — no DELETE, DROP, TRUNCATE or CASCADE
-- FK/cascade risk: none. addresses -> organizations is ON DELETE RESTRICT and this
--   migration only INSERTs. accounting_entities keeps its unique key
--   (organization_id, store_id, scope, fiscal_scope), which this migration does not touch.
--   organizations.tax_id is UNIQUE and no other row holds '902056589' (verified).
-- Idempotency: the address INSERT is guarded by NOT EXISTS; both UPDATEs match either
--   the seed value or the target value, so re-running is a no-op.
-- Approval: user approved the plan "identidad fiscal con fuente única y limpieza de
--   datos falsos" and confirmed fiscal_data is the single source of truth
-- Snapshot: organizations, accounting_entities, addresses, dian_configurations and
--   fiscal_data for organization 1 dumped in full before applying
--
-- The platform tenant carried seed fiscal identity while the real one lived only in
-- organization_settings.settings.fiscal_data:
--
--   fiscal_data (real, from the RUT)   columns/entities (seed)
--   ────────────────────────────────   ──────────────────────────────
--   nit 902056589, dv 9                tax_id '900123456-7'
--   QUICKSS S.A.S. SOLUCIONES …        'Vendix Corporation S.A.S.'
--   CALLE 14H 26 13, Riohacha, 44847   no address rows at all
--   O-13, O-47 · COMUN · CIIU 6209     document_type/person_type/tax_regime/
--                                      ciiu_code/verification_digit all NULL
--
-- '900123456-7' is not merely stale, it is impossible: computeNitDv('900123456')
-- returns 8, so the stored DV of 7 never belonged to any real NIT.
--
-- Two consequences this fixes:
--
-- 1. organization 1 and its stores had ZERO rows in `addresses`, and
--    DianDirectProvider.buildIssuerData throws when the fiscal entity has no primary
--    address with a DIAN municipality_code. The production emission path could not
--    run at all for this tenant.
-- 2. The fiscal columns are a PROJECTION of fiscal_data, never an origin. They were
--    never derived, so every consumer that reads them (payroll paystubs, dispatch
--    note PDFs, subscription invoices, payroll bank export) printed a fabricated NIT.
--
-- tax_regime is '48' (responsable de IVA) and not '49': per isVatResponsible, the
-- responsibilities ['O-13','O-47'] carry neither O-48 nor O-49, so resolution falls
-- through to tax_regime 'COMUN', which is responsible. The habilitación test set was
-- hardcoding '49' while its documents charged 19% IVA — a contradiction inside the
-- same document.
--
-- The address goes in `addresses` with type='billing' and NOT in a column on
-- organizations, per the decision already documented in schema.prisma: "La dirección
-- fiscal NO se duplica aquí: vive en `addresses` con `type = 'billing'`".

-- 1. Fiscal address of the platform organization (RUT box 38-42).
INSERT INTO addresses (
  organization_id, address_line1, city, state_province,
  country_code, municipality_code, type, is_primary
)
SELECT 1, 'CALLE 14H 26 13', 'Riohacha', 'La Guajira',
       'CO', '44847', 'billing', true
WHERE NOT EXISTS (
  SELECT 1 FROM addresses
   WHERE organization_id = 1 AND type = 'billing'
);

-- 2. Fiscal columns of organization 1, derived from fiscal_data.
--    The DV is computed, never read: a stored DV that disagrees is by definition wrong.
UPDATE organizations
   SET tax_id                  = '902056589',
       verification_digit      = '9',
       legal_name              = 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
       document_type           = '31',
       person_type             = '1',
       tax_regime              = '48',
       fiscal_responsibilities = ARRAY['O-13', 'O-47'],
       ciiu_code               = '6209'
 WHERE id = 1
   AND (tax_id = '900123456-7' OR tax_id = '902056589');

-- 3. Fiscal address for store 97 (HIDRO INSTALACIONES J.L. S.A.S, dian_configurations
--    id 12, the other tenant in habilitación).
--
--    NOT cosmetic: removing the hardcoded 'Bogotá 11001' from the test-set generator
--    means the issuer municipality now comes from data, and this tenant has it
--    NOWHERE — its store_settings.fiscal_data has city/department/fiscal_address but
--    no municipality_code, its organization_settings.fiscal_data is null, and its only
--    address row is type='store_physical' with municipality_code NULL. Without this
--    row the resolver throws and HIDRO's habilitación stops.
--
--    11001 is Bogotá D.C., which is what its own RUT declares
--    (city 'Bogotá D.C.', department 'Bogotá', fiscal_address
--    'CR 77 P BIS B NO. 50 30 SUR'). It is the same value the generator hardcoded —
--    correct for this tenant by coincidence — now stored as data instead of a literal.
INSERT INTO addresses (
  store_id, address_line1, city, state_province,
  country_code, municipality_code, type, is_primary
)
SELECT 97, 'CR 77 P BIS B NO. 50 30 SUR', 'Bogotá D.C.', 'Bogotá',
       'CO', '11001', 'billing', true
WHERE EXISTS (SELECT 1 FROM stores WHERE id = 97)
  AND NOT EXISTS (
    SELECT 1 FROM addresses WHERE store_id = 97 AND type = 'billing'
  );

-- 4. Accounting entities of organization 1 realigned to the same NIT and legal name.
--    Entities 18 and 21 are STORE-scoped, 95 is ORGANIZATION-scoped; all three belong
--    to the same declarant, so all three carry the declarant's NIT. `name` is left
--    untouched: it is the internal bookkeeping label, not the fiscal name.
UPDATE accounting_entities
   SET tax_id     = '902056589',
       legal_name = 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE'
 WHERE organization_id = 1
   AND id IN (18, 21, 95)
   AND (tax_id = '900123456-7' OR tax_id = '902056589');
