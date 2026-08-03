import { Logger } from '@nestjs/common';
import { RegisteredTool } from '../interfaces/tool.interface';
import { ApiCatalogService, type CatalogMethod } from './api-catalog.service';
import { RequestContextService } from '@common/context/request-context.service';

export interface ApiBridgeDeps {
  catalog: ApiCatalogService;
}

/** Beyond this, a single tool result would crowd out the conversation. */
const MAX_RESPONSE_CHARS = 6000;

/**
 * The mutating verbs, as their own type.
 *
 * Narrower than `CatalogMethod` on purpose: `describeWrite` switches over these
 * four and has no `GET` branch, so typing its parameter as the wider union made
 * the switch non-exhaustive and the function implicitly returnable as
 * `undefined`. A `default` branch would have silenced that by inventing a
 * summary for a verb that can never arrive; narrowing lets the compiler prove
 * the switch is total instead.
 */
type WriteMethod = Exclude<CatalogMethod, 'GET'>;

const WRITE_METHODS: WriteMethod[] = ['POST', 'PATCH', 'PUT', 'DELETE'];

/**
 * Validates a model-supplied verb and narrows it in one move.
 *
 * Replaces an `as CatalogMethod` cast on `args.method`: the model can send any
 * string there, and asserting the type made the compiler trust a value that had
 * not been checked yet. The guard checks first and the narrowing follows from
 * the check.
 */
function isWriteMethod(value: string): value is WriteMethod {
  return (WRITE_METHODS as string[]).includes(value);
}

/**
 * The path to actually request, as opposed to the one that was catalogued.
 *
 * `catalog.find` now resolves `store/users/management/215/roles` to the entry
 * declared as `store/users/management/:id/roles`, so `entry.path` is a pattern
 * and requesting it literally would send `:id` to the server. The concrete path
 * the caller supplied is the one to fetch; the entry is only there to answer
 * "does this exist and who may call it".
 */
