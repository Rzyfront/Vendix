/**
 * RENEWAL ELIGIBILITY CONTRACT — el único dueño de "¿esta suscripción puede
 * renovarse sola?".
 *
 * Antes de este archivo la pregunta tenía DOS implementaciones privadas que se
 * contradecían en ambos sentidos:
 *
 *   - `SubscriptionPaymentService.resolveReusablePaymentMethod` exigía
 *     `is_default`, vigencia y `consecutive_failures < MAX`, pero **no** la
 *     credencial recurrente (`cof_registered_at`).
 *   - El gate `disableAutoRenewForMissingCredential` exigía `cof_registered_at`
 *     y **ninguna** de las otras.
 *
 * Resultado medido en producción: una tienda pagó con un medio que no renueva,
 * el gate apagó `auto_renew`, y nadie más en la cadena (ni el cron, ni la
 * ventana de reactivación, ni la lectura del panel) compartía el criterio. La
 * renovación falló en silencio hasta caer en periodo de gracia.
 *
 * Reglas duras que este archivo fija de una vez:
 *
 *  1. **Solo TARJETA renueva.** `autoRegisterPaymentMethodFromGateway` ya es
 *     NO-OP cuando el medio no es `CARD` (Nequi/PSE son one-shot por contrato de
 *     Wompi), así que cualquier otro tipo NO puede sostener una renovación.
 *  2. El medio debe estar `active`, no vencido y por debajo del techo de fallos
 *     consecutivos.
 *  3. Debe tener credencial cobrable: `cof_registered_at` (COF/MIT) o —
 *     mientras `WOMPI_RECURRENT_ENFORCE` siga apagado — el `provider_token`
 *     heredado que el cobrador todavía acepta. La bandera se lee AQUÍ para que
 *     cobrador, gate, cron, rearme y panel no puedan responder distinto.
 *  4. `is_default` es una PREFERENCIA de selección, nunca un requisito de
 *     elegibilidad. Exigirlo convertía "no hay tarjeta por defecto" en "no se
 *     puede renovar" y era la mitad de la divergencia original.
 *
 * Ningún consumidor vuelve a reescribir el predicado en su call site: eso es la
 * regresión. Todo `auto_renew: true` debe pasar por aquí.
 */

import { Prisma, subscription_payment_method_state_enum } from '@prisma/client';
import {
  isLegacyInlineTokenAllowed,
  isWompiRecurrentEnforced,
} from '../payments/config/wompi-rollout.config';

/**
 * S3.5 — Techo de cobros automáticos fallidos consecutivos contra un medio de
 * pago antes de invalidarlo. Vive aquí porque es parte del predicado; el
 * servicio de pagos lo re-exporta para no romper importadores existentes.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Tipos de `subscription_payment_methods.type` que pueden sostener una
 * renovación automática. Los escritores (`tokenizeAndRegister` y
 * `autoRegisterPaymentMethodFromGateway`) normalizan a minúsculas.
 */
export const RENEWAL_ELIGIBLE_PM_TYPES = ['card'] as const;

/** Motivo canónico por el que el autopago queda en pausa. */
export const AUTO_RENEW_PAUSE_REASON_NO_CARD = 'no_card_credential';

/** Llave dentro de `store_subscriptions.metadata` que recuerda la intención. */
export const AUTO_RENEW_INTENT_KEY = 'auto_renew_intent';

/**
 * Origen de la pausa. Sirve para auditoría y para el log; no cambia la regla.
 */
export type AutoRenewPauseSource =
  | 'checkout_commit'
  | 'webhook'
  | 'renewal_cron'
  | 'manual_payment'
  | 'reactivation_window'
  | 'unschedule_cancel'
  // Caminos de `SubscriptionProrationService`. `plan_change` cubre además el
  // salto a plan gratis, que no emite factura y por tanto NO pasa por ningún
  // gate posterior: es el único camino donde este resolvedor es la última
  // defensa antes de encender el autopago de una tienda sin tarjeta.
  | 'plan_change'
  | 'resubscribe';

