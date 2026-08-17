/**
 * Super-admin stores CONTRACT — the single source of truth for which fields
 * the super-admin store edit modal and the backend agree to exchange.
 *
 * Antes de este archivo la DTO del backend declaraba los campos de branding y
 * descripción como `settings.currency_code / settings.color_*` mientras el
 * modal del frontend enviaba los mismos valores como claves top-level. El
 * `ValidationPipe` global hacía `whitelist: true` + `forbidNonWhitelisted:
 * true`, así que el backend descartaba silenciosamente cualquier clave que no
 * estuviera en la DTO. Resultado medido: el modal abría con los campos en
 * blanco y los `PATCH` no persistían `description`, `email`, `phone`,
 * `website`, `currency_code`, `color_primary`, `color_secondary` — la tienda
 * se "guardaba" sin error visible y los valores se perdían en el backend.
 *
 * Este contrato expone:
 *
 * - `STORE_EDITABLE_FIELDS` — tupla inmutable con cada clave editable de la DTO
 *   (top-level + alias JSONB + alias dirección). El frontend puede iterarla
 *   para construir formularios sin divergir del backend.
 * - `STORE_JSONB_SETTINGS_KEYS` — tupla inmutable con las claves que viven en
 *   `store_settings.settings` JSONB; documenta quién es dueño de cada clave
 *   para que el día de mañana promover alguna a columna no rompa el contrato.
 * - `StoreDetailContract` — espejo TS de la respuesta normalizada de
 *   `GET /superadmin/stores/:id`. Cualquier consumidor (frontend o test) que
 *   lea la respuesta tipada contra esta interfaz falla en compilación cuando
 *   el backend cambia la forma.
 * - `StoreUpdatePayload` / `StoreCreatePayload` — espejo TS de las DTOs del
 *   backend; útil para que el modal del frontend importe tipos sin rezar para
 *   que `class-validator` mantenga la forma.
 * - Re-exports de los enums canónicos del dominio (`StoreType`, `StoreIndustry`,
 *   `StoreState`) para que el modal no importe dos copias distintas.
 */

import type {
  Prisma,
  store_type_enum as PrismaStoreType,
  industry_enum as PrismaIndustry,
  organization_state_enum as PrismaOrganizationState,
} from '@prisma/client';
import {
  StoreType,
  StoreIndustry,
  StoreState,
  STORE_EDITABLE_DTO_KEYS,
  STORE_JSONB_DTO_KEYS,
  STORE_ADDRESS_DTO_KEYS,
} from '../../store/stores/dto';

/**
 * Cada clave editable del store DTO. Top-level + alias JSONB + alias
 * dirección + `settings` legacy. Mantenida como readonly tuple para que
 * TypeScript infiera tipos literales al iterarla.
 */
export const STORE_EDITABLE_FIELDS = STORE_EDITABLE_DTO_KEYS;

/**
 * Claves que físicamente viven en `store_settings.settings` JSONB.
 * El servicio las mergea desde top-level (preferido) o desde
 * `dto.settings.*` (legacy) al hacer el upsert del JSONB.
 */
export const STORE_JSONB_SETTINGS_KEYS = STORE_JSONB_DTO_KEYS;

/**
 * Claves que el servicio enruta hacia `addresses[]` (fila primary). El
 * servicio localiza la fila primary (is_primary=true o primera) y hace
 * upsert con estos campos; `address_line1` + `city` + `country_code` son
 * los mínimos obligatorios para crear una fila nueva.
 */
export const STORE_ADDRESS_FIELDS = STORE_ADDRESS_DTO_KEYS;

// ---- Re-exports de los enums del dominio ----

export { StoreType, StoreIndustry, StoreState };

/**
 * Alias del enum Prisma crudo. Existe porque el código Prisma-client
 * expone `store_type_enum` con el mismo set que `StoreType`; los reusamos
 * para no inventar una tercera copia.
 */
export type StoreTypePrisma = PrismaStoreType;
export type IndustryPrisma = PrismaIndustry;
export type OrganizationStatePrisma = PrismaOrganizationState;

// ---- Tipos del payload editable ----

/**
 * Forma TS del `PATCH /superadmin/stores/:id` body. Espejo 1-a-1 de
 * `UpdateStoreDto`. Mantener en sync editando la DTO y propagando las nuevas
 * claves a este tipo.
 */
