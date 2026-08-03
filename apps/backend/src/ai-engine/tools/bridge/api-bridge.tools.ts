import { Logger } from '@nestjs/common';
import { RegisteredTool } from '../interfaces/tool.interface';
import { ApiCatalogService } from './api-catalog.service';
import { RequestContextService } from '@common/context/request-context.service';

export interface ApiBridgeDeps {
  catalog: ApiCatalogService;
}

/** Beyond this, a single tool result would crowd out the conversation. */
const MAX_RESPONSE_CHARS = 6000;

const logger = new Logger('api-bridge');

function callerScopes(): string[] {
  const context = RequestContextService.getContext();
  const granted = context?.permissions;
  return granted?.length ? granted : (context?.roles ?? []);
}

/**
 * Generic read-only bridge onto the REST surface.
 *
 * Covers the long tail of domains that have no typed tool. It executes over
 * internal HTTP against this same process, forwarding the caller's own bearer
 * token, so the request traverses the identical guard, interceptor and ALS
 * scoping chain a browser request would. That is the point: the bridge cannot
 * escalate privilege by construction — if the user cannot call the endpoint,
 * neither can Vexi. Invoking controller handlers directly would have skipped
 * exactly those layers.
 */
export function createApiBridgeTools({
  catalog,
}: ApiBridgeDeps): RegisteredTool[] {
  const port = process.env.PORT ?? '3000';
  const prefix = process.env.API_PREFIX || 'api';
  const base = `http://127.0.0.1:${port}/${prefix}`;

  return [
    {
      name: 'list_endpoints',
      domain: 'api-bridge',
      readOnly: true,
      description:
        'Lista los endpoints de consulta disponibles para este usuario, agrupados por dominio. Úsala SOLO cuando ninguna herramienta específica cubra lo que necesitas: las herramientas tipadas (productos, inventario, órdenes, clientes, contabilidad) son más precisas y baratas. Sirve para la cola larga: reservas, membresías, gastos, marketing, nómina, etc.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description:
              'Filtra por dominio, por ejemplo "reservations", "expenses", "memberships". Omítelo para ver la lista de dominios disponibles.',
          },
        },
        required: [],
      },
      handler: async (args) => {
        const scopes = callerScopes();

        if (!args.domain) {
          return JSON.stringify({
            domains: catalog.domainsFor(scopes),
            note: 'Vuelve a llamar con `domain` para ver los endpoints concretos de uno.',
          });
        }

        const entries = catalog.listFor(scopes, undefined, String(args.domain));
        if (!entries.length) {
          return JSON.stringify({
            domain: args.domain,
            endpoints: [],
            note: 'Sin endpoints de consulta accesibles en ese dominio para este usuario. Puede que no exista o que le falten permisos.',
          });
        }

        return JSON.stringify({
          domain: args.domain,
          endpoints: entries.map((e) => ({
            path: e.path,
            requires: e.requiredPermissions,
          })),
        });
      },
    },
    {
      name: 'call_endpoint',
      domain: 'api-bridge',
      readOnly: true,
      description:
        'Ejecuta una consulta GET contra un endpoint obtenido de list_endpoints, con los permisos del usuario actual. Solo lectura: ninguna modificación pasa por aquí. Si el usuario no tiene permiso, te lo dirá y debes explicárselo en vez de reintentar.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Ruta exacta devuelta por list_endpoints, sin el prefijo /api. Ejemplo: "store/reservations".',
          },
          query: {
            type: 'object',
            description:
              'Parámetros de consulta como pares clave-valor, por ejemplo {"from":"2026-08-01","limit":10}.',
          },
        },
        required: ['path'],
      },
      handler: async (args) => {
        const context = RequestContextService.getContext();
        const token = context?.access_token;

        if (!token) {
          return JSON.stringify({
            error:
              'No hay credencial del usuario en este contexto, así que no puedo consultar la API en su nombre.',
          });
        }

        const entry = catalog.find(String(args.path));
        if (!entry) {
          return JSON.stringify({
            error: `La ruta "${args.path}" no está en el catálogo de endpoints de consulta. Usa list_endpoints para ver las válidas.`,
          });
        }

        // Second, redundant permission check. The real enforcement happens in
        // the guards of the internal request below; this one only exists to
        // give the model an explanatory answer instead of a bare 403.
        const scopes = callerScopes();
        const missing = entry.requiredPermissions.filter(
          (p) => !scopes.includes(p),
        );
        if (missing.length) {
          return JSON.stringify({
            error: `El usuario no tiene los permisos necesarios (${missing.join(', ')}) para consultar "${entry.path}".`,
          });
        }

        const url = new URL(`${base}/${entry.path}`);
        for (const [key, value] of Object.entries(
          (args.query as Record<string, unknown>) ?? {},
        )) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        }

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              // Preserved so the internal hop shares the caller's correlation
              // id in the logs instead of appearing as an orphan request.
              ...(context?.request_id
                ? { 'X-Request-Id': context.request_id }
                : {}),
            },
          });

          const body = await response.text();

          if (!response.ok) {
            return JSON.stringify({
              error: `La consulta a "${entry.path}" devolvió ${response.status}.`,
              detail: body.slice(0, 500),
            });
          }

          if (body.length > MAX_RESPONSE_CHARS) {
            return JSON.stringify({
              path: entry.path,
              truncated: true,
              note: `La respuesta es de ${body.length} caracteres y se truncó. Acota la consulta con parámetros (limit, fechas) para obtener el detalle.`,
              data: body.slice(0, MAX_RESPONSE_CHARS),
            });
          }

          return body;
        } catch (error: any) {
          logger.warn(
            `api-bridge call to ${entry.path} failed: ${error?.message}`,
          );
          return JSON.stringify({
            error: `No pude completar la consulta a "${entry.path}": ${error?.message ?? 'error de red interno'}.`,
          });
        }
      },
    },
  ];
}