/**
 * Intención del cliente respecto al autopago, recordada en
 * `store_subscriptions.metadata.auto_renew_intent`.
 *
 * Reutiliza el mismo mecanismo que `metadata.pending_credit` — columna JSON que
 * YA existe — para no necesitar migración. `desired: true` significa "el cliente
 * quería autopago y se lo apagamos nosotros por falta de tarjeta", que es
 * exactamente la condición que autoriza el rearme automático al guardar una.
 */
export interface AutoRenewIntent {
  /** true = el cliente quiere autopago; nosotros lo pausamos. */
  desired: boolean;
  /** Motivo de la pausa, o null cuando ya se rearmó. */
  reason: string | null;
  /** ISO del momento en que se pausó. */
  paused_at: string | null;
  /** Origen de la pausa (auditoría). */
  paused_by: AutoRenewPauseSource | string | null;
  /** ISO del rearme, cuando ya ocurrió. */
  rearmed_at: string | null;
}

/**
 * Fila mínima de `subscription_payment_methods` que el predicado necesita.
 * Las filas completas de Prisma la satisfacen estructuralmente.
 */
export interface RenewalEligibilityCandidate {
  id: number;
  type: string;
  state: subscription_payment_method_state_enum;
  provider_token: string | null;
  provider_payment_source_id: string | null;
  cof_registered_at: Date | null;
  expiry_month: string | null;
  expiry_year: string | null;
  consecutive_failures: number | null;
  is_default: boolean;
  created_at?: Date;
}

/** Medio de pago apto, en la forma que el cobrador consume. */
export interface RenewalEligiblePaymentMethod {
  id: number;
  provider_token: string;
  provider_payment_source_id: string | null;
}

/** Tipos de aviso de autopago que el panel sabe pintar. */
export type AutoRenewWarningType =
  | 'auto_renew_charge_failed'
  | 'auto_renew_disabled_no_credential';

/**
 * Contrato EXACTO que `GET /store/subscriptions/current` añade a la fila de
 * `store_subscriptions`. Los tres nombres los fija el facade del panel
 * (`subscription.facade.ts`), que ya los lee; no se renombran.
 *
 * Se derivan en lectura desde `subscription_events` + `billing_warning_logs` +
 * `notifications` — NO hay columnas nuevas.
 */
export interface AutoRenewWarningState {
  auto_renew_warning_type: AutoRenewWarningType | null;
  auto_renew_warning_notification_id: number | null;
  auto_renew_last_retry_at: string | null;
}

// ---------------------------------------------------------------------------
// Predicado en memoria (LA definición)
// ---------------------------------------------------------------------------

/** `MM`/`YYYY` de referencia, en UTC, para comparar vigencia. */
function utcExpiryBounds(now: Date): { year: string; month: string } {
  return {
    year: String(now.getUTCFullYear()).padStart(4, '0'),
    month: String(now.getUTCMonth() + 1).padStart(2, '0'),
  };
}

/**
 * `true` cuando la tarjeta NO está vencida. `expiry_month`/`expiry_year` nulos
 * significan "desconocido" y NO descalifican (redondea a favor del cliente:
 * el emisor decide en el cobro).
 */
function isNotExpired(pm: RenewalEligibilityCandidate, now: Date): boolean {
  if (!pm.expiry_month || !pm.expiry_year) return true;
  const expMonth = parseInt(pm.expiry_month, 10);
  const expYear = parseInt(pm.expiry_year, 10);
  if (Number.isNaN(expMonth) || Number.isNaN(expYear)) return true;
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (expYear < currentYear) return false;
  if (expYear === currentYear && expMonth < currentMonth) return false;
  return true;
}

/**
 * `true` cuando el medio tiene una credencial que el cobrador puede usar.
 *
 * Bajo `WOMPI_RECURRENT_ENFORCE=true` exige COF completo
 * (`provider_payment_source_id` + `cof_registered_at`), que es literalmente lo
 * que `charge()` requiere en modo enforce. Con la bandera apagada acepta el
 * `provider_token` heredado, que es lo que `charge()` sigue cobrando hoy.
 */
