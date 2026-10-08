/**
 * Saneamiento del remitente "en nombre de" (sender override).
 *
 * Todos los proveedores resuelven `from?: { name, email }` con la MISMA
 * semántica (la de `SesProvider.sendEmail`): el `From` conserva la dirección
 * verificada de la plataforma (`EMAIL_FROM`) y sólo cambia el nombre visible;
 * la dirección del emisor viaja como `Reply-To`. Así el adquiriente ve
 * «RAZÓN SOCIAL <noreply@vendix.online>» y su respuesta llega al emisor, sin
 * que el proveedor rechace un remitente no verificado.
 *
 * El nombre viaja entre comillas dentro de una cabecera: comillas dobles,
 * saltos de línea (inyección de cabecera SMTP) y `<>` se eliminan.
 */
export function sanitizeSenderName(
  name: string | null | undefined,
  fallback: string,
): string {
  const clean = (name ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/["<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || fallback;
}

/** Devuelve el correo de respuesta sólo si tiene forma de dirección simple. */
export function sanitizeReplyTo(
  email: string | null | undefined,
): string | undefined {
  const clean = (email ?? '').trim();
  return /^[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+$/.test(clean)
    ? clean
    : undefined;
}

/** Cabecera `From` con el nombre del emisor y la dirección de la plataforma. */
export function buildFromHeader(
  from: { name: string; email: string } | undefined,
  default_name: string,
  platform_email: string,
): string {
  const name = from
    ? sanitizeSenderName(from.name, default_name)
    : sanitizeSenderName(default_name, 'Vendix');
  return `"${name}" <${platform_email}>`;
}
