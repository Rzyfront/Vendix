-- Vendix Platform · cuenta OWNER de la tienda plataforma (CRM de Vendix).
--
-- ⚠️ MIGRACIÓN / DATA IMPACT:
--   Crea el usuario ventas@vendix.online ("Balmes Brito") en la organización
--   plataforma (is_platform = TRUE; prod: org 1) como OWNER de su tienda CRM
--   (slug 'vendix-crm'; prod: store 1) y le asigna el rol "Comercial Vendix"
--   para que vea el bloque «Cuenta Vendix» del CRM.
--
--   Tables affected (solo INSERT, filas nuevas):
--     - users:         1 fila (si no existe ya ese email en la org plataforma).
--                      Activo, email verificado, SIN contraseña conocida: el
--                      hash es bcrypt de 32 bytes aleatorios generados aquí
--                      (pgcrypto) y nunca expuestos. La define con
--                      «Olvidé mi contraseña».
--     - user_settings: 1 fila (app_type STORE_ADMIN + panel_ui del template
--                      'user_settings_default', igual que el aprovisionamiento).
--     - store_users:   1 fila (usuario × tienda CRM).
--     - user_roles:    2 filas org-wide (store_id NULL): 'owner' de sistema y
--                      "Comercial Vendix" de la org plataforma.
--   Expected row changes: 0 UPDATE, 0 DELETE sobre filas existentes.
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni TRUNCATE.
--   Schema: sin cambios (ni tablas ni columnas). Única DDL: CREATE EXTENSION
--   IF NOT EXISTS pgcrypto (ya instalada en prod desde
--   20260428004051_domain_provisioning_v2).
--   FK/cascade risk: ninguno; solo referencias a org, tienda y roles existentes.
--   Guardas (si alguna falla, RAISE NOTICE y no escribe nada):
--     - debe existir exactamente 1 organización is_platform = TRUE;
--     - debe existir su tienda con slug 'vendix-crm';
--     - debe existir el rol de sistema 'owner';
--     - el email (lower) no puede tener ya una cuenta staff/owner en OTRA
--       organización (invariante A1 de StaffProvisioningService).
--   Idempotency: el usuario se busca por lower(email) en la org plataforma y
--   se reutiliza si existe; el resto son INSERT ... WHERE NOT EXISTS /
--   ON CONFLICT DO NOTHING. Aplicarla dos veces no falla ni duplica filas.
--   Approval: pedido de Rafael (vía Aurora, 2026-11-18). No va a main/prod sin
--   su OK explícito.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email          CONSTANT TEXT := 'ventas@vendix.online';
  v_platform_count INT;
  v_org_id         INT;
  v_store_id       INT;
  v_owner_role     INT;
  v_comercial_role INT;
  v_user_id        INT;
  v_username       TEXT;
  v_counter        INT := 0;
  v_template       JSONB;
  v_config         JSONB;
BEGIN
  -- 1. Organización plataforma (exactamente una)
  SELECT count(*) INTO v_platform_count FROM organizations WHERE is_platform = TRUE;
  IF v_platform_count <> 1 THEN
    RAISE NOTICE 'platform_store_owner_ventas: % organizaciones is_platform, se omite.', v_platform_count;
    RETURN;
  END IF;
  SELECT id INTO v_org_id FROM organizations WHERE is_platform = TRUE;

  -- 2. Tienda CRM de la plataforma
  SELECT id INTO v_store_id FROM stores
   WHERE organization_id = v_org_id AND slug = 'vendix-crm';
  IF v_store_id IS NULL THEN
    RAISE NOTICE 'platform_store_owner_ventas: la org % no tiene tienda vendix-crm, se omite.', v_org_id;
    RETURN;
  END IF;

  -- 3. Roles
  SELECT id INTO v_owner_role FROM roles
   WHERE name = 'owner' AND organization_id IS NULL AND is_system_role = TRUE
   ORDER BY id LIMIT 1;
  IF v_owner_role IS NULL THEN
    RAISE NOTICE 'platform_store_owner_ventas: no existe el rol de sistema owner, se omite.';
    RETURN;
  END IF;

  SELECT id INTO v_comercial_role FROM roles
   WHERE name = 'Comercial Vendix' AND organization_id = v_org_id AND store_id IS NULL
   ORDER BY id LIMIT 1;

  -- 4. Invariante A1: el email no puede ser staff/owner en otra organización
  IF EXISTS (
    SELECT 1 FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
     WHERE lower(u.email) = v_email
       AND u.organization_id <> v_org_id
       AND r.name <> 'customer'
  ) THEN
    RAISE NOTICE 'platform_store_owner_ventas: % ya es staff en otra organización, se omite.', v_email;
    RETURN;
  END IF;

  -- 5. Usuario: se reutiliza si ya existe en la org plataforma
  SELECT id INTO v_user_id FROM users
   WHERE lower(email) = v_email AND organization_id = v_org_id
   ORDER BY id LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Username único con la misma regla que generateUniqueUsername: ventas, ventas1, ...
    v_username := 'ventas';
    WHILE EXISTS (SELECT 1 FROM users WHERE username = v_username) LOOP
      v_counter := v_counter + 1;
      IF v_counter > 100 THEN
        v_username := 'ventas_' || floor(extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
        EXIT;
      END IF;
      v_username := 'ventas' || v_counter;
    END LOOP;

    INSERT INTO users (
      username, email, password, state, email_verified,
      first_name, last_name, organization_id, main_store_id,
      created_at, updated_at
    ) VALUES (
      v_username, v_email,
      -- bcrypt ($2a$, costo 12) de un secreto aleatorio que nadie conoce.
      crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf', 12)),
      'active', TRUE,
      'Balmes', 'Brito', v_org_id, v_store_id,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_user_id;
  END IF;

  -- 6. user_settings (como provisionStaffMembership: panel_ui del template)
  SELECT template_data INTO v_template FROM default_templates
   WHERE template_name = 'user_settings_default'
     AND configuration_type = 'user_settings'
     AND is_active = TRUE AND is_system = TRUE
   LIMIT 1;
  IF v_template ? 'panel_ui' THEN
    v_config := jsonb_build_object(
      'panel_ui', v_template -> 'panel_ui',
      'preferences', COALESCE(v_template -> 'preferences', '{"language":"es","theme":"default"}'::jsonb)
    );
  ELSE
    v_config := '{}'::jsonb;
  END IF;

  INSERT INTO user_settings (user_id, app_type, config, created_at, updated_at)
  VALUES (v_user_id, 'STORE_ADMIN', v_config, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT (user_id) DO NOTHING;

  -- 7. Membresía de la tienda CRM
  INSERT INTO store_users (store_id, user_id)
  VALUES (v_store_id, v_user_id)
  ON CONFLICT (store_id, user_id) DO NOTHING;

  -- 8. Roles org-wide (store_id NULL), como hace el registro de owner
  INSERT INTO user_roles (user_id, role_id, store_id)
  SELECT v_user_id, v_owner_role, NULL
   WHERE NOT EXISTS (
     SELECT 1 FROM user_roles
      WHERE user_id = v_user_id AND role_id = v_owner_role AND store_id IS NULL
   );

  IF v_comercial_role IS NULL THEN
    RAISE NOTICE 'platform_store_owner_ventas: no existe el rol "Comercial Vendix" en la org %; queda solo como owner.', v_org_id;
  ELSE
    INSERT INTO user_roles (user_id, role_id, store_id)
    SELECT v_user_id, v_comercial_role, NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM user_roles
        WHERE user_id = v_user_id AND role_id = v_comercial_role AND store_id IS NULL
     );
  END IF;
END $$;