function hasChargeableCredential(pm: RenewalEligibilityCandidate): boolean {
  if (isWompiRecurrentEnforced()) {
    return !!pm.provider_payment_source_id && !!pm.cof_registered_at;
  }
  return !!pm.provider_token || !!pm.cof_registered_at;
}

/**
 * EL predicado. Todo lo demás en este archivo es una proyección de esta función.
 */
export function isRenewalEligible(
  pm: RenewalEligibilityCandidate,
  now: Date = new Date(),
): boolean {
  if (pm.state !== subscription_payment_method_state_enum.active) return false;
  if (
    !RENEWAL_ELIGIBLE_PM_TYPES.includes(
      String(pm.type ?? '').toLowerCase() as (typeof RENEWAL_ELIGIBLE_PM_TYPES)[number],
    )
  ) {
    return false;
  }
  if (!hasChargeableCredential(pm)) return false;
  if ((pm.consecutive_failures ?? 0) >= MAX_CONSECUTIVE_FAILURES) return false;
  if (!isNotExpired(pm, now)) return false;
  return true;
}

/**
 * Ordena los candidatos aptos y devuelve el que el cobrador debe usar.
 *
 * Preferencia: `is_default` primero (el failover de RNC-25 depende de que el
 * default apunte a la última tarjeta cobrada), luego la credencial recurrente
 * más reciente, luego el id más alto. `is_default` NO filtra: una tienda con
 * una tarjeta apta pero sin default se cobra igual en vez de caer en dunning.
 */
export function pickRenewalEligiblePaymentMethod<
  T extends RenewalEligibilityCandidate,
>(rows: readonly T[], now: Date = new Date()): T | null {
  const eligible = rows.filter((row) => isRenewalEligible(row, now));
  if (!eligible.length) return null;
  const sorted = [...eligible].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    const aCof = a.cof_registered_at ? a.cof_registered_at.getTime() : 0;
    const bCof = b.cof_registered_at ? b.cof_registered_at.getTime() : 0;
    if (aCof !== bCof) return bCof - aCof;
    return b.id - a.id;
  });
  return sorted[0];
}

