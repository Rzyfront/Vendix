/**
 * Plantilla única "aviso" de los avisos personales que salen por correo
 * (odd/tasks/recordatorios-notificaciones.md §3.4). Copia en español, con el
 * nombre y los colores de la tienda. Todo valor que viene del negocio o del
 * usuario se escapa; los colores solo se aceptan en formato hex.
 */
export interface NotificationEmailData {
  firstName: string | null;
  /** Nombre visible de la tienda (o de su marca). */
  storeName: string | null;
  /** Título del aviso tal como se mostró en la campana. */
  title: string;
  /** Cuerpo del aviso tal como se mostró en la campana. */
  body: string;
  /** URL absoluta del botón sobre el dominio admin de la tienda; null sin dominio. */
  actionUrl: string | null;
  /** Colores de marca de la tienda; se ignoran si no son hex válidos. */
  primaryColor?: string | null;
  secondaryColor?: string | null;
}

export interface NotificationEmail {
  subject: string;
  html: string;
  text: string;
}

const DEFAULT_PRIMARY = '#7ED7A5';
const DEFAULT_SECONDARY = '#2F6F4E';
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Una sola línea: un asunto nunca lleva saltos. */
const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();

const safeColor = (value: string | null | undefined, fallback: string) =>
  value && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;

export function buildNotificationEmail(
  data: NotificationEmailData,
): NotificationEmail {
  const title = singleLine(data.title) || 'Aviso';
  const storeName = data.storeName ? singleLine(data.storeName) : null;
  const greeting = data.firstName ? `Hola ${singleLine(data.firstName)},` : 'Hola,';
  const intro = storeName
    ? `Tienes un aviso nuevo en ${storeName}.`
    : 'Tienes un aviso nuevo en Vendix.';
  const primary = safeColor(data.primaryColor, DEFAULT_PRIMARY);
  const secondary = safeColor(data.secondaryColor, DEFAULT_SECONDARY);
  const header = storeName ?? 'Vendix';
  const actionLabel = 'Abrir en Vendix';
  const fallback = 'Lo encuentras en las notificaciones del panel de tu tienda en Vendix.';
  const footer =
    'Recibes este correo porque lo activaste en tus preferencias de notificaciones. ' +
    'Puedes apagarlo cuando quieras desde el panel.';

  const button = data.actionUrl
    ? `<p style="text-align:center;margin:28px 0 8px;">
         <a href="${escapeHtml(data.actionUrl)}" style="display:inline-block;background:${secondary};color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">${actionLabel}</a>
       </p>`
    : `<p style="color:#6B7280;">${escapeHtml(fallback)}</p>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background-color:#F8FAFC;color:#1F2937;">
  <div style="max-width:600px;margin:24px auto;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,${primary} 0%,${secondary} 100%);padding:28px 24px;text-align:center;">
      <div style="color:#FFFFFF;margin:0;font-size:20px;font-weight:700;">${escapeHtml(header)}</div>
    </div>
    <div style="padding:32px 28px;line-height:1.6;font-size:15px;color:#1F2937;">
      <p>${escapeHtml(greeting)}</p>
      <p>${escapeHtml(intro)}</p>
      <h2 style="font-size:18px;margin:20px 0 8px;color:#1F2937;">${escapeHtml(title)}</h2>
      <p style="white-space:pre-line;margin:0;">${escapeHtml(data.body)}</p>
      ${button}
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0 20px;">
      <div style="color:#6B7280;font-size:13px;">${escapeHtml(footer)}</div>
    </div>
  </div>
</body>
</html>`;

  const text =
    `${greeting}\n\n${intro}\n\n${title}\n${data.body}` +
    (data.actionUrl ? `\n\n${actionLabel}: ${data.actionUrl}` : `\n\n${fallback}`) +
    `\n\n${footer}`;

  const subject = storeName ? `${title} · ${storeName}` : title;
  return { subject, html, text };
}
