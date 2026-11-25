import * as crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Propiedad del `req` donde vive el id de correlación de la petición. */
export const REQUEST_ID_PROPERTY = 'request_id';

/**
 * Id de correlación de la petición ya resuelto por `requestIdMiddleware`, o
 * `undefined` si la petición no pasó por él (tests unitarios, apps sin main.ts).
 */
export function getRequestIdFromRequest(req: unknown): string | undefined {
  const id = (req as Record<string, unknown> | undefined)?.[REQUEST_ID_PROPERTY];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * QUI-1049 P3 / QUI-1019 — el id de correlación nace aquí, en el primer
 * middleware de Express, antes que parsers, guards, pipes e interceptores.
 *
 * Antes nacía en `RequestContextInterceptor`, que corre DESPUÉS de los guards,
 * y el filtro de excepciones lo buscaba en el AsyncLocalStorage, que ya no está
 * activo cuando el filtro corre. Fuera del ALS `RequestContextService` caía al
 * estático `currentContext` (el último `run(...)` de cualquier otra petición),
 * así que errores distintos devolvían el mismo `request_id`.
 *
 * Respeta un `X-Request-Id` entrante (mismo criterio que el interceptor:
 * string no vacío) y siempre lo devuelve en la cabecera de la respuesta.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && inbound.length > 0
      ? inbound
      : crypto.randomUUID();
  (req as unknown as Record<string, unknown>)[REQUEST_ID_PROPERTY] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
