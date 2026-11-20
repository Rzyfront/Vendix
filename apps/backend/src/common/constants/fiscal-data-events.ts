/**
 * Evento posterior al guardado de `settings.fiscal_data` (org o tienda).
 *
 * Se emite con `emitAsync` DESPUÉS de persistir: el listener del calendario
 * tributario (fiscal-operations) genera obligaciones y recordatorios y su
 * resultado vuelve a la respuesta del PATCH. Va por evento y no por inyección
 * porque los módulos de settings no pueden importar `FiscalOperationsModule`
 * (InvoicingModule → SettingsModule cerraría un ciclo DI).
 */
export const FISCAL_DATA_UPDATED_EVENT = 'fiscal_data.updated';

/** Decisión del diálogo de cambio de periodicidad de IVA. */
export const VAT_CALENDAR_CHANGE_DECISIONS = ['replace', 'keep'] as const;
export type VatCalendarChangeDecision =
  (typeof VAT_CALENDAR_CHANGE_DECISIONS)[number];

export interface FiscalDataUpdatedEvent {
  organization_id: number;
  /** Tienda destino con fiscal_scope STORE; null con ORGANIZATION. */
  store_id: number | null;
  user_id: number | null;
  previous_fiscal_data: Record<string, unknown>;
  next_fiscal_data: Record<string, unknown>;
  vat_calendar_change?: VatCalendarChangeDecision | null;
}

/** Resumen del calendario tributario devuelto junto a `fiscal_data`. */
export interface FiscalCalendarSummary {
  status: string;
  periodicity: string | null;
  obligations: number;
  reminders_created: number;
  reminders_scheduled: number;
  pending_confirmation: number;
  replaced: { obligations_cancelled: number; reminders_removed: number } | null;
  message: string;
}

/** Primer resumen válido entre los resultados de `emitAsync` (o null). */
export function pickFiscalCalendarSummary(
  results: unknown,
): FiscalCalendarSummary | null {
  if (!Array.isArray(results)) return null;
  const found = results.find(
    (r) => r && typeof r === 'object' && typeof (r as FiscalCalendarSummary).status === 'string',
  );
  return (found as FiscalCalendarSummary | undefined) ?? null;
}
