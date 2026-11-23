import { notification_type_enum } from '@prisma/client';

/**
 * Catálogo de los tipos de aviso que cada persona configura por canal
 * (odd/tasks/recordatorios-notificaciones.md §3.2).
 *
 * Canales:
 * - Campana: siempre (es el historial); no se configura.
 * - Dispositivo (`push`): web push del navegador/PWA. Columna
 *   `notification_subscriptions.in_app`.
 * - Correo (`email`): columna `notification_subscriptions.email`.
 *
 * Sin fila en `notification_subscriptions` manda el `defaults` del tipo: no
 * hay backfill de filas. D1 (Rafael, 2026-11-23): el correo arranca APAGADO en
 * todos los tipos; cada persona lo enciende.
 *
 * `channels` dice qué canal puede controlar la persona para ese tipo. El
 * correo solo existe para avisos personales que pasan por
 * `NotificationDispatcher` (hoy, tareas CRM): los avisos a toda la tienda
 * (`createAndBroadcast`) no envían correo, así que no ofrecen ese interruptor.
 *
 * Fuera del catálogo a propósito (D3): `reminder_due` y `workflow_task` tienen
 * su propio correo (`user-reminder-due.job.ts`, `workflow-email.service.ts`);
 * si el despachador también lo enviara llegaría dos veces.
 */
export type NotificationChannel = 'push' | 'email';

export type NotificationChannelFlags = Record<NotificationChannel, boolean>;

export type NotificationGroupKey =
  | 'crm'
  | 'sales'
  | 'inventory'
  | 'customers'
  | 'payments'
  | 'layaway'
  | 'credit'
  | 'accounts_payable'
  | 'restaurant'
  | 'lodging';

export interface NotificationGroup {
  key: NotificationGroupKey;
  label: string;
}

export interface NotificationCatalogEntry {
  type: notification_type_enum;
  group: NotificationGroupKey;
  /** Nombre del aviso en lenguaje de negocio. */
  label: string;
  /** Cuándo llega, en palabras de quien decide si lo quiere. */
  description: string;
  /** Valor efectivo cuando la persona no ha guardado preferencia. */
  defaults: NotificationChannelFlags;
  /** Canales que la persona puede encender/apagar para este tipo. */
  channels: NotificationChannelFlags;
  /** False: el tipo existe pero no se muestra ni se acepta en el DTO. */
  user_configurable: boolean;
}

/** Orden en que la pantalla muestra los módulos. */
export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = [
  { key: 'crm', label: 'CRM' },
  { key: 'sales', label: 'Ventas y órdenes' },
  { key: 'payments', label: 'Pagos' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'customers', label: 'Clientes' },
  { key: 'layaway', label: 'Separados' },
  { key: 'credit', label: 'Ventas a crédito' },
  { key: 'accounts_payable', label: 'Cuentas por pagar' },
  { key: 'restaurant', label: 'Restaurante' },
  { key: 'lodging', label: 'Hotelería' },
];

/** Dispositivo encendido, correo apagado (D1). */
const PUSH_ONLY_DEFAULT: NotificationChannelFlags = { push: true, email: false };
/** Aviso a toda la tienda: solo se controla el dispositivo. */
const BROADCAST_CHANNELS: NotificationChannelFlags = { push: true, email: false };
/** Aviso personal: dispositivo y correo. */
const PERSONAL_CHANNELS: NotificationChannelFlags = { push: true, email: true };
/** Aviso personal que solo sale por correo (resumen diario). */
const EMAIL_ONLY_CHANNELS: NotificationChannelFlags = { push: false, email: true };

function broadcast(
  type: notification_type_enum,
  group: NotificationGroupKey,
  label: string,
  description: string,
): NotificationCatalogEntry {
  return {
    type,
    group,
    label,
    description,
    defaults: PUSH_ONLY_DEFAULT,
    channels: BROADCAST_CHANNELS,
    user_configurable: true,
  };
}

function personal(
  type: notification_type_enum,
  group: NotificationGroupKey,
  label: string,
  description: string,
  defaults: NotificationChannelFlags = PUSH_ONLY_DEFAULT,
  channels: NotificationChannelFlags = PERSONAL_CHANNELS,
): NotificationCatalogEntry {
  return {
    type,
    group,
    label,
    description,
    defaults,
    channels,
    user_configurable: true,
  };
}

