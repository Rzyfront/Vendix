import { resolveTimezoneCascade } from '../../../../common/utils/store-timezone.util';

/** D2 (Rafael, 2026-11-23): "por vencer" = 60 minutos antes. */
export const DEFAULT_TASK_DUE_SOON_MINUTES = 60;
export const MIN_TASK_DUE_SOON_MINUTES = 5;
export const MAX_TASK_DUE_SOON_MINUTES = 1440;
/** Hora local de la tienda en que sale el resumen diario de tareas. */
export const DEFAULT_DAILY_DIGEST_HOUR = 7;

/** Ajustes de la tienda que deciden cuándo dispara un recordatorio. */
export interface StoreReminderSettings {
  /** `notifications.task_due_soon_minutes` (5-1440, default 60). */
  due_soon_minutes: number;
  /** `notifications.daily_digest_hour` (0-23, default 7). */
  digest_hour: number;
  /** Zona horaria de la tienda, columna primero (igual que `resolveStoreTimezone`). */
  timezone: string;
}

/** Lector mínimo de `store_settings`: sirve el cliente global o el de tienda. */
export interface StoreReminderSettingsReader {
  store_settings: {
    findFirst: (args: {
      where: { store_id: number };
      select: { settings: true; stores: { select: { timezone: true } } };
    }) => Promise<{
      settings: unknown;
      stores?: { timezone: string | null } | null;
    } | null>;
  };
}

function integerIn(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
}

/**
 * Lee los ajustes de recordatorios de UNA tienda. Corre sin contexto (crons),
 * así que la tienda va explícita. Un valor ausente o fuera de rango cae al
 * default: la tienda que nunca guardó la llave se comporta como D2.
 */
export async function readStoreReminderSettings(
  prisma: StoreReminderSettingsReader,
  store_id: number,
): Promise<StoreReminderSettings> {
  const row = await prisma.store_settings.findFirst({
    where: { store_id },
    select: { settings: true, stores: { select: { timezone: true } } },
  });
  const settings =
    row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? (row.settings as Record<string, any>)
      : {};
  const notifications =
    settings.notifications && typeof settings.notifications === 'object'
      ? (settings.notifications as Record<string, unknown>)
      : {};
  return {
    due_soon_minutes: integerIn(
      notifications.task_due_soon_minutes,
      MIN_TASK_DUE_SOON_MINUTES,
      MAX_TASK_DUE_SOON_MINUTES,
      DEFAULT_TASK_DUE_SOON_MINUTES,
    ),
    digest_hour: integerIn(notifications.daily_digest_hour, 0, 23, DEFAULT_DAILY_DIGEST_HOUR),
    timezone: resolveTimezoneCascade(
      row?.stores?.timezone,
      settings.general?.timezone as string | null | undefined,
    ),
  };
}
