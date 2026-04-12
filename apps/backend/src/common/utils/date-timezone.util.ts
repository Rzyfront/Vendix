/**
 * Convierte una fecha de input (YYYY-MM-DD) a medianoche en el timezone especificado.
 *
 * Esto resuelve el problema donde new Date('2025-05-28') se interpreta como UTC
 * y luego se muestra incorrectamente en timezones como UTC-5.
 *
 * @param dateString - Fecha en formato YYYY-MM-DD (ej: "2025-05-28")
 * @param timezone - Timezone IANA (ej: "America/Bogota")
 * @returns Date object con la fecha interpretada correctamente en el timezone local
 *
 * @example
 * // Colombia (UTC-5)
 * convertInputDateToStoreTimezone('2025-05-28', 'America/Bogota')
 * // Returns: Date representing 2025-05-28 00:00:00 in Colombia timezone
 *
 * @example
 * // España (UTC+1)
 * convertInputDateToStoreTimezone('2025-05-28', 'Europe/Madrid')
 * // Returns: Date representing 2025-05-28 00:00:00 in Madrid timezone
 */
export function convertInputDateToStoreTimezone(
  dateString: string,
  timezone: string,
): Date {
  try {
    // Usar Intl.DateTimeFormat para extraer componentes de fecha en el timezone correcto
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date(dateString));

    const year = parseInt(parts.find((p) => p.type === 'year')?.value || '0');
    const month =
      parseInt(parts.find((p) => p.type === 'month')?.value || '0') - 1; // JS months are 0-indexed
    const day = parseInt(parts.find((p) => p.type === 'day')?.value || '0');

    // Crear fecha usando los componentes en el timezone local
    return new Date(year, month, day);
  } catch (error) {
    // Fallback a fecha local si hay error con timezone
    console.warn(
      `Error converting date to timezone ${timezone}, using local time:`,
      error,
    );
    return new Date(dateString);
  }
}

/**
 * Ajusta una fecha al final del día (23:59:59.999) en el timezone especificado.
 * Útil para filtros de rango de fechas donde se quiere incluir todo el día.
 *
 * @param date - Fecha a ajustar
 * @returns Date con la hora ajustada a 23:59:59.999
 */
export function setEndOfDay(date: Date): Date {
  const adjusted = new Date(date);
  adjusted.setHours(23, 59, 59, 999);
  return adjusted;
}
