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
