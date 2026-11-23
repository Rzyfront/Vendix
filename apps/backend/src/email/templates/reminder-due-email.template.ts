import { wrapHtml } from './subscription-emails';

/**
 * QUI-580 — e-mail sent to the owner of a Bitácora reminder when it falls due.
 * Spanish copy, Vendix layout. Every user-provided value is escaped.
 */
export interface ReminderDueEmailData {
  firstName: string | null;
  storeName: string | null;
  title: string;
  note: string | null;
  /** Due date already formatted in the store timezone. */
  when: string | null;
  /** The linked record as the Bitácora shows it, or null without a link. */
  link: { typeLabel: string; label: string; available: boolean } | null;
  /** Absolute admin URL of the button; null when the store has no admin domain. */
  actionUrl: string | null;
  /** True when the button opens the linked record, false when it opens the Bitácora. */
  opensRecord: boolean;
}

export interface ReminderDueEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** One line of text: a subject never carries line breaks. */
const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();

export function buildReminderDueEmail(data: ReminderDueEmailData): ReminderDueEmail {
  const title = singleLine(data.title);
  const greeting = data.firstName ? `Hola ${singleLine(data.firstName)},` : 'Hola,';
  const intro = data.storeName
    ? `Llegó la hora de tu recordatorio en ${singleLine(data.storeName)}.`
    : 'Llegó la hora de tu recordatorio.';
  const linkText = data.link
    ? `${data.link.typeLabel}: ${data.link.label}${data.link.available ? '' : ' (no disponible)'}`
    : null;
  const actionLabel = data.opensRecord ? 'Abrir en Vendix' : 'Abrir la Bitácora';

  const rows: Array<[string, string]> = [['Recordatorio', title]];
  if (data.when) rows.push(['Fecha', data.when]);
  if (data.note) rows.push(['Nota', data.note]);
  if (linkText) rows.push(['Vinculado a', linkText]);

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6B7280;vertical-align:top;white-space:nowrap;">${label}</td>` +
        `<td style="padding:6px 0;color:#1F2937;white-space:pre-line;">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const button = data.actionUrl
    ? `<p style="text-align:center;margin:28px 0 8px;">
         <a href="${escapeHtml(data.actionUrl)}" style="display:inline-block;background:#2F6F4E;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">${actionLabel}</a>
       </p>`
    : '<p style="color:#6B7280;">Lo encuentras en la Bitácora del panel de tu tienda en Vendix.</p>';

  const html = wrapHtml(
    'Recordatorio',
    `<p>${escapeHtml(greeting)}</p>
     <p>${escapeHtml(intro)}</p>
     <table role="presentation" style="border-collapse:collapse;margin:16px 0;font-size:15px;">${rowsHtml}</table>
     ${button}`,
  );

  const text =
    `${greeting}\n\n${intro}\n\n` +
    rows.map(([label, value]) => `${label}: ${value}`).join('\n') +
    (data.actionUrl
      ? `\n\n${actionLabel}: ${data.actionUrl}`
      : '\n\nLo encuentras en la Bitácora del panel de tu tienda en Vendix.');

  return { subject: `Recordatorio: ${title}`, html, text };
}