export const NOTIFICATION_CATALOG: readonly NotificationCatalogEntry[] = [
  // ── CRM: avisos personales (responsable / apoyos / creador) ──────────────
  personal(
    'crm_task_assigned',
    'crm',
    'Tarea asignada',
    'Cuando alguien te asigna una tarea del CRM o te suma como apoyo.',
  ),
  personal(
    'crm_task_reassigned',
    'crm',
    'Tarea reasignada o reprogramada',
    'Cuando una tarea que era tuya pasa a otra persona, o cuando alguien más le cambia la fecha a una tarea tuya.',
  ),
  personal(
    'crm_task_due_soon',
    'crm',
    'Tarea por vencer',
    'Antes de que venza una tarea tuya o en la que eres apoyo, con la anticipación que define la tienda.',
  ),
  personal(
    'crm_task_due',
    'crm',
    'Tarea vencida',
    'Cuando una tarea tuya o en la que eres apoyo pasa su fecha sin completarse, y cuando una tarea que creaste para otra persona sigue vencida 24 horas después.',
  ),
  personal(
    'crm_task_closed',
    'crm',
    'Tarea completada o cancelada',
    'Cuando otra persona completa o cancela una tarea que tú creaste.',
  ),
  personal(
    'crm_task_digest',
    'crm',
    'Resumen diario de tareas',
    'Cada mañana, a la hora que define la tienda, un correo con tus tareas que vencen ese día.',
    { push: false, email: false },
    EMAIL_ONLY_CHANNELS,
  ),

  // ── Avisos a toda la tienda (createAndBroadcast) ──────────────────────────
  broadcast(
    'new_order',
    'sales',
    'Nuevas órdenes',
    'Cuando entra un pedido nuevo, venga del POS o de la tienda.',
  ),
  broadcast(
    'order_status_change',
    'sales',
    'Cambios de estado de orden',
    'Cuando una orden avanza o retrocede: confirmada, despachada, entregada, anulada.',
  ),
  broadcast(
    'payment_received',
    'payments',
    'Pagos recibidos',
    'Cuando se registra un pago sobre una orden o una cuenta.',
  ),
  broadcast(
    'low_stock',
    'inventory',
    'Stock bajo',
    'Cuando un producto baja del mínimo que definiste en Inventario.',
  ),
  broadcast(
    'new_customer',
    'customers',
    'Nuevos clientes',
    'Cuando se registra un cliente nuevo en la tienda.',
  ),
  broadcast(
    'new_review',
    'customers',
    'Nuevas reseñas',
    'Cuando un cliente califica un producto o la tienda.',
  ),
  broadcast(
    'layaway_payment_received',
    'layaway',
    'Abono a separado',
    'Cuando un cliente abona a un plan separado.',
  ),
  broadcast(
    'layaway_payment_reminder',
    'layaway',
    'Cuota de separado por vencer',
    'Cuando se acerca la fecha de una cuota de un plan separado.',
  ),
  broadcast(
    'layaway_overdue',
    'layaway',
    'Cuota de separado vencida',
    'Cuando una cuota de un plan separado pasó su fecha sin pagarse.',
  ),
  broadcast(
    'layaway_completed',
    'layaway',
    'Separado completado',
    'Cuando un plan separado queda pagado por completo.',
  ),
  broadcast(
    'layaway_cancelled',
    'layaway',
    'Separado cancelado',
    'Cuando se cancela un plan separado.',
  ),
  broadcast(
    'credit_installment_reminder',
    'credit',
    'Cuota de crédito por vencer',
    'Cuando una cuota de una venta a crédito entra en un recordatorio de Configuración → Venta → Ventas a crédito.',
  ),
  broadcast(
    'ap_installment_due_soon',
    'accounts_payable',
    'Pago a proveedor por vencer',
    'Cuando una cuota de Cuentas por Pagar entra en la ventana de anticipación que definiste en los ajustes de la tienda.',
  ),
  broadcast(
    'ap_installment_overdue',
    'accounts_payable',
    'Pago a proveedor vencido',
    'Cuando una cuota de Cuentas por Pagar pasó su fecha de vencimiento sin pagarse.',
  ),
  broadcast(
    'kitchen_ticket_ready',
    'restaurant',
    'Pedido listo en cocina',
    'Cuando cocina marca un pedido como listo para llevar a la mesa.',
  ),
  broadcast(
    'lodging_rnt_renewal',
    'lodging',
    'Renovación del RNT',
    'Cada marzo, para renovar el Registro Nacional de Turismo antes del 31.',
  ),
];

const CATALOG_BY_TYPE = new Map<string, NotificationCatalogEntry>(
  NOTIFICATION_CATALOG.map((entry) => [entry.type, entry]),
);

/** Tipos que la persona puede configurar (lo que acepta el DTO). */
export const CONFIGURABLE_NOTIFICATION_TYPES: readonly string[] =
  NOTIFICATION_CATALOG.filter((entry) => entry.user_configurable).map(
    (entry) => entry.type,
  );

/**
 * Tipos fuera del catálogo (avisos operativos dirigidos: turno del
 * profesional, mesa, reparto, Flujos, Vexi…): el dispositivo queda encendido
 * como siempre y nunca hay correo desde el despachador.
 */
export const UNCATALOGUED_DEFAULTS: NotificationChannelFlags = {
  push: true,
  email: false,
};

export function getNotificationCatalogEntry(
  type: string,
): NotificationCatalogEntry | undefined {
  return CATALOG_BY_TYPE.get(type);
}

/** Fila guardada de `notification_subscriptions` (solo lo que importa aquí). */
export interface StoredSubscription {
  in_app: boolean;
  email: boolean;
}

/**
 * Valor efectivo por canal: la fila de la persona si existe, si no el default
 * del tipo. Un canal que el tipo no ofrece queda siempre apagado aunque la
 * fila diga otra cosa (p. ej. correo en un aviso a toda la tienda, o
 * dispositivo en el resumen diario, que es solo correo).
 */
export function resolveEffectiveChannels(
  type: string,
  row?: StoredSubscription | null,
): NotificationChannelFlags {
  const entry = getNotificationCatalogEntry(type);
  const defaults = entry?.defaults ?? UNCATALOGUED_DEFAULTS;
  const pushAllowed = entry?.channels.push ?? true;
  const emailAllowed = entry?.channels.email ?? false;
  return {
    push: pushAllowed ? (row ? row.in_app : defaults.push) : false,
    email: emailAllowed ? (row ? row.email : defaults.email) : false,
  };
}
