import { Logger } from '@nestjs/common';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  ApiCatalogService,
  type CatalogEntry,
  type CatalogMethod,
  type CatalogField,
} from './api-catalog.service';
import { IRREVERSIBLE_DOMAINS } from './capability-registry.service';
import { VexiAttachmentsService } from '../../../domains/store/vexi/vexi-attachments.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  buildMultipartBody,
  internalApiBase,
  internalAuthHeaders,
} from './internal-http';

export interface ApiBridgeDeps {
  catalog: ApiCatalogService;
  attachments: VexiAttachmentsService;
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

/** The irreversibility sentence for a path, when its domain carries one. */
function irreversibleWarning(path: string): string | undefined {
  for (const segment of path.split('/').filter(Boolean)) {
    const warning = IRREVERSIBLE_DOMAINS[segment];
    if (warning) return warning;
  }
  return undefined;
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
      consequence: method === 'DELETE' ? ARCHIVE_CONSEQUENCE : undefined,
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
 * Human label for a field, derived from its name.
 *
 * The diff card shows one row per change and a raw column name in it
 * (`unit_price`) reads as a database dump. There is no label registry in the
 * backend, so the name is de-snaked; a wrong-but-readable label beats a correct
 * internal identifier in front of a shopkeeper.
 */
function labelOf(field: string): string {
  const known: Record<string, string> = {
    name: 'Nombre',
    first_name: 'Nombres',
    last_name: 'Apellidos',
    email: 'Correo',
    phone: 'Teléfono',
    amount: 'Monto',
    price: 'Precio',
    base_price: 'Precio base',
    sale_price: 'Precio de oferta',
    cost: 'Costo',
    quantity: 'Cantidad',
    description: 'Descripción',
    status: 'Estado',
    state: 'Estado',
    notes: 'Notas',
    due_date: 'Fecha de vencimiento',
    expense_date: 'Fecha del gasto',
    receipt_url: 'Recibo',
    document_url: 'Documento',
    invoice_url: 'Factura',
  };

  if (known[field]) return known[field];

  const spaced = field.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Checks a body against the DTO's declared types before a token is minted.
 *
 * The global `ValidationPipe` runs with `forbidNonWhitelisted: true` and its own
 * type coercion, so a wrongly-typed value is a 400 — but one that arrives AFTER
 * the person approved the change, which is the worst moment to find out. The
 * check here is deliberately narrow: it rejects what the DTO provably cannot
 * accept (unknown field, non-member of an enum, text where a number is required,
 * missing required field) and stays quiet about everything else. A stricter
 * check would start refusing valid requests, and a false refusal on the write
 * path is worse than a late rejection.
 */
function validateBody(
  schema: CatalogField[] | undefined,
  body: Record<string, unknown> | undefined,
  method: WriteMethod,
): string | null {
  if (!schema?.length) return null;

  const provided = body ?? {};
  const known = new Map(schema.map((field) => [field.name, field]));

  const unknownFields = Object.keys(provided).filter(
    (key) => !known.has(key),
  );
  if (unknownFields.length) {
    return `Estos datos no corresponden: ${unknownFields.join(', ')}. Los que acepta son: ${schema
      .map((field) => field.name)
      .join(', ')}.`;
  }

  for (const [key, value] of Object.entries(provided)) {
    const field = known.get(key);
    if (!field || value === undefined || value === null) continue;

    if (field.type === 'enum' && field.enumValues?.length) {
      if (!field.enumValues.includes(String(value))) {
        return `"${value}" no es un valor válido para ${labelOf(key)}. Los que acepta son: ${field.enumValues.join(', ')}.`;
      }
    }

    if (
      (field.type === 'number' || field.type === 'integer') &&
      typeof value !== 'number'
    ) {
      // A numeric string is what a form sends and the pipe coerces it happily;
      // only text that cannot be a number is a real problem.
      if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Number(value))) {
        return `${labelOf(key)} tiene que ser un número y llegó "${String(value)}".`;
      }
    }

    if (field.type === 'boolean' && typeof value !== 'boolean') {
      if (!['true', 'false'].includes(String(value))) {
        return `${labelOf(key)} solo puede ser sí o no.`;
      }
    }
  }

  // Only POST is checked for completeness. A PATCH is partial by definition, so
  // demanding every required field there would block the most common write.
  if (method === 'POST') {
    const missing = schema
      .filter((field) => field.required && provided[field.name] === undefined)
      .map((field) => field.name);

    if (missing.length) {
      return `Faltan datos obligatorios: ${missing.join(', ')}. Pídeselos a la persona antes de proponer el cambio.`;
    }
  }

  return null;
}

/**
 * The text field a domain uses to keep its document, when it has one.
 *
 * Not every module that owns a document reads `multipart/form-data`. An expense takes
 * its receipt as a key in `receipt_url` and the module fills it after uploading the
 * file separately (`expense-scanner-modal.component.ts:913`). Sending multipart to
 * such a route is worse than useless: with no `FileInterceptor` on the handler,
 * nothing parses the body, `req.body` arrives empty, and the endpoint answers 400
 * complaining about the required fields — which is exactly how this was found, on a
 * change the person had already approved.
 *
 * Matched by name because there is no metadata to ask: the convention across the
 * codebase is `<thing>_url` / `<thing>_key` on a `String` column.
 */
function documentFieldOf(
  schema: CatalogField[] | undefined,
): string | undefined {
  return schema?.find((field) =>
    /^(receipt|document|attachment|file|image|invoice|voucher|support)_(url|key)$/.test(
      field.name,
    ),
  )?.name;
}

/**
 * Generic bridge onto the REST surface.
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
  attachments,
}: ApiBridgeDeps): RegisteredTool[] {
  const base = internalApiBase();
  const authHeaders = internalAuthHeaders;

  /**
   * Reads the current state of the record a write is about to change.
   *
   * This is what turns "apruebo" into informed consent: without it the card
   * showed only the new value, so the person authorised `precio → 12000` with no
   * idea whether the current price was 9000 or 90000. Best-effort by design — a
   * domain with no GET for the path, or a GET that answers differently, degrades
   * to a card without the `from` column rather than blocking the write.
   */
  async function readCurrentState(
    path: string,
  ): Promise<Record<string, unknown> | null> {
    const getEntry = catalog.find(path, 'GET');
    if (!getEntry) return null;

    const scopes = callerScopes();
    if (!getEntry.requiredPermissions.every((p) => scopes.includes(p))) {
      return null;
    }

    try {
      const response = await fetch(`${base}/${requestPath(path)}`, {
        method: 'GET',
        headers: authHeaders(),
      });

      if (!response.ok) return null;

      const parsed = JSON.parse(await response.text()) as {
        data?: unknown;
      } | null;

      const data = parsed && typeof parsed === 'object' ? parsed.data : null;

      return data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return [
    {
      name: 'list_endpoints',
      domain: 'api-bridge',
      readOnly: true,
      description:
        'Lista TODO lo que este usuario puede consultar y modificar en la aplicación, agrupado por dominio, con el verbo de cada ruta. Es tu mapa técnico del sistema: si no sabes cómo hacer algo, empieza por list_capabilities y baja acá cuando necesites la ruta exacta. Cubre la cola larga que no tiene herramienta propia — mesas, cartas, recetas, membresías, gastos, reservas, usuarios, roles, promociones, nómina, configuración. Las herramientas tipadas (productos, inventario, órdenes, clientes, contabilidad) siguen siendo preferibles donde existan porque son más precisas. Para dudas de USO (cómo se hace algo, no qué dato hay), consulta `help-center/articles/search` con el parámetro `q`: son pocos artículos y cubren primeros pasos, venta en POS, tienda en línea, órdenes de compra, ajuste de inventario y métodos de pago. Si no hay artículo para lo que preguntan, no lo inventes: explícalo tú desde el mapa de rutas.',
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
            ...(e.bodySchema ? { campos: e.bodySchema } : {}),
            ...(e.multipart
              ? { necesita_documento: true, campo_archivo: e.fileField }
              : {}),
            // Distinct from `necesita_documento`: this route does not read a file
            // upload, it keeps the document in a column. The model must not be told
            // to send multipart to it — nothing there would parse it.
            ...(!e.multipart && documentFieldOf(e.bodySchema)
              ? { acepta_documento: true }
              : {}),
            ...(irreversibleWarning(e.path) ? { irreversible: true } : {}),
          })),
          note: 'GET se ejecuta con call_endpoint. POST, PATCH, PUT y DELETE con write_endpoint, que pide confirmación al usuario antes de aplicar. `campos` trae el nombre EXACTO, el tipo, si es obligatorio y los valores que acepta: úsalos tal cual, no los traduzcas ni los pases a otra convención. Un `:algo` en la ruta se reemplaza por el id real. Una ruta con `necesita_documento` exige un adjunto y una con `acepta_documento` puede llevarlo: en ambos casos pásale `attachment_id` a write_endpoint y no toques el campo del documento a mano.',
        });
      },
    },
    {
      name: 'call_endpoint',
      domain: 'api-bridge',
      readOnly: true,
      description:
        'Ejecuta una consulta GET contra un endpoint obtenido de list_endpoints, con los permisos del usuario actual. Solo lectura: ninguna modificación pasa por aquí. Si la respuesta viene truncada, acótala con parámetros (limit, page, fechas) en vez de resumir a ciegas. Si el usuario no tiene permiso, te lo dirá y debes explicárselo en vez de reintentar.',
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
            headers: authHeaders(),
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
        'Crea, modifica o archiva datos en cualquier dominio de la aplicación, usando una ruta de list_endpoints. Con esto puedes hacer prácticamente cualquier operación del sistema: registrar un gasto, crear un usuario y asignarle un rol, configurar mesas, cartas o recetas, gestionar membresías, rutas y remisiones, categorías, promociones, clientes, la tienda en línea y la configuración de la tienda. Si la ruta necesita un documento (una factura, un comprobante, una planilla), pásale `attachment_id`: el archivo queda guardado junto al registro que se cree, igual que si la persona lo hubiera subido desde el módulo. Se ejecuta con los permisos del usuario, y NUNCA se aplica sin que la persona apruebe: al llamarla recibirás la propuesta para que se la resumas y le pidas confirmación. Antes de llamarla, VERIFICA con una consulta que el registro exista (o que no exista ya, si vas a crearlo). DELETE archiva, no borra de verdad.',
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
          attachment_id: {
            type: 'string',
            description:
              'Documento adjunto que la operación necesita o admite, como "att_41". Úsalo en rutas marcadas con necesita_documento o con acepta_documento; en ambos casos el archivo queda guardado junto al registro y NO debes escribir el campo del documento a mano.',
          },
          file_field: {
            type: 'string',
            description:
              'Nombre del campo de archivo cuando no es el habitual "file" (la carga de certificados de facturación usa "certificate").',
          },
        },
        required: ['path', 'method'],
      },
      /**
       * Runs BEFORE any token is issued, so it doubles as the last chance to
       * refuse cheaply: an unknown route, a missing permission, a wrongly typed
       * body or an impossible change returns `status: 'error'` and the registry
       * declines to mint a token at all rather than letting the user approve
       * something that cannot work.
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

        const invalid = validateBody(entry.bodySchema, body, method);
        if (invalid) {
          return { status: 'error' as const, message: invalid };
        }

        if (entry.multipart && !args.attachment_id) {
          return {
            status: 'error' as const,
            message:
              'Esta operación necesita el documento adjunto y no me pasaste ninguno. Pídeselo a la persona.',
          };
        }

        // How the document will actually reach the record, decided here so the
        // refusal happens before a token exists. A route that has neither a file
        // interceptor nor a document column cannot keep the file, and applying the
        // change anyway would leave the person with a record they believe carries
        // its invoice and does not.
        const documentField = documentFieldOf(entry.bodySchema);

        if (args.attachment_id && !entry.multipart && !documentField) {
          return {
            status: 'error' as const,
            message:
              `Esa operación no guarda documentos, así que el archivo se perdería. ` +
              `Registra el cambio sin el documento, o busca con list_endpoints la ruta del módulo que sí lo recibe.`,
          };
        }

        // A handle is not a document. If the model put `att_41` into the column
        // itself, the record would end up pointing at nothing.
        if (documentField && /^att_\d+$/.test(String(body?.[documentField] ?? ''))) {
          return {
            status: 'error' as const,
            message: `No pongas el identificador del documento en ${labelOf(documentField)}; pásamelo en attachment_id y yo lo guardo con el registro.`,
          };
        }

        const { summary, consequence } = describeWrite(
          method,
          entry.domain,
          body,
          entry.summary,
        );

        // Read the record as it stands, so the card shows `de → a` instead of
        // only the new value. Skipped for POST: there is nothing to compare
        // against when the record does not exist yet.
        const current =
          method === 'POST' ? null : await readCurrentState(path);

        const changes = body
          ? Object.entries(body)
              .filter(([, value]) => value !== undefined && value !== null)
              .slice(0, 12)
              .map(([field, value]) => ({
                field,
                label: labelOf(field),
                from: current ? (current[field] ?? null) : undefined,
                to: typeof value === 'object' ? JSON.stringify(value) : value,
              }))
          : undefined;

        // A DELETE has no body, so the card would be empty. Naming the record
        // being archived is the whole content of that decision.
        const target =
          (typeof current?.['name'] === 'string' && current['name']) ||
          (typeof body?.['name'] === 'string' && body['name']) ||
          undefined;

        const irreversible = irreversibleWarning(entry.path);

        // Named on the card, because approving a change that attaches a document is
        // approving the document too. Best-effort: a handle that no longer resolves
        // must not cost the proposal — the handler refuses it loudly instead.
        if (args.attachment_id && changes) {
          const document = await attachments
            .storageKey(String(args.attachment_id))
            .catch(() => null);

          if (document) {
            changes.push({
              field: documentField ?? 'documento',
              label: 'Documento',
              from: undefined,
              to: document.original_name,
            });
          }
        }

        return {
          status: 'ok' as const,
          domain: entry.domain,
          label: summary,
          ...(target ? { target: String(target) } : {}),
          message:
            irreversible ??
            consequence ??
            'Confírmalo y lo aplico.',
          ...(irreversible ? { irreversible: true } : {}),
          changes,
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

        const attachmentId = args.attachment_id
          ? String(args.attachment_id)
          : undefined;

        const documentField = documentFieldOf(entry.bodySchema);

        if (attachmentId && !entry.multipart && !documentField) {
          return JSON.stringify({
            applied: false,
            error:
              'Esa operación no guarda documentos, así que no la ejecuté: el archivo se habría perdido.',
          });
        }

        try {
          // Multipart ONLY when the handler actually declares a file interceptor.
          // Choosing it because an attachment exists sends `multipart/form-data` to
          // a route with no multer in front of it, and then nothing parses the body:
          // the endpoint rejects every required field as missing, after the person
          // approved the change.
          let request: { headers: Record<string, string>; body?: any };

          if (attachmentId && entry.multipart) {
            request = await buildMultipartRequest(
              attachments,
              attachmentId,
              args.body as Record<string, unknown> | undefined,
              String(args.file_field ?? entry.fileField ?? 'file'),
              method,
            );
          } else if (attachmentId && documentField) {
            // The same value the module writes: the S3 key, not a signed URL, so the
            // record keeps a reference that does not expire.
            const document = await attachments.storageKey(attachmentId);
            request = buildJsonRequest(
              {
                ...((args.body as Record<string, unknown>) ?? {}),
                [documentField]: document.s3_key,
              },
              method,
            );
          } else {
            request = buildJsonRequest(args.body, method);
          }

          const response = await fetch(`${base}/${requestPath(args.path)}`, {
            method,
            // `Content-Type` is deliberately absent for multipart: undici sets
            // it with the boundary token it generated, and overriding it makes
            // multer read an empty body.
            headers: authHeaders(request.headers),
            body: request.body,
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

          // Tie the document to the record it justified. Best-effort: the write
          // already happened, so a failure here is a gap in the audit trail, not
          // a reason to report the operation as failed.
          if (attachmentId) {
            await attachments.linkTo(
              attachmentId,
              entry.domain,
              extractCreatedId(responseBody),
            );
          }

          return JSON.stringify({
            applied: true,
            data:
              responseBody.length > MAX_RESPONSE_CHARS
                ? responseBody.slice(0, MAX_RESPONSE_CHARS)
                : responseBody,
            ...(attachmentId
              ? {
                  document_attached: true,
                  note_document:
                    'El documento quedó guardado junto al registro, así que la persona puede consultarlo desde ahí.',
                }
              : {}),
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

/** JSON request parts. `DELETE` never carries a body in this API. */
function buildJsonRequest(
  body: unknown,
  method: WriteMethod,
): { headers: Record<string, string>; body?: string } {
  if (method === 'DELETE' || body === undefined) {
    return { headers: {} };
  }

  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * The stored document, rebuilt into the upload the module's own screen would send.
 *
 * The transport detail lives in `buildMultipartBody`; what belongs here is pulling
 * the file back out of S3 by its handle, which is the step that lets a document the
 * person attached to a chat message reach the endpoint that persists it.
 */
async function buildMultipartRequest(
  attachments: VexiAttachmentsService,
  attachmentId: string,
  body: Record<string, unknown> | undefined,
  fileField: string,
  method: WriteMethod,
): Promise<{ headers: Record<string, string>; body?: FormData }> {
  const payload = await attachments.read(attachmentId);

  const form = buildMultipartBody({
    file: {
      buffer: payload.buffer,
      mimeType: payload.mime_type,
      fileName: payload.original_name,
    },
    fileField,
    fields: body,
  });

  return { headers: {}, body: method === 'DELETE' ? undefined : form };
}

/**
 * The id of the record a write just produced, for the audit link.
 *
 * Reads `data.id` out of the standard response envelope and tolerates every
 * other shape by answering `null` — the link is then recorded against the domain
 * without an id, which still answers "this document was used here".
 */
function extractCreatedId(responseBody: string): number | null {
  try {
    const parsed = JSON.parse(responseBody) as {
      data?: { id?: unknown } | Array<{ id?: unknown }>;
    };

    const data = Array.isArray(parsed?.data) ? parsed.data[0] : parsed?.data;
    const id = data?.id;

    return typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}
