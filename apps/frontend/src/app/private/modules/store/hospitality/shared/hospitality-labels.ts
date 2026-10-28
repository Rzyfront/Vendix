/**
 * Hospitality glossary (ui-ux-rules R-TERM-02): the Spanish term every screen
 * shows, keyed by the concept. Use these instead of anglicisms or raw codes.
 */
export const HOSPITALITY_TERMS = {
  housekeeping: 'Limpieza',
  housekeepingTask: 'Tarea de limpieza',
  housekeeper: 'Camarera',
  folio: 'Cuenta del huésped',
  splitFolio: 'Dividir cuenta',
  allotment: 'Cupos para agencias',
  stopSell: 'Cerrar venta',
  closedToArrival: 'Sin llegadas ese día',
  closedToDeparture: 'Sin salidas ese día',
  mealPlan: 'Plan de comidas',
  adr: 'Tarifa media por noche (ADR)',
  revpar: 'Ingreso por habitación disponible (RevPAR)',
  pickup7: 'Reservas nuevas en los últimos 7 días',
  pickupForecast: 'Ritmo de reservas y pronóstico',
  noShow: 'No se presentó',
  nightAudit: 'Cierre del día',
  channels: 'Calendarios externos (Airbnb, Booking…)',
  webBooking: 'Tienda en línea (reserva web)',
  unit: 'Habitación',
  walkIn: 'Llegada sin reserva',
  sire: 'Planilla de viajeros (Migración)',
  rnt: 'Registro Nacional de Turismo (RNT)',
  outOfOrder: 'Fuera de servicio',
  outOfService: 'Bloqueada',
} as const;

export type HospitalityTerm = keyof typeof HOSPITALITY_TERMS;

/**
 * U3 (R-TERM-01) — the desk phrase of each reason the backend gives for a
 * holder who cannot take the VAT exemption. The permit reason lists raw
 * Migración codes (PIP-3, TP-12, PT…), so it becomes a plain sentence; an
 * unknown reason is shown as it came.
 */
const VAT_EXEMPTION_REASON_PHRASES: ReadonlyArray<[RegExp, string]> = [
  [/^La tienda no tiene RNT/, `Falta el ${HOSPITALITY_TERMS.rnt} del hotel (Configuración → Hotelería)`],
  [/^Registra al titular/, 'Falta registrar al titular de la reserva'],
  [/pasaporte/, 'Falta el pasaporte del titular'],
  [/nacionalidad extranjera/, 'Falta la nacionalidad extranjera del titular'],
  [/no residente/, 'Falta marcar al titular como no residente'],
  [/permiso de ingreso/, 'Falta el sello o permiso de ingreso de Migración del titular'],
];

export function vatExemptionReasonLabel(reason: string): string {
  return VAT_EXEMPTION_REASON_PHRASES.find(([pattern]) => pattern.test(reason))?.[1] ?? reason;
}

/**
 * U4 (R-TERM-01) — the desk phrase of an electronic invoice state. The
 * check-out reports either the fiscal emission state (`issued`, `pending`…)
 * or the stored invoice status (`accepted`, `rejected`…); an unknown value
 * reads as a generic "en proceso" instead of the raw enum.
 */
const INVOICE_STATE_LABELS: Record<string, string> = {
  issued: 'aceptada por la DIAN',
  accepted: 'aceptada por la DIAN',
  pending: 'en envío a la DIAN',
  sent: 'en envío a la DIAN',
  draft: 'en preparación',
  validated: 'en preparación',
  contingency: 'en contingencia: se enviará a la DIAN',
  failed: 'no se pudo emitir',
  rejected: 'rechazada por la DIAN',
  not_applicable: 'sin factura electrónica',
  cancelled: 'anulada',
  voided: 'anulada',
};

export function invoiceStateLabel(state: string): string {
  return INVOICE_STATE_LABELS[state] ?? 'en proceso';
}
