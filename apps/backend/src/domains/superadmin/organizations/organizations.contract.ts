/**
 * Super-admin organizations CONTRACT — the single source of truth for which
 * fields the super-admin organization edit modal and the backend agree to
 * exchange.
 *
 * Espejo 1-a-1 de `stores.contract.ts`. Antes de este archivo la DTO del
 * backend declaraba DIAN, branding, address, scopes, partner y fraud como
 * campos inexistentes o solamente como columnas internas. El modal del
 * frontend enviaba únicamente `name / slug / legal_name / tax_id / email /
 * phone / website / logo_url / description / state / mode` — el `PATCH`
 * persistía eso y nada más, así que la pestaña **Branding** y la pestaña
 * **Ubicación** siempre aparecían vacías al reabrir el modal.
 *
 * Este contrato expone:
 *
 * - `ORG_EDITABLE_FIELDS` — tupla inmutable con cada clave editable de la DTO
 *   (top-level + alias JSONB + alias dirección). El frontend puede iterarla
 *   para construir formularios sin divergir del backend.
 * - `ORG_JSONB_SETTINGS_KEYS` — tupla inmutable con las claves que viven en
 *   `organization_settings.settings` JSONB (los `color_*`).
 * - `ORG_ADDRESS_FIELDS` — tupla inmutable con las claves que van a
 *   `addresses[]` (fila primary).
 * - `OrganizationDetailContract` — espejo TS de la respuesta normalizada de
 *   `GET /superadmin/organizations/:id`. Cualquier consumidor que lea la
 *   respuesta tipada contra esta interfaz falla en compilación cuando el
 *   backend cambia la forma.
 * - `OrganizationUpdatePayload` / `OrganizationCreatePayload` — espejo TS de
 *   las DTOs del backend.
 * - Re-exports de los enums canónicos del dominio (`OrganizationState`,
 *   `OrganizationMode`, etc.) para que el modal no importe dos copias.
 */

import type {
  Prisma,
  organization_state_enum as PrismaOrganizationState,
  organization_mode_enum as PrismaOrganizationMode,
  organization_account_type_enum as PrismaOrganizationAccountType,
  organization_operating_scope_enum as PrismaOrganizationOperatingScope,
  fiscal_scope_enum as PrismaFiscalScope,
} from '@prisma/client';
import {
  OrganizationState,
  OrganizationMode,
  OrganizationAccountType,
  OrganizationOperatingScope,
  OrganizationFiscalScope,
  ORG_EDITABLE_DTO_KEYS,
  ORG_JSONB_DTO_KEYS,
  ORG_ADDRESS_DTO_KEYS,
} from './dto';

/**
 * Cada clave editable del organization DTO. Top-level + alias JSONB + alias
 * dirección. Mantenida como readonly tuple para que TypeScript infiera tipos
 * literales al iterarla.
 */
export const ORG_EDITABLE_FIELDS = ORG_EDITABLE_DTO_KEYS;

/**
 * Claves que físicamente viven en `organization_settings.settings` JSONB.
 * El servicio las mergea desde top-level (preferido) al hacer el upsert.
 */
export const ORG_JSONB_SETTINGS_KEYS = ORG_JSONB_DTO_KEYS;

/**
 * Claves que el servicio enruta hacia `addresses[]` (fila primary). El
 * servicio localiza la fila primary (is_primary=true o primera) y hace
 * upsert con estos campos; `address_line1` es el mínimo obligatorio para
 * crear una fila nueva.
 */
export const ORG_ADDRESS_FIELDS = ORG_ADDRESS_DTO_KEYS;

// ---- Re-exports de los enums del dominio ----

export {
  OrganizationState,
  OrganizationMode,
  OrganizationAccountType,
  OrganizationOperatingScope,
  OrganizationFiscalScope,
};

/**
 * Aliases del enum Prisma crudo. Existen porque el código Prisma-client
 * expone `organization_state_enum` con el mismo set que `OrganizationState`;
 * los reusamos para no inventar una tercera copia.
 */
export type OrganizationStatePrisma = PrismaOrganizationState;
export type OrganizationModePrisma = PrismaOrganizationMode;
export type OrganizationAccountTypePrisma = PrismaOrganizationAccountType;
export type OrganizationOperatingScopePrisma = PrismaOrganizationOperatingScope;
export type OrganizationFiscalScopePrisma = PrismaFiscalScope;

// ---- Tipos del payload editable ----

/**
 * Forma TS del `POST /superadmin/organizations` body. Espejo 1-a-1 de
 * `CreateOrganizationDto`. `name` y `email` son obligatorios en el dominio;
 * el resto opcional igual que en la DTO.
 */
export interface OrganizationCreatePayload {
  name: string;
  email: string;
  slug?: string;
  legal_name?: string;
  tax_id?: string;

  // ---- DIAN fiscal identity ----
  document_type?: string;
  verification_digit?: string;
  person_type?: string;
  tax_regime?: string;
  fiscal_responsibilities?: string[];
  ciiu_code?: string;

  // ---- scopes ----
  account_type?: OrganizationAccountType;
  operating_scope?: OrganizationOperatingScope;
  fiscal_scope?: OrganizationFiscalScope;

  // ---- partner ----
  is_partner?: boolean;
  partner_settings?: Record<string, unknown>;
  partner_since?: Date | string;

  // ---- fraud ----
  fraud_blocked?: boolean;
  fraud_blocked_reason?: string;

  // ---- onboarding ----
  onboarding?: boolean;
  has_consumed_trial?: boolean;

  // ---- contact ----
  phone?: string;
  website?: string;
  logo_url?: string;
  description?: string;
  state?: OrganizationState;
  mode?: OrganizationMode;

  // ---- primary address ----
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_province?: string;
  country_code?: string;
  department_code?: string;
  municipality_code?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;

  // ---- branding aliases (JSONB) ----
  color_primary?: string;
  color_secondary?: string;
  color_accent?: string;
}

/**
 * Forma TS del `PATCH /superadmin/organizations/:id` body. Espejo 1-a-1 de
 * `UpdateOrganizationDto`. Mantener en sync editando la DTO y propagando
 * las nuevas claves a este tipo.
 */
export interface OrganizationUpdatePayload
  extends Partial<OrganizationCreatePayload> {}

// ---- Forma de la respuesta normalizada ----

/**
 * Sub-objeto `primary_address` hidratado en `findOne()` a partir de la fila
 * `addresses[]` con `is_primary=true` (o la primera fila).
 */
export interface OrganizationPrimaryAddressContract {
  id: number;
  organization_id: number | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_province: string | null;
  country_code: string;
  postal_code: string | null;
  municipality_code: string | null;
  phone_number: string | null;
  type: string;
  is_primary: boolean;
  latitude: string | null;
  longitude: string | null;
}

/**
 * Sub-objeto `partner` agrupando los campos partner de la fila
 * `organizations`. Sale tal cual de la fila cruda; `partner_settings` se
 * mantiene como `Record<string, unknown>` porque la forma concreta la
 * decide cada integración comercial.
 */
export interface OrganizationPartnerContract {
  is_partner: boolean;
  partner_settings: Record<string, unknown> | null;
  partner_since: string | null;
}

/**
 * Sub-objeto `fraud` agrupando los campos anti-fraude de la fila
 * `organizations`. `fraud_blocked_at` y `fraud_blocked_reason` se exponen
 * para que el modal muestre cuándo y por qué se bloqueó una cuenta.
 * `chargeback_count` sale del contador en la fila cruda.
 */
export interface OrganizationFraudContract {
  fraud_blocked: boolean;
  fraud_blocked_at: string | null;
  fraud_blocked_reason: string | null;
  chargeback_count: number;
}

/**
 * Respuesta normalizada de `GET /superadmin/organizations/:id`. La fila
 * cruda de `organizations` se extiende con los sub-objetos hidratados y
 * con los alias top-level (`color_primary`, `color_secondary`,
 * `color_accent`) leídos desde `organization_settings.settings`.
 *
 * Es la fuente de verdad que el frontend (modal) debe consumir; cualquier
 * divergencia con esta forma rompe el contrato.
 */
export interface OrganizationDetailContract {
  // Fila cruda `organizations`
  id: number;
  name: string;
  slug: string;
  legal_name: string | null;
  tax_id: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  description: string | null;
  logo_url: string | null;
  state: OrganizationStatePrisma | string;
  mode: OrganizationModePrisma | string;
  created_at: Date | string | null;
  updated_at: Date | string | null;

  // ---- DIAN fiscal identity ----
  document_type: string | null;
  verification_digit: string | null;
  person_type: string | null;
  tax_regime: string | null;
  fiscal_responsibilities: string[];
  ciiu_code: string | null;

  // ---- scopes ----
  account_type: OrganizationAccountTypePrisma | string;
  operating_scope: OrganizationOperatingScopePrisma | string;
  fiscal_scope: OrganizationFiscalScopePrisma | string;

  // ---- partner ----
  is_partner: boolean;
  partner_settings: Record<string, unknown> | null;
  partner_since: Date | string | null;

  // ---- fraud ----
  fraud_blocked: boolean;
  fraud_blocked_at: Date | string | null;
  fraud_blocked_reason: string | null;
  chargeback_count: number;

  // ---- onboarding ----
  onboarding: boolean;
  has_consumed_trial: boolean;
  trial_consumed_at: Date | string | null;

  // ---- platform ----
  is_platform: boolean;
  acm_certificate_arn: string | null;
  acm_cert_revision: number;

  // ---- branding aliases (top-level mirrors from organization_settings.settings) ----
  color_primary: string | null;
  color_secondary: string | null;
  color_accent: string | null;

  // ---- sub-objetos hidratados ----
  primary_address: OrganizationPrimaryAddressContract | null;
  partner: OrganizationPartnerContract;
  fraud: OrganizationFraudContract;

  // ---- conteos auxiliares ----
  _count?: {
    stores: number;
    users: number;
    addresses: number;
    suppliers: number;
    employees: number;
  };
}