/** Proyección al shape que consume el cobrador. */
export function toRenewalEligiblePaymentMethod(
  pm: RenewalEligibilityCandidate,
): RenewalEligiblePaymentMethod | null {
  if (!pm.provider_token) return null;
  return {
    id: pm.id,
    provider_token: pm.provider_token,
    provider_payment_source_id: pm.provider_payment_source_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Proyecciones Prisma (pre-filtro en SQL del MISMO predicado)
// ---------------------------------------------------------------------------

/**
 * Forma SQL de un medio apto, SIN el filtro de suscripción, para poder anidarla
 * bajo `store_subscriptions.payment_methods.some`.
 *
 * Espeja `isRenewalEligible`. El comparador de vigencia es lexicográfico y es
 * correcto porque los escritores normalizan `expiry_year` a 4 dígitos y
 * `expiry_month` a 2 con `padStart`. Aun así, todo lector debe pasar el
 * resultado por `pickRenewalEligiblePaymentMethod`, que re-verifica en memoria:
 * el SQL es un pre-filtro, la función es la verdad.
 */
export function renewalEligiblePmShapeWhere(
  now: Date = new Date(),
): Prisma.subscription_payment_methodsWhereInput {
  const { year, month } = utcExpiryBounds(now);
  const credential: Prisma.subscription_payment_methodsWhereInput =
    isLegacyInlineTokenAllowed()
      ? {}
      : {
          provider_payment_source_id: { not: null },
          cof_registered_at: { not: null },
        };

  return {
    state: subscription_payment_method_state_enum.active,
    type: { in: [...RENEWAL_ELIGIBLE_PM_TYPES] },
    consecutive_failures: { lt: MAX_CONSECUTIVE_FAILURES },
    NOT: { provider_token: '' },
    ...credential,
    AND: [
      {
        OR: [
          { expiry_year: null },
          { expiry_month: null },
          { expiry_year: { gt: year } },
          {
            AND: [{ expiry_year: year }, { expiry_month: { gte: month } }],
          },
        ],
      },
    ],
  };
}

/** La misma forma, acotada a una suscripción. */
export function renewalEligiblePmWhere(
  storeSubscriptionId: number,
  now: Date = new Date(),
): Prisma.subscription_payment_methodsWhereInput {
  return {
    store_subscription_id: storeSubscriptionId,
    ...renewalEligiblePmShapeWhere(now),
  };
}

/**
 * Predicado de suscripción para el `where` del cron de renovación: el cliente
 * quiere autopago Y existe al menos un medio apto.
 *
 * Se usa como pre-filtro observable, no como única defensa: el cron re-verifica
 * cada fila con `pickRenewalEligiblePaymentMethod` antes de cobrar, y cuando no
 * hay medio apto PAUSA Y AVISA en vez de cobrar contra el vacío.
 */
export function subscriptionRenewalEligibleWhere(
  now: Date = new Date(),
): Prisma.store_subscriptionsWhereInput {
  return {
    auto_renew: true,
    payment_methods: { some: renewalEligiblePmShapeWhere(now) },
  };
}

// ---------------------------------------------------------------------------
// Intención recordada (metadata JSON — sin columnas nuevas)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Lee la intención guardada. `null` cuando nunca se pausó. */
export function readAutoRenewIntent(metadata: unknown): AutoRenewIntent | null {
  const raw = asRecord(metadata)[AUTO_RENEW_INTENT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bag = raw as Record<string, unknown>;
  return {
    desired: bag.desired === true,
    reason: typeof bag.reason === 'string' ? bag.reason : null,
    paused_at: typeof bag.paused_at === 'string' ? bag.paused_at : null,
    paused_by: typeof bag.paused_by === 'string' ? bag.paused_by : null,
    rearmed_at: typeof bag.rearmed_at === 'string' ? bag.rearmed_at : null,
  };
}

/**
 * `true` cuando el cliente quiere autopago y sigue pausado. Es la condición que
 * autoriza el rearme automático al guardar una tarjeta.
 */
export function autoRenewIntentDesired(metadata: unknown): boolean {
  const intent = readAutoRenewIntent(metadata);
  return !!intent && intent.desired === true && intent.rearmed_at === null;
}

/**
 * Devuelve el `metadata` completo con la intención marcada como "pausada, el
 * cliente la quiere". Preserva cualquier otra llave (`pending_credit` incluido).
 *
 * LA PRIMERA PAUSA MANDA: si ya hay una intención pausada sin rearmar, se
 * devuelve intacta. En una misma transacción de checkout el gate pausa y luego la
 * ventana de reactivación vuelve a evaluar; pisar `paused_at` en cada paso movería
 * el instante que el aviso en pantalla y la auditoría reportan.
 */
export function metadataWithPausedAutoRenewIntent(
  metadata: unknown,
  args: { source: AutoRenewPauseSource; reason?: string; now?: Date },
): Record<string, unknown> {
  const base = asRecord(metadata);
  const existing = readAutoRenewIntent(metadata);
  if (existing && existing.desired === true && existing.rearmed_at === null) {
    return { ...base, [AUTO_RENEW_INTENT_KEY]: existing };
  }
  const now = args.now ?? new Date();
  const intent: AutoRenewIntent = {
    desired: true,
    reason: args.reason ?? AUTO_RENEW_PAUSE_REASON_NO_CARD,
    paused_at: now.toISOString(),
    paused_by: args.source,
    rearmed_at: null,
  };
  return { ...base, [AUTO_RENEW_INTENT_KEY]: intent };
}

/**
 * Devuelve el `metadata` completo con la intención cumplida (autopago rearmado).
 * Conserva la traza de la pausa para auditoría.
 */
export function metadataWithRearmedAutoRenewIntent(
  metadata: unknown,
  now: Date = new Date(),
): Record<string, unknown> {
  const base = asRecord(metadata);
  const previous = readAutoRenewIntent(metadata);
  const intent: AutoRenewIntent = {
    desired: false,
    reason: previous?.reason ?? null,
    paused_at: previous?.paused_at ?? null,
    paused_by: previous?.paused_by ?? null,
    rearmed_at: now.toISOString(),
  };
  return { ...base, [AUTO_RENEW_INTENT_KEY]: intent };
}
