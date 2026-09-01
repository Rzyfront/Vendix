import type { Request } from 'express';
import { createHash } from 'crypto';

const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * Normaliza una dirección a su forma canónica para usarla como clave.
 *
 * Un mismo cliente puede llegar como `::ffff:190.1.2.3` (socket dual-stack) o
 * como `190.1.2.3` (cabecera de proxy). Sin normalizar serían dos cubetas
 * distintas y el límite valdría el doble de lo declarado.
 */
function normalizeIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let ip = value.trim().toLowerCase();
  if (!ip) return null;
  if (ip.startsWith(IPV4_MAPPED_PREFIX)) {
    ip = ip.slice(IPV4_MAPPED_PREFIX.length);
  }
  // IPv4 con puerto (`1.2.3.4:5678`). IPv6 lleva `:` de por sí, así que sólo
  // se recorta cuando hay exactamente un `:` y lo de la izquierda tiene puntos.
  const colonCount = (ip.match(/:/g) || []).length;
  if (colonCount === 1 && ip.includes('.')) {
    ip = ip.split(':')[0];
  }
  return ip || null;
}

/**
 * Fuente ÚNICA de la IP del cliente para rate limiting, auditoría y logging.
 *
 * ## Por qué lee `req.ip` y NO `x-forwarded-for`
 *
 * `X-Forwarded-For` es una cabecera que el cliente puede escribir. Leer su
 * primer elemento a mano —el patrón que había regado en `auth.controller.ts`—
 * deja que cualquiera mande `X-Forwarded-For: 1.2.3.4` y estrene cubeta de
 * rate limit en cada petición, o envenene el registro de auditoría con una IP
 * inventada. Es exactamente el agujero inverso al que veníamos sufriendo:
 * pasaríamos de «todos comparten una cubeta» a «nadie tiene cubeta».
 *
 * Express ya resuelve esto bien cuando `trust proxy` está configurado con el
 * número de saltos de confianza (ver `resolveTrustProxySetting`): recorre
 * `X-Forwarded-For` de DERECHA a IZQUIERDA descartando exactamente N entradas
 * —las que escribieron nuestros propios proxies— y se queda con la primera que
 * el cliente no pudo falsificar. Ese valor es `req.ip`.
 *
 * Corolario: sin `trust proxy` bien fijado, `req.ip` es la IP del último proxy
 * y TODO el tráfico colapsa a una sola clave. El ajuste de `main.ts` y esta
 * utilidad son inseparables; ninguna de las dos sirve sin la otra.
 */
export function extractClientIp(req: Partial<Request> | undefined | null): string {
  if (!req) return 'unknown';
  return (
    normalizeIp(req.ip) ??
    normalizeIp((req as any)?.socket?.remoteAddress) ??
    normalizeIp((req as any)?.connection?.remoteAddress) ??
    'unknown'
  );
}

/**
 * Igual que `extractClientIp`, pero devuelve `undefined` en vez de `'unknown'`
 * cuando no se pudo resolver.
 *
 * Es la forma que quieren los registros de auditoría y sesión: una columna
 * nula dice «no se supo», mientras que la cadena `'unknown'` se confunde con
 * un valor observado y contamina cualquier agrupación posterior por IP.
 */
export function extractClientIpOptional(
  req: Partial<Request> | undefined | null,
): string | undefined {
  const ip = extractClientIp(req);
  return ip === 'unknown' ? undefined : ip;
}

/**
 * Deriva un discriminante opaco y de longitud fija para una clave de Redis.
 *
 * Se usa con correos y refresh tokens: son PII (el correo) o material de sesión
 * (el token), y Redis es texto plano al que llega cualquiera con acceso al
 * contenedor. El hash conserva la propiedad que importa —dos valores iguales
 * dan la misma cubeta— sin guardar el valor.
 */
export function bucketHash(value: string, length = 32): string {
  return createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, length);
}

/**
 * Resuelve el valor de `trust proxy` de Express desde `TRUST_PROXY_HOPS`.
 *
 * ## Por qué un número y NUNCA `true`
 *
 * `app.set('trust proxy', true)` le dice a Express que confíe en la cadena
 * ENTERA de `X-Forwarded-For`, así que toma su primer elemento — el que
 * escribe el cliente. Con eso, cualquiera falsifica su IP mandando la cabecera
 * y evade todos los límites por IP. Es un fallo peor que el bloqueo global que
 * este cambio viene a corregir, y además silencioso.
 *
 * Con un número N, Express descarta las N entradas más cercanas a la app —las
 * que pusieron nuestros propios saltos— y se queda con la siguiente. El valor
 * correcto es la cantidad de proxies propios delante del backend:
 *
 *   - dev / staging  →  1   (navegador → nginx → backend)
 *   - producción     →  2   (navegador → CloudFront → nginx → backend)
 *
 * El default es 1 —la topología de dev, la que corre sin `.env`— y producción
 * lo sube por variable de entorno. Si el número se queda corto, `req.ip` es la
 * IP de un proxy nuestro y el límite se comparte entre los clientes que pasen
 * por ese salto: degradado, pero nunca falsificable. Si sobra, cae a la IP que
 * escribió el cliente y vuelve el agujero. Ante la duda, quedarse corto.
 */
export function resolveTrustProxySetting(
  raw: string | undefined = process.env.TRUST_PROXY_HOPS,
): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return 1;
  return parsed;
}
