/**
 * PLAN-analytics-despachos-2026-09-12 — human-readable labels for the 5
 * `portador_tipo` / `conductor_tipo` values the backend contract emits
 * (backend `PortadorTipo`, ADR-01 of `dispatch-analytics.service.ts`).
 *
 * `registrado_por` means "who typed this delivery into the system", NOT who
 * drove it. Every carrier/route table in this category MUST show this label
 * next to the name — hiding it would attribute real deliveries to whoever
 * happened to register them from the office.
 */
const PORTADOR_TIPO_LABELS: Record<string, string> = {
  conductor_interno: 'Conductor interno',
  conductor_externo: 'Conductor externo',
  auxiliar: 'Auxiliar',
  domiciliario: 'Domiciliario',
  registrado_por: 'Registrado por',
};

export function portadorTipoLabel(tipo: string | null | undefined): string {
  if (!tipo) return 'Sin tipo';
  return PORTADOR_TIPO_LABELS[tipo] ?? tipo;
}
