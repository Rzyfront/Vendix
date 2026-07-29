/**
 * Enums espejo del catálogo de productos.
 *
 * Viven en un módulo HOJA (sin imports propios) a propósito: `dto/index.ts`
 * re-exporta DTOs hermanos con `export * from './<hermano>.dto'`, y swc iza esos
 * `require` al inicio del módulo compilado. Si un hermano importara estos enums
 * desde `./index`, los recibiría antes de que `index.ts` ejecutara sus propias
 * declaraciones, y un `@IsEnum(undefined)` crashea al cargar el módulo. Importar
 * siempre desde aquí rompe ese ciclo.
 */

export enum ProductState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum PricingType {
  UNIT = 'unit',
  WEIGHT = 'weight',
}

export enum ProductType {
  PHYSICAL = 'physical',
  SERVICE = 'service',
  // Plato/preparación producida in-house (suite restaurante). Ya existe en el
  // enum Prisma product_type_enum; el DTO debe aceptarlo para crear/editar platos.
  PREPARED = 'prepared',
}

export enum ServiceModality {
  IN_PERSON = 'in_person',
  VIRTUAL = 'virtual',
  HYBRID = 'hybrid',
}

export enum ServicePricingType {
  PER_HOUR = 'per_hour',
  PER_SESSION = 'per_session',
  PACKAGE = 'package',
  SUBSCRIPTION = 'subscription',
}

export enum BookingMode {
  PROVIDER_REQUIRED = 'provider_required',
  FREE_BOOKING = 'free_booking',
}