export interface StoreUpdatePayload {
  organization_id?: number;
  name?: string;
  slug?: string;
  store_code?: string;
  logo_url?: string;
  domain?: string;
  timezone?: string;
  operating_hours?: Prisma.JsonValue;
  store_type?: StoreType;
  industries?: StoreIndustry[];
  is_active?: boolean;
  manager_user_id?: number;

  description?: string;
  email?: string;
  phone?: string;
  website?: string;

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

  currency_code?: string;
  color_primary?: string;
  color_secondary?: string;

  settings?: Record<string, unknown>;
}

/**
 * Forma TS del `POST /superadmin/stores` body. Espejo 1-a-1 de
 * `CreateStoreDto`. `name` es obligatorio en el dominio; el resto opcional
 * igual que en la DTO.
 */
export interface StoreCreatePayload {
  organization_id: number;
  name: string;
  slug?: string;
  store_code?: string;
  logo_url?: string;
  domain?: string;
  timezone?: string;
  operating_hours?: Prisma.JsonValue;
  store_type?: StoreType;
  industries?: StoreIndustry[];
  is_active?: boolean;
  manager_user_id?: number;

  description?: string;
  email?: string;
  phone?: string;
  website?: string;

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

  currency_code?: string;
  color_primary?: string;
  color_secondary?: string;

  settings?: Record<string, unknown>;
}

// ---- Forma de la respuesta normalizada ----

/**
 * Sub-objeto `organization` hidratado en `findOne()` a partir de la fila
 * relacionada `stores.organizations`. Trimeado para no filtrar columnas
 * internas del org (fiscal, payment, etc.) que no aplican al modal.
 */
export interface StoreOrganizationContract {
  id: number;
  name: string;
  slug: string;
  state?: OrganizationStatePrisma | null;
}

/**
 * Sub-objeto `manager` cuando `store.manager_user_id` está seteado. Sale de
 * `store_users[]` filtrado por `store_user_id == manager_user_id` para
 * garantizar que el manager real esté efectivamente vinculado a esta tienda.
 */
export interface StoreManagerContract {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
}

/**
 * Sub-objeto `currency` cuando `store_settings.settings.currency_code` está
 * seteado. Hidratado por batch desde `currencies` filtrado por `is_active`.
 * `null` cuando el código guardado no existe o está inactivo.
 */
export interface StoreCurrencyContract {
  code: string;
  name: string;
  symbol: string;
}

/**
 * Sub-objeto `primary_address`. Sale de `addresses[]` (la fila con
 * `is_primary=true`, o la primera si ninguna lo está). Refleja la fila
 * cruda de la tabla `addresses` — los campos del DTO top-level se
 * proyectan directamente sobre estas columnas.
 */
export interface StoreAddressContract {
  id: number;
  store_id: number | null;
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
 * Respuesta normalizada de `GET /superadmin/stores/:id`. La fila cruda de
 * `stores` se extiende con los sub-objetos hidratados y con los alias
 * top-level (`description`, `email`, etc.) leídos desde
 * `store_settings.settings`. Es la fuente de verdad que el frontend
 * (modal) debe consumir; cualquier divergencia con esta forma rompe el
 * contrato.
 */
export interface StoreDetailContract {
  // Fila cruda `stores`
  id: number;
  name: string;
  slug: string;
  legal_name: string | null;
  tax_id: string | null;
  tax_id_dv: string | null;
  nit_type: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  is_active: boolean;
  logo_url: string | null;
  manager_user_id: number | null;
  organization_id: number;
  store_code: string | null;
  store_type: StoreType | StoreTypePrisma;
  industries: string[];
  timezone: string | null;
  operating_hours: Prisma.JsonValue | null;
  onboarding: boolean;
  municipality_code: string | null;
  department_code: string | null;
  ciiu_code: string | null;

  // Sub-objetos hidratados
  organization: StoreOrganizationContract;
  manager: StoreManagerContract | null;
  currency: StoreCurrencyContract | null;
  primary_address: StoreAddressContract | null;

  // Alias top-level leídos desde `store_settings.settings`
  description: string | null;
  email: string | null;
  /** Phone preferido del JSONB; fallback a `primary_address.phone_number`. */
  phone: string | null;
  website: string | null;
  currency_code: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  color_accent: string | null;

  // Conteos auxiliares (útiles para el tab "status" del modal)
  _count?: {
    store_users: number;
    products: number;
    orders: number;
  };
}