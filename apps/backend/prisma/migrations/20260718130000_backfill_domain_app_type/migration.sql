-- DATA IMPACT:
-- Tables affected: domain_settings
-- Expected row changes: re-mapea filas históricas cuyo app_type quedó en el
--   default VENDIX_LANDING pese a pertenecer a una tienda/organización/ecommerce:
--     domain_type='store'        + app_type='VENDIX_LANDING' -> app_type='STORE_LANDING'
--     domain_type='organization' + app_type='VENDIX_LANDING' -> app_type='ORG_LANDING'
--     domain_type='ecommerce'    + app_type='VENDIX_LANDING' -> app_type='STORE_ECOMMERCE'
--   Los dominios core (domain_type='vendix_core') NO se tocan: VENDIX_LANDING es
--   correcto para ellos.
-- Destructive operations: none (solo UPDATE acotado por WHERE, sin CASCADE/DROP/DELETE)
-- FK/cascade risk: none (no se tocan FKs ni se borran filas)
-- Idempotency: cada UPDATE está acotado por app_type='VENDIX_LANDING' + domain_type;
--   una segunda ejecución no encuentra filas y afecta 0 registros.
-- Approval: solicitada al usuario / documentada en el PR de esta feature.

-- 1. Dominios de tienda (-store) marcados por error como VENDIX_LANDING
UPDATE "domain_settings"
SET "app_type" = 'STORE_LANDING'::"app_type_enum",
    "updated_at" = now()
WHERE "app_type" = 'VENDIX_LANDING'::"app_type_enum"
  AND "domain_type" = 'store'::"domain_type_enum";

-- 2. Dominios de organización (-org) marcados por error como VENDIX_LANDING
UPDATE "domain_settings"
SET "app_type" = 'ORG_LANDING'::"app_type_enum",
    "updated_at" = now()
WHERE "app_type" = 'VENDIX_LANDING'::"app_type_enum"
  AND "domain_type" = 'organization'::"domain_type_enum";

-- 3. Dominios de ecommerce (-shop) marcados por error como VENDIX_LANDING
UPDATE "domain_settings"
SET "app_type" = 'STORE_ECOMMERCE'::"app_type_enum",
    "updated_at" = now()
WHERE "app_type" = 'VENDIX_LANDING'::"app_type_enum"
  AND "domain_type" = 'ecommerce'::"domain_type_enum";
