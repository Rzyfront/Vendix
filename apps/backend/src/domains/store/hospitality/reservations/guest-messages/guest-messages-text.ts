import { zonedWallClockToUtc } from '@common/utils/store-timezone.util';
import { formatShortDate } from '../stay-dates';
import { rntLine, storeRnt } from '../../compliance/rnt';

/**
 * Hospitality Suite (H8.2) — pure pieces of the automatic guest emails: which
 * ones the store turned on, when the pre-arrival reminder is due and the three
 * messages (confirmation, reminder with the online check-in link, thank-you).
 */

export type GuestMessageKey = 'confirmation' | 'pre_arrival' | 'post_stay';

export interface GuestMessageSettings {
  confirmation: boolean;
  pre_arrival: boolean;
  pre_arrival_hours: number;
  post_stay: boolean;
  /** H8.5 — the thank-you asks for a private rating of the stay. */
  post_stay_review: boolean;
  check_in_time: string;
  check_out_time: string;
  /** H4.3 — the hotel's RNT for the foot of the emails; null when unset. */
  rnt_number: string | null;
}

export const DEFAULT_PRE_ARRIVAL_HOURS = 48;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `settings.hospitality` → what the job sends; every email is on unless the store turned it off. */
export function guestMessageSettings(hospitality: Record<string, unknown> | undefined): GuestMessageSettings {
  const h = hospitality ?? {};
  const hours = Number(h.guest_email_pre_arrival_hours);
  const time = (value: unknown, fallback: string) =>
    typeof value === 'string' && HH_MM.test(value) ? value : fallback;
  return {
    confirmation: h.guest_email_confirmation !== false,
    pre_arrival: h.guest_email_pre_arrival !== false,
    pre_arrival_hours:
      Number.isInteger(hours) && hours >= 12 && hours <= 168 ? hours : DEFAULT_PRE_ARRIVAL_HOURS,
    post_stay: h.guest_email_post_stay !== false,
    post_stay_review: h.guest_email_post_stay_review !== false,
    check_in_time: time(h.check_in_time, '15:00'),
    check_out_time: time(h.check_out_time, '12:00'),
    rnt_number: storeRnt(h),
  };
}

/**
 * The reminder is due from `hours` before the check-in time of the arrival day
 * (store time zone) until that moment; a reservation made later than that
 * still gets it before arriving.
 */
export function preArrivalDue(
  arrival_date: string,
  check_in_time: string,
  hours: number,
  now: Date,
  timezone: string,
): boolean {
  const [year, month, day] = arrival_date.split('-').map(Number);
  const [hour, minute] = check_in_time.split(':').map(Number);
  const arrival = zonedWallClockToUtc(year, month, day, hour, minute, 0, 0, timezone).getTime();
  return now.getTime() >= arrival - hours * 3_600_000 && now.getTime() < arrival;
}

export interface GuestMessageData {
  guest_name: string;
  store_name: string;
  reservation_number: string;
  arrival_date: string;
  departure_date: string;
  nights: number;
  room_type: string;
  check_in_time: string;
  check_out_time: string;
  /** Pre-arrival only: online check-in link; null when the store has no online domain. */
  precheckin_url?: string | null;
  /** Pre-arrival only: the party is already registered. */
  precheckin_done?: boolean;
  /** Post-stay only (H8.5): private stay rating link; null when off, rated or without an online domain. */
  review_url?: string | null;
  /** H4.3 — the hotel's RNT, printed at the foot of every guest email; null when unset. */
  rnt_number?: string | null;
}

export interface GuestEmail {
  subject: string;
  html: string;
  text: string;
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function stayRows(data: GuestMessageData): Array<[string, string]> {
  return [
    ['Reserva', data.reservation_number],
    ['Llegada', `${formatShortDate(data.arrival_date)} desde las ${data.check_in_time}`],
    ['Salida', `${formatShortDate(data.departure_date)} hasta las ${data.check_out_time}`],
    ['Habitación', `${data.room_type} · ${data.nights} ${data.nights === 1 ? 'noche' : 'noches'}`],
  ];
}

function render(
  data: GuestMessageData,
  subject: string,
  paragraphs: string[],
  rows: Array<[string, string]>,
  link?: { label: string; url: string },
): GuestEmail {
  const table = rows.length
    ? `<table style="width:100%; border-collapse: collapse; background:#f6f8fa; border-radius:8px;">${rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:6px 12px; color:#57606a;">${escape(label)}</td><td style="padding:6px 12px;"><strong>${escape(value)}</strong></td></tr>`,
        )
        .join('')}</table>`
    : '';
  const rnt = rntLine(data.rnt_number);
  const button = link
    ? `<p style="margin: 24px 0;"><a href="${escape(link.url)}" style="background:#0f766e; color:#ffffff; padding:12px 20px; border-radius:8px; text-decoration:none; display:inline-block;">${escape(link.label)}</a></p>`
    : '';
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p>Hola <strong>${escape(data.guest_name)}</strong>,</p>
      ${paragraphs.map((p) => `<p>${escape(p)}</p>`).join('')}
      ${button}
      ${table}
      <p style="color:#6a737d; font-size: 12px; margin-top: 32px;">Este es un mensaje automático. Si tienes preguntas, responde a este correo o contacta al hotel.</p>
      ${rnt ? `<p style="color:#6a737d; font-size: 12px;">${escape(data.store_name)} · ${escape(rnt)}</p>` : ''}
    </div>
  `;
  const text = [
    `Hola ${data.guest_name},`,
    ...paragraphs,
    ...(link ? [`${link.label}: ${link.url}`] : []),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(rnt ? [`${data.store_name} · ${rnt}`] : []),
  ].join('\n');
  return { subject, html, text };
}

export function guestMessageEmail(key: GuestMessageKey, data: GuestMessageData): GuestEmail {
  switch (key) {
    case 'confirmation':
      return render(
        data,
        `Reserva ${data.reservation_number} confirmada · ${data.store_name}`,
        [`Tu reserva en ${data.store_name} está confirmada. Estos son los datos de tu estadía:`],
        stayRows(data),
      );
    case 'pre_arrival': {
      const paragraphs = [`Te esperamos en ${data.store_name} el ${formatShortDate(data.arrival_date)} desde las ${data.check_in_time}.`];
      let link: { label: string; url: string } | undefined;
      if (data.precheckin_done) {
        paragraphs.push('Tu pre-registro ya está completo: en recepción solo te entregamos la llave.');
      } else if (data.precheckin_url) {
        paragraphs.push('Ahorra tiempo en recepción: registra desde ya tus datos y los de tus acompañantes.');
        link = { label: 'Hacer el pre-registro', url: data.precheckin_url };
      }
      return render(data, `Te esperamos pronto · ${data.store_name}`, paragraphs, stayRows(data), link);
    }
    case 'post_stay': {
      const paragraphs = [`Gracias por elegir ${data.store_name}. Esperamos que hayas disfrutado tu estadía.`];
      if (data.review_url) {
        paragraphs.push('¿Cómo te fue? Califica tu estadía en un minuto: tu opinión llega solo al hotel y nos ayuda a mejorar.');
      }
      paragraphs.push('Será un gusto recibirte de nuevo.');
      const link = data.review_url ? { label: 'Calificar mi estadía', url: data.review_url } : undefined;
      return render(
        data,
        `Gracias por hospedarte en ${data.store_name}`,
        paragraphs,
        [['Reserva', data.reservation_number]],
        link,
      );
    }
  }
}
