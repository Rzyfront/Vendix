/**
 * Nombres de `system_payment_methods` que toda tienda nueva debe tener
 * habilitados al terminar el onboarding. Es la única fuente de verdad —
 * mantener sincronizado con `apps/backend/prisma/seeds/system-payment-methods.seed.ts`.
 *
 * Reglas de inclusión:
 *  - Métodos sin config obligatoria (`requires_config = false`).
 *  - Métodos con processor registrado en `payments.module.ts`.
 *  - Excluir gateways externos que requieren credenciales (Wompi, Stripe, etc.).
 *
 * Reglas de exclusión (futuro):
 *  - Métodos marcados como opt-in en `system_payment_methods.requires_config`.
 *  - Métodos cuyo processor no esté registrado.
 *
 * @see apps/backend/src/domains/store/payments/payments.service.ts (getStorePaymentMethods)
 * @see apps/backend/prisma/seeds/system-payment-methods.seed.ts
 */
export const BASE_SYSTEM_PAYMENT_METHOD_NAMES: readonly string[] = [
  'cash',
  'payment_vouchers',
  'wallet',
] as const;