function requestPath(rawPath: unknown): string {
  return String(rawPath ?? '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

const ARCHIVE_CONSEQUENCE =
  'Dejará de aparecer en listados y no se puede reintegrar después. La información histórica se conserva.';

/**
 * Makes a Swagger summary safe to show to a shopkeeper.
 *
 * These summaries are written for developers and routinely carry field names
 * in backticks — "Asignar un rol a un usuario (`store_id` opcional: NULL =
 * toda la organización)". The sentence before the parenthesis is the part a
 * person needs; the parenthesis is exactly the kind of internal detail the
 * agent is told never to surface.
 */
function stripMarkup(summary: string): string {
  const withoutTechnicalAside = summary.replace(/\s*\([^)]*`[^)]*\)/g, '');
  return withoutTechnicalAside.replace(/`/g, '').trim() || summary.trim();
}

const logger = new Logger('api-bridge');

function callerScopes(): string[] {
  const context = RequestContextService.getContext();
  const granted = context?.permissions;
  return granted?.length ? granted : (context?.roles ?? []);
}

/**
 * What the user is about to authorize, in their own terms.
 *
 * Deliberately says nothing about paths, verbs or table names: the person
 * approving a change should read what happens to their business, not the shape
 * of the request. `DELETE` is described as archiving because that is what the
 * API actually does across this codebase — records move to an archived state
 * and stop appearing, they are not erased.
 */
function describeWrite(
  method: WriteMethod,
  domain: string,
  body: Record<string, unknown> | undefined,
  endpointSummary?: string,
): { summary: string; consequence?: string } {
  const subject = SUBJECTS[domain] ?? domain.replace(/-/g, ' ');

  // The endpoint's own description wins over anything inferred here.
  //
  // The verb+domain heuristic below is only sound for plain collection and
  // item routes. On an action route it lies: `POST
  // organization/roles/assign-to-user` came out as "Crear un rol" when it
  // assigns an existing role to a user, so the approval card asked the person
  // to consent to an operation that was not the one queued. A wrong label on a
  // confirmation gate is worse than a vague one, and the summary is neither —
  // it is what the endpoint's author wrote it does.
  if (endpointSummary) {
    return {
      summary: stripMarkup(endpointSummary),
      consequence:
        method === 'DELETE' ? ARCHIVE_CONSEQUENCE : undefined,
    };
  }
  const named =
    typeof body?.['name'] === 'string'
      ? ` "${body['name']}"`
      : typeof body?.['first_name'] === 'string'
        ? ` "${String(body['first_name'])} ${String(body['last_name'] ?? '')}`.trimEnd() +
          '"'
        : '';

  switch (method) {
    case 'POST':
      return { summary: `Crear ${subject}${named}` };
    case 'PATCH':
    case 'PUT':
      return { summary: `Modificar ${subject}${named}` };
    case 'DELETE':
      return {
        summary: `Archivar ${subject}${named}`,
        consequence: ARCHIVE_CONSEQUENCE,
      };
  }
}

/** Domain segment → how a person would name it. Falls back to the segment. */
const SUBJECTS: Record<string, string> = {
  expenses: 'un gasto',
  users: 'un usuario',
  roles: 'un rol',
  customers: 'un cliente',
  products: 'un producto',
  categories: 'una categoría',
  tables: 'una mesa',
  menus: 'una carta',
  recipes: 'una receta',
  orders: 'una orden',
  suppliers: 'un proveedor',
  promotions: 'una promoción',
  coupons: 'un cupón',
  reservations: 'una reserva',
  memberships: 'una membresía',
  'dispatch-notes': 'una remisión',
  settings: 'la configuración de la tienda',
  payments: 'un pago',
};

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
        'Lista TODO lo que este usuario puede consultar y modificar en la aplicación, agrupado por dominio, con el verbo de cada ruta. Es tu mapa del sistema: si no sabes cómo hacer algo, empieza aquí antes de decir que no puedes. Cubre la cola larga que no tiene herramienta propia — mesas, cartas, recetas, membresías, gastos, reservas, usuarios, roles, promociones, nómina, configuración. Las herramientas tipadas (productos, inventario, órdenes, clientes, contabilidad) siguen siendo preferibles donde existan porque son más precisas. Para dudas de USO (cómo se hace algo, no qué dato hay), consulta `help-center/articles/search` con el parámetro `q`: son pocos artículos y cubren primeros pasos, venta en POS, tienda en línea, órdenes de compra, ajuste de inventario y métodos de pago. Si no hay artículo para lo que preguntan, no lo inventes: explícalo tú desde el mapa de rutas.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description:
              'Filtra por dominio, por ejemplo "reservations", "expenses", "users". Omítelo para ver la lista de dominios disponibles.',
          },
          writable_only: {
            type: 'boolean',
            description:
              'true para ver solo las rutas que modifican datos. Útil cuando ya sabes qué quieres cambiar.',
          },
        },
        required: [],
      },
      handler: async (args) => {
        const scopes = callerScopes();
        const methods = args.writable_only ? WRITE_METHODS : undefined;

        if (!args.domain) {
          return JSON.stringify({
            domains: catalog.domainsFor(scopes, methods),
            note: 'Vuelve a llamar con `domain` para ver las rutas concretas de uno.',
          });
        }

        const entries = catalog.listFor(
          scopes,
          undefined,
          String(args.domain),
          methods,
        );
        if (!entries.length) {
          return JSON.stringify({
            domain: args.domain,
            endpoints: [],
            note: 'Sin rutas accesibles en ese dominio para este usuario. Puede que el dominio no exista o que le falten permisos; si es lo segundo, explícale qué permiso necesita.',
          });
        }

        return JSON.stringify({
          domain: args.domain,
          endpoints: entries.map((e) => ({
            path: e.path,
            method: e.method,
            requires: e.requiredPermissions,
            ...(e.summary ? { hace: e.summary } : {}),
            ...(e.bodyFields ? { campos: e.bodyFields } : {}),
          })),
          note: 'GET se ejecuta con call_endpoint. POST, PATCH, PUT y DELETE con write_endpoint, que pide confirmación al usuario antes de aplicar. `campos` son los nombres EXACTOS que acepta el cuerpo: úsalos tal cual, no los traduzcas ni los pases a otra convención. Un `:algo` en la ruta se reemplaza por el id real.',
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

        const entry = catalog.find(String(args.path), 'GET');
        if (!entry) {
          const others = catalog.methodsFor(String(args.path));
          return JSON.stringify({
            error: `La ruta "${args.path}" no existe como consulta.`,
            note: others.length
              ? `Esa ruta sí existe para ${others.join(', ')}. Si quieres modificar datos, usa write_endpoint.`
              : 'Usa list_endpoints para ver las rutas válidas.',
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

        const url = new URL(`${base}/${requestPath(args.path)}`);
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
    {
      name: 'write_endpoint',
      domain: 'api-bridge',
      // NOT readOnly, and confirmation is mandatory: this is the only tool that
      // can mutate an arbitrary part of the system, so the user approves every
      // single call. The registry turns the rejection into the proposal, so no
      // propose/confirm plumbing is needed here.
      requiresConfirmation: true,
      description:
        'Crea, modifica o archiva datos en cualquier dominio de la aplicación, usando una ruta de list_endpoints. Con esto puedes hacer prácticamente cualquier operación del sistema: registrar un gasto, crear un usuario y asignarle un rol, configurar mesas, cartas o recetas, gestionar membresías, rutas y remisiones, categorías, promociones, clientes, la tienda en línea y la configuración de la tienda. Se ejecuta con los permisos del usuario, y NUNCA se aplica sin que la persona apruebe: al llamarla recibirás la propuesta para que se la resumas y le pidas confirmación. Antes de llamarla, VERIFICA con una consulta que el registro exista (o que no exista ya, si vas a crearlo). DELETE archiva, no borra de verdad.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Ruta exacta devuelta por list_endpoints, sin el prefijo /api, con los :id ya sustituidos por valores reales. Ejemplo: "store/expenses" o "store/users/42".',
          },
          method: {
            type: 'string',
            enum: ['POST', 'PATCH', 'PUT', 'DELETE'],
            description:
              'POST para crear, PATCH o PUT para modificar, DELETE para archivar.',
          },
          body: {
            type: 'object',
            description:
              'Cuerpo de la petición. Omítelo en DELETE. Usa exactamente los nombres de campo que el endpoint espera.',
          },
        },
        required: ['path', 'method'],
      },
      /**
       * Runs BEFORE any token is issued, so it doubles as the last chance to
       * refuse cheaply: an unknown route or a missing permission returns
       * `status: 'error'` and the registry declines to mint a token at all
       * rather than letting the user approve something that cannot work.
       */
      preview: async (args) => {
        const method = String(args.method ?? '').toUpperCase();
        const path = String(args.path ?? '');

        if (!isWriteMethod(method)) {
          return {
            status: 'error' as const,
            message: `"${args.method}" no es una operación de escritura válida.`,
          };
        }

        const entry = catalog.find(path, method);
        if (!entry) {
          const others = catalog.methodsFor(path);
          return {
            status: 'error' as const,
            message: others.length
              ? `Esa operación no existe sobre "${path}", pero sí ${others.join(', ')}.`
              : `No encontré esa operación en el sistema. Revisa el mapa con list_endpoints.`,
          };
        }

        const scopes = callerScopes();
        const missing = entry.requiredPermissions.filter(
          (p) => !scopes.includes(p),
        );
        if (missing.length) {
          return {
            status: 'error' as const,
            message: `Esta persona no tiene permiso para hacer ese cambio. Le falta: ${missing.join(', ')}.`,
          };
        }

        const body = args.body as Record<string, unknown> | undefined;

        // The global ValidationPipe runs with `forbidNonWhitelisted: true`, so
        // a single field the DTO does not declare makes the endpoint reject the
        // whole request. Catching it here — before a token exists — is the
        // difference between "the person approves and it fails" and "the person
        // is never asked to approve something that cannot work". The model
        // guessed `roleIds` where the DTO declares `role_ids`; the write was
        // already approved by then.
        if (entry.bodyFields && body) {
          const unknown = Object.keys(body).filter(
            (key) => !entry.bodyFields!.includes(key),
          );
          if (unknown.length) {
            return {
              status: 'error' as const,
              message: `Estos datos no corresponden: ${unknown.join(', ')}. Los que acepta son: ${entry.bodyFields.join(', ')}.`,
            };
          }
        }

        const { summary, consequence } = describeWrite(
          method,
          entry.domain,
          body,
          entry.summary,
        );

        return {
          status: 'ok' as const,
          domain: entry.domain,
          label: summary,
          message: consequence ?? 'Confírmalo y lo aplico.',
          changes: body
            ? Object.entries(body)
                .filter(([, value]) => value !== undefined && value !== null)
                .slice(0, 12)
                .map(([field, value]) => ({
                  field,
                  to: typeof value === 'object' ? JSON.stringify(value) : value,
                }))
            : undefined,
        } as any;
      },
      handler: async (args) => {
        const context = RequestContextService.getContext();
        const token = context?.access_token;

        if (!token) {
          return JSON.stringify({
            error:
              'No hay credencial del usuario en este contexto, así que no puedo actuar en su nombre.',
          });
        }

        // Re-validated rather than trusted from the preview: the confirmation
        // token binds these arguments, so they cannot have been swapped, but
        // the check is what lets the compiler narrow the verb here too.
        const method = String(args.method).toUpperCase();
        if (!isWriteMethod(method)) {
          return JSON.stringify({
            error: `"${args.method}" no es una operación de escritura válida.`,
          });
        }

        const entry = catalog.find(String(args.path), method);
        if (!entry) {
          return JSON.stringify({
            error: `No encontré esa operación en el sistema.`,
          });
        }

        try {
          const response = await fetch(`${base}/${requestPath(args.path)}`, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              ...(method === 'DELETE'
                ? {}
                : { 'Content-Type': 'application/json' }),
              ...(context?.request_id
                ? { 'X-Request-Id': context.request_id }
                : {}),
            },
            body:
              method === 'DELETE' || args.body === undefined
                ? undefined
                : JSON.stringify(args.body),
          });

          const responseBody = await response.text();

          if (!response.ok) {
            // The endpoint's own message is forwarded verbatim: it is the only
            // party that knows which field was wrong, and paraphrasing it would
            // send the model guessing at a second attempt.
            return JSON.stringify({
              applied: false,
              status: response.status,
              detail: responseBody.slice(0, 800),
              note: 'El cambio NO se aplicó. Dile a la persona qué faltó, en sus términos, y ofrécele reintentarlo con el dato corregido.',
            });
          }

          return JSON.stringify({
            applied: true,
            data:
              responseBody.length > MAX_RESPONSE_CHARS
                ? responseBody.slice(0, MAX_RESPONSE_CHARS)
                : responseBody,
            note: 'El cambio quedó aplicado. Confírmaselo en una frase y, si el módulo está en pantalla, refresca la vista con ui_refresh.',
          });
        } catch (error: any) {
          logger.warn(
            `api-bridge write to ${entry.path} failed: ${error?.message}`,
          );
          return JSON.stringify({
            applied: false,
            error: `No pude completar el cambio: ${error?.message ?? 'error de red interno'}.`,
          });
        }
      },
    },
  ];
}
