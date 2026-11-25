import { createHash } from 'crypto';
import { redactSensitiveRoute } from '../utils/sensitive-route.util';

/**
 * Saneo de todo lo que el bot guarda o envía (S7 de QUI-1010: «Los mensajes no
 * incluyen contraseñas, tokens ni datos sensibles de clientes»).
 *
 * El bot NUNCA lee cuerpos de petición ni cabeceras, y del `data` de un job
 * solo toma los ids numéricos de tienda y organización: lo demás es ruta
 * normalizada, códigos y el mensaje del error. Este saneo es la segunda
 * barrera, para lo que un mensaje de error pueda arrastrar.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EXACT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Replacement = string | ((match: string) => string);

const RULES: ReadonlyArray<[RegExp, Replacement]> = [
  // JWT (tres segmentos base64url, el primero empieza por `eyJ`).
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, '[token]'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [token]'],
  // Credenciales en `clave=valor`, `clave: valor` o JSON `"clave":"valor"`.
  [
    /(["']?\b(?:password|passwd|pwd|contraseña|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|cvv|cvc|pin)\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
    '$1[oculto]',
  ],
  // Valores de query string.
  [/([?&][^=&\s#]+=)[^&\s#]+/g, '$1[oculto]'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]'],
  // Teléfonos, documentos, NIT, tarjetas y cuentas: 6 o más dígitos seguidos
  // (admite separadores de espacio, punto o guion entre grupos).
  [
    /\+?\d(?:[\d .-]{4,}\d)/g,
    (match) => (match.replace(/\D/g, '').length >= 6 ? '[número]' : match),
  ],
];

/**
 * Parámetros de ruta legibles para la trazabilidad (`orderId=123`).
 *
 * Lista de PERMITIDOS: solo ids, slugs y paginación con valor numérico o UUID.
 * Cualquier otra clave (`file` de un iCal, `code` de un canje, `handle` de un
 * adjunto…) se descarta: al bot nunca le llegan tokens ni datos de clientes.
 */
const ALLOWED_PARAM_KEY =
  /^(id|[a-z0-9]+_id|[a-z0-9]+Id|slug|year|month|day|date|page|limit)$/i;
const NUMERIC_PARAM = /^\d{1,20}$/;
const UUID_PARAM =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_PARAM = /^[a-z0-9-]{1,60}$/i;
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export function safeRouteParams(
  params: Record<string, unknown> | undefined | null,
): Record<string, string> | null {
  if (!params) return null;
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_PARAM_KEY.test(key)) continue;
    // Credenciales con forma de id: sesión, acceso público, token, share.
    if (/(public|session|share|token)/i.test(key)) continue;
    if (value === null || value === undefined) continue;
    const text = String(value);
    const looksLikeSlug = key.toLowerCase() === 'slug' && SLUG_PARAM.test(text);
    const looksLikeDate = key.toLowerCase() === 'date' && DATE_PARAM.test(text);
    if (!NUMERIC_PARAM.test(text) && !UUID_PARAM.test(text) && !looksLikeSlug && !looksLikeDate) {
      continue;
    }
    safe[key] = text;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

/** Identidad del request para una alerta (tienda, organización, usuario). */
export function alertIdentityFromRequest(req: unknown): {
  organizationId: number | null;
  storeId: number | null;
  userId: number | null;
} {
  const record = (req ?? {}) as Record<string, any>;
  const user = record.user ?? {};
  // En rutas públicas (checkout, catálogo) no hay usuario: el middleware de
  // dominio ya resolvió la tienda por hostname o `x-store-id`.
  const domain = record.domain_context ?? {};
  const num = (value: unknown): number | null => {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value > 0 ? value : null;
    }
    if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) return null;
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  };
  // Una sola fuente: mezclar usuario y dominio podría atribuir la alerta a una
  // pareja organización/tienda que no existe.
  const userOrg = num(user.organization_id);
  const userStore = num(user.store_id);
  const useUser = userOrg !== null || userStore !== null;
  return {
    organizationId: useUser ? userOrg : num(domain.organization_id),
    storeId: useUser ? userStore : num(domain.store_id),
    userId: num(user.id ?? user.user_id),
  };
}

