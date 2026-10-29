import { Prisma } from '@prisma/client';
import {
  CancellationPolicySnapshot,
  PenaltyTerm,
} from '../../rates/lodging-cancellation-penalty';
import { formatShortDate } from '../stay-dates';
import { rntLine } from '../../compliance/rnt';

/**
 * Hospitality Suite (H6.6) — pure pieces of the booking engine: what the
 * traveler pays online, the policy shown before paying, the hold expiry and
 * the confirmation email.
 */

/** Minutes a web booking holds its rooms when the store never set it. */
export const DEFAULT_BOOKING_HOLD_MINUTES = 15;

/** The store setting, clamped to the range the settings form allows. */
export function bookingHoldMinutes(value: unknown): number {
  const minutes = Number(value);
  if (!Number.isInteger(minutes)) return DEFAULT_BOOKING_HOLD_MINUTES;
  return Math.min(120, Math.max(5, minutes));
}

export function holdExpiry(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Paid online now: the deposit the plan asks (H2.4), or the whole stay when
 * the plan asks none, so every web booking is guaranteed.
 */
export function amountDueNow(total: Prisma.Decimal, deposit_percent: Prisma.Decimal): Prisma.Decimal {
  if (deposit_percent.lte(0) || deposit_percent.gte(100)) return total.toDecimalPlaces(2);
  return total.mul(deposit_percent).div(100).toDecimalPlaces(2);
}

function termText(term: PenaltyTerm): string {
  if (term.penalty_type === 'percent') return `${term.penalty_value} % de la estadía`;
  return `${term.penalty_value} ${term.penalty_value === 1 ? 'noche' : 'noches'}`;
}

/**
 * "Flexible: gratis hasta 48 h antes de la llegada; menos de 48 h: 1 noche;
 * no-show: 1 noche". Null = the plan has no policy.
 */
export function policyText(policy: CancellationPolicySnapshot | null): string | null {
  if (!policy) return null;
  const rules = [...policy.rules].sort((a, b) => b.hours_before - a.hours_before);
  const parts: string[] = [];
  if (rules.length === 0) {
    parts.push('cancelación gratis');
  } else {
    parts.push(`gratis hasta ${rules[0].hours_before} h antes de la llegada`);
    for (const rule of rules) parts.push(`menos de ${rule.hours_before} h: ${termText(rule)}`);
  }
  if (policy.no_show_penalty) parts.push(`no-show: ${termText(policy.no_show_penalty)}`);
  return `${policy.name}: ${parts.join('; ')}`;
}

export interface BookingConfirmation {
  guest_name: string;
  store_name: string;
  reservation_number: string;
  arrival_date: string;
  departure_date: string;
  nights: number;
  room_type: string;
  adults: number;
  children: number;
  total: string;
  paid: string;
  balance: string;
  check_in_time: string;
  check_out_time: string;
  policy: string | null;
  /** H4.3 — the hotel's RNT, printed at the foot of the voucher; null when unset. */
  rnt_number?: string | null;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Confirmation email of a web booking paid online. */
export function bookingConfirmationEmail(data: BookingConfirmation): {
  subject: string;
  html: string;
  text: string;
} {
  const guests = `${data.adults} ${data.adults === 1 ? 'adulto' : 'adultos'}${
    data.children > 0 ? `, ${data.children} ${data.children === 1 ? 'niño' : 'niños'}` : ''
  }`;
  const rows: Array<[string, string]> = [
    ['Reserva', data.reservation_number],
    ['Llegada', `${formatShortDate(data.arrival_date)} desde las ${data.check_in_time}`],
    ['Salida', `${formatShortDate(data.departure_date)} hasta las ${data.check_out_time}`],
    ['Habitación', `${data.room_type} · ${data.nights} ${data.nights === 1 ? 'noche' : 'noches'}`],
    ['Huéspedes', guests],
    ['Total de la estadía', data.total],
    ['Pagado en línea', data.paid],
    ['Saldo en el hotel', data.balance],
  ];
  if (data.policy) rows.push(['Política de cancelación', data.policy]);
  const rnt = rntLine(data.rnt_number);
  const subject = `Reserva ${data.reservation_number} confirmada · ${data.store_name}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p>Hola <strong>${escape(data.guest_name)}</strong>,</p>
      <p>Tu reserva en <strong>${escape(data.store_name)}</strong> está confirmada. Recibimos tu pago.</p>
      <table style="width:100%; border-collapse: collapse; background:#f6f8fa; border-radius:8px;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:6px 12px; color:#57606a;">${escape(label)}</td><td style="padding:6px 12px;"><strong>${escape(value)}</strong></td></tr>`,
          )
          .join('')}
      </table>
      <p style="color:#6a737d; font-size: 12px; margin-top: 32px;">Este es un mensaje automático. Si tienes preguntas, responde a este correo o contacta al hotel.</p>
      ${rnt ? `<p style="color:#6a737d; font-size: 12px;">${escape(data.store_name)} · ${escape(rnt)}</p>` : ''}
    </div>
  `;
  const text = [
    `Hola ${data.guest_name},`,
    `Tu reserva en ${data.store_name} está confirmada. Recibimos tu pago.`,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(rnt ? [`${data.store_name} · ${rnt}`] : []),
  ].join('\n');
  return { subject, html, text };
}
