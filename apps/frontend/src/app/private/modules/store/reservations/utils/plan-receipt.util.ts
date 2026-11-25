import type { PlanBookingItinerary } from '../../products/services/service-plans.service';
import { formatItineraryDate, formatPlanDuration } from '../../../../../shared/utils/plan-itinerary.util';

/** Marca de una reserva de plan (F1): evento elegido o tamaño del grupo guardado. */
export function isPlanBooking(booking: { departure_id?: number | null; pax_adults?: number | null }): boolean {
  return booking.departure_id != null || booking.pax_adults != null;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LABEL_STYLE =
  'margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;';

function paxText(adults: number | null, children: number | null): string {
  const parts: string[] = [];
  if (adults) parts.push(`${adults} ${adults === 1 ? 'adulto' : 'adultos'}`);
  if (children) parts.push(`${children} ${children === 1 ? 'niño' : 'niños'}`);
  return parts.join(' y ');
}

/**
 * QUI-1060 F2: bloque del comprobante para una reserva de plan. Evento (o fecha
 * libre), ida y regreso, grupo e itinerario público por día con fechas reales.
 * Solo trae lo que el servidor marcó como público: nunca costo ni proveedor.
 */
export function planReceiptHtml(plan: PlanBookingItinerary): string {
  const pax = paxText(plan.pax_adults, plan.pax_children);
  const days = plan.itinerary
    .map((day) => {
      const items = day.activities
        .map(
          (a) => `
          <li style="margin: 0 0 4px; font-size: 13px; color: #374151;">
            ${a.start_time ? `<span style="font-weight: 600;">${escapeHtml(a.start_time)}</span> · ` : ''}${escapeHtml(a.title)}
            ${a.description ? `<div style="font-size: 12px; color: #6b7280; white-space: pre-wrap;">${escapeHtml(a.description)}</div>` : ''}
          </li>`,
        )
        .join('');
      return `
        <div style="margin-bottom: 12px;">
          <p style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #111827;">
            Día ${day.day_number}${day.date ? ` · ${escapeHtml(formatItineraryDate(day.date))}` : ''}
          </p>
          <ul style="margin: 0; padding-left: 18px;">${items}</ul>
        </div>`;
    })
    .join('');

  return `
    <!-- Plan (QUI-1060) -->
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="${LABEL_STYLE}">Plan</h3>
      <div class="vx-flex-row" style="font-size: 13px; color: #374151;">
        <p style="margin: 0;"><span style="font-weight: 600;">${plan.departure_id != null ? 'Evento' : 'Fecha de inicio'}:</span> ${escapeHtml(formatItineraryDate(plan.start_date))}</p>
        <p style="margin: 0;"><span style="font-weight: 600;">Regreso:</span> ${escapeHtml(formatItineraryDate(plan.end_date))}</p>
        <p style="margin: 0;"><span style="font-weight: 600;">Duración:</span> ${escapeHtml(formatPlanDuration(plan.duration_days, plan.duration_nights))}</p>
        ${pax ? `<p style="margin: 0;"><span style="font-weight: 600;">Personas:</span> ${escapeHtml(pax)}</p>` : ''}
      </div>
    </div>
    ${
      plan.itinerary.length > 0
        ? `
    <div style="border-radius: 8px; padding: 16px; margin-bottom: 24px; border: 1px solid #e5e7eb;">
      <h3 style="${LABEL_STYLE}">Itinerario</h3>
      ${days}
    </div>`
        : ''
    }`;
}