/** Texto saneado y truncado; `''` si no hay texto. */
export function sanitizeAlertText(value: unknown, max = 500): string {
  if (value === null || value === undefined) return '';
  let text = redactSensitiveRoute(String(value));
  for (const [pattern, replacement] of RULES) {
    text =
      typeof replacement === 'string'
        ? text.replace(pattern, replacement)
        : text.replace(pattern, replacement);
  }
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Una línea legible del error. Prisma repite la consulta completa (con los
 * valores que mandó el cliente) antes del motivo, que va en la última línea:
 * de esos mensajes solo se toma esa línea; del resto, la primera.
 */
export function summarizeError(error: unknown, max = 300): string {
  if (error === null || error === undefined) return '';
  if (!(error instanceof Error)) return sanitizeAlertText(error, max);
  const raw = String(error.message ?? '');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const reason = /invocation/i.test(raw) ? lines[lines.length - 1] : lines[0];
  return sanitizeAlertText(reason ? `${error.name}: ${reason}` : error.name, max);
}

/**
 * Ids numéricos de tienda y organización del `data` de un job; nada más.
 * Algunas colas los guardan en `data.context` (asientos, CRM, IA).
 */
export function tenantIdsOf(data: unknown): {
  organizationId: number | null;
  storeId: number | null;
} {
  const record =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const nested =
    record.context && typeof record.context === 'object'
      ? (record.context as Record<string, unknown>)
      : {};
  const pick = (...keys: string[]): number | null => {
    for (const source of [record, nested]) {
      for (const key of keys) {
        const value = Number(source[key]);
        if (Number.isInteger(value) && value > 0) return value;
      }
    }
    return null;
  };
  return {
    organizationId: pick('organization_id', 'organizationId'),
    storeId: pick('store_id', 'storeId'),
  };
}

/** Valores de `details` saneados (los números y booleanos pasan tal cual). */
export function sanitizeAlertDetails(
  details: Record<string, string | number | boolean | null | undefined> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    // Un UUID (id de petición) no es dato sensible y sirve para buscar en logs.
    out[sanitizeAlertText(key, 60)] =
      typeof value !== 'string'
        ? value
        : EXACT_UUID.test(value.trim())
          ? value.trim()
          : sanitizeAlertText(value, 200);
  }
  return out;
}

/**
 * Ruta de la petición sin valores: el patrón de Express (`/api/orders/:id`)
 * cuando la ruta casó; si no, la URL sin query y con ids, UUIDs y segmentos
 * con pinta de token reemplazados.
 */
export function routeKeyOf(req: {
  route?: { path?: unknown };
  baseUrl?: string;
  originalUrl?: string;
  url?: string;
}): string {
  const pattern = req.route?.path;
  if (typeof pattern === 'string' && pattern.length > 0) {
    return `${req.baseUrl ?? ''}${pattern}`;
  }
  return normalizeUrlPath(req.originalUrl || req.url || '');
}

export function normalizeUrlPath(url: string): string {
  const path = redactSensitiveRoute(url.split(/[?#]/)[0] || '/');
  return (
    path
      .replace(UUID, ':uuid')
      .split('/')
      .map((segment) => {
        if (/^\d+$/.test(segment)) return ':id';
        // Segmentos largos con dígitos y letras: tokens, hashes, slugs firmados.
        if (segment.length >= 20 && /\d/.test(segment) && /[a-z]/i.test(segment)) {
          return ':token';
        }
        return segment;
      })
      .join('/') || '/'
  );
}

/** Huella estable de la agrupación (sha256 hex, 64 caracteres). */
export function fingerprintOf(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
