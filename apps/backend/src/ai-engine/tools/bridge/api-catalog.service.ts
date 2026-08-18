import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  RequestMethod,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  PATH_METADATA,
  METHOD_METADATA,
  INTERCEPTORS_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { getMetadataStorage } from 'class-validator';
import { PERMISSIONS_KEY } from '../../../domains/auth/decorators/permissions.decorator';

/**
 * Metadata key that `@ApiOperation` writes on the handler.
 *
 * NO importar `@nestjs/swagger/dist/constants`: desde 11.4.x el paquete declara
 * un mapa `exports` que solo expone `.` y `./plugin`, así que ese subpath deja
 * de resolver y `require` explota con `ERR_PACKAGE_PATH_NOT_EXPORTED` — en
 * arranque, porque `ApiCatalogService` es provider de `AiEngineModule`. Y no se
 * ve venir: `tsc` con `moduleResolution: node` ignora `exports`, así que el
 * build queda verde y el fallo aparece al levantar la imagen.
 *
 * El literal es estable por contrato: es la clave que `@ApiOperation` graba en
 * Reflect y que Swagger tiene que seguir leyendo, así que cambiarla rompería
 * cualquier documento OpenAPI ya generado. `resolveSummary` abajo tolera que
 * falte, de modo que un cambio de clave degrada a "sin summary" en vez de
 * tumbar el catálogo.
 */
const SWAGGER_API_OPERATION_METADATA = 'swagger/apiOperation';

/**
 * Clave que `@ApiProperty` graba por propiedad del DTO.
 *
 * Mismo literal-por-contrato y misma razón de no importarla que la de arriba.
 * Solo se le pide la `description`: el tipo y la obligatoriedad los sigue
 * decidiendo class-validator, que es lo que de verdad acepta o rechaza el
 * request. Swagger aquí aporta la frase y nada más, así que un DTO sin
 * `@ApiProperty` publica exactamente lo mismo que antes.
 */
const SWAGGER_API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

/** Verbs the bridge can execute. Anything else is not catalogued. */
export type CatalogMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface CatalogEntry {
  /** Path as mounted, without the global prefix: `store/reservations`. */
  path: string;
  /** HTTP verb. `GET` is reachable by `call_endpoint`, the rest by `write_endpoint`. */
  method: CatalogMethod;
  /** Domain segment used for grouping: `store`, `organization`, `public`. */
  area: string;
  /** Second segment, the actual subject: `reservations`, `products`. */
  domain: string;
  controller: string;
  handler: string;
  requiredPermissions: string[];
  /**
   * The endpoint's own `@ApiOperation({ summary })`, when it declares one.
   *
   * This is the honest source for an approval label. Deriving one from verb +
   * path segment guesses wrong on action routes: `POST
   * organization/roles/assign-to-user` came out as "Crear un rol" when it
   * assigns an existing role to a user — a card describing a different
   * operation than the one about to run, which is a consent defect, not a
   * cosmetic one. The summary is written in Spanish by whoever built the
   * endpoint and says what it actually does.
   */
  summary?: string;
  /**
   * Field names the endpoint's body DTO declares, for write verbs.
   *
   * Without this the model has to guess the shape of every body, and it guesses
   * in the wrong convention: it sent `roleIds` to an endpoint whose DTO declares
   * `role_ids`, the write was rejected as invalid, and the person had already
   * approved it. Nothing in the propose→approve gate can catch that, because
   * the preview validates the route and the caller's permissions, not the body.
   * Publishing the field names turns a guess into a lookup.
   */
  bodyFields?: string[];
  /**
   * Same fields as `bodyFields`, with the type, the obligation and the accepted
   * values each one declares.
   *
   * Publishing only names left the model guessing at everything else, and it
   * guessed the way a language model does: `"mil pesos"` for a `@IsNumber()`,
   * `"aprobado"` for an enum whose members are `approved | rejected`, an ISO
   * timestamp for a `@IsDateString()` that wants a plain date. Every one of those
   * costs a rejected request AFTER the person approved the change, which is the
   * worst possible moment to discover it. Read from class-validator rather than
   * Swagger for the same reason `bodyFields` is: the validators are what
   * actually decide whether the request is accepted.
   */
  bodySchema?: CatalogField[];
  /**
   * Los parámetros de query que el endpoint acepta, con su tipo y su
   * obligatoriedad.
   *
   * Sin esto el catálogo describía CÓMO escribir y nada sobre cómo consultar:
   * `bodySchema` se calculaba solo para los verbos de escritura, así que
   * cualquier GET con filtros llegaba al modelo como una ruta pelada. Y el
   * backend valida con `forbidNonWhitelisted`, de modo que un parámetro
   * inventado no se ignora — devuelve 400. Medido en producción el 18/08/2026:
   * el agente pidió `store/categories/search` con `q`, luego con `name`, luego
   * con `search`, y se quedó sin iteraciones antes de llegar a escribir, con la
   * persona mirando "no pude completar eso". El parámetro correcto estaba
   * declarado en `CategoryQueryDto` desde siempre; simplemente no se publicaba.
   *
   * Se calcula para TODOS los verbos: un POST con paginación en la query tiene
   * el mismo problema que un GET.
   */
  querySchema?: CatalogField[];
  /**
   * True when the handler is wrapped in a multer interceptor, so the request
   * must be sent as `multipart/form-data` and not JSON.
   *
   * Every document-driven flow in the product is one of these — every
   * `scan/confirm`, every bulk upload — so without this flag the bridge silently
   * sends JSON to a route that only reads form fields, and the endpoint answers
   * with a validation error about a body it never received.
   */
  multipart?: boolean;
  /**
   * The form field the file travels in. Resolved by `fileFieldFor`: `file` for the
   * 33 routes that use it, `certificate` for the 3 DIAN certificate uploads. A
   * documented default plus an override, not a discovered value — see
   * `NON_DEFAULT_FILE_FIELDS`.
   */
  fileField?: string;
}

export interface CatalogField {
  name: string;
  /** `string | number | boolean | date | array | object | enum | unknown` */
  type: string;
  required: boolean;
  enumValues?: string[];
  /**
   * Qué significa el campo, tomada de `@ApiProperty({ description })`.
   *
   * El nombre y el tipo dicen cómo mandar el dato, nunca cuándo mandarlo. Un
   * `enabled_price_tier_ids: array` no le dice a nadie que asignar
   * presentaciones a un producto se hace por el endpoint del producto y que la
   * lista es un allowlist duro. Ese conocimiento vivía en docblocks de
   * TypeScript, que no existen en runtime: esto es el canal que sí llega.
   *
   * Opcional por diseño — la mayoría de los DTOs del repo no la traen todavía.
   */
  description?: string;
}

const CATALOGUED_VERBS = new Map<number, CatalogMethod>([
  [RequestMethod.GET, 'GET'],
  [RequestMethod.POST, 'POST'],
  [RequestMethod.PATCH, 'PATCH'],
  [RequestMethod.PUT, 'PUT'],
  [RequestMethod.DELETE, 'DELETE'],
]);

/**
 * Multipart routes whose file field is NOT `file`.
 *
 * The field name lives in the closure of Nest's `FileInterceptor` mixin and is not
 * reachable by reflection at any compiler setting, so it cannot be discovered. It is
 * declared instead of assumed: `rg "File(s)?Interceptor\('[^']+'"` over the backend
 * returns 33 routes on `file` and 3 on `certificate`, and a wrong field name makes
 * multer ignore the upload and the endpoint reject a body it never received.
 *
 * Matched by path suffix so the three DIAN certificate uploads (store, organization,
 * superadmin) are covered by one entry each rather than by a controller-name list.
 */
const NON_DEFAULT_FILE_FIELDS: Array<{ suffix: string; field: string }> = [
  { suffix: 'invoicing/dian-config/upload-certificate', field: 'certificate' },
  { suffix: 'subscriptions/fiscal/certificate', field: 'certificate' },
];

/** The form field a multipart route reads its file from. */
function fileFieldFor(path: string): string {
  return (
    NON_DEFAULT_FILE_FIELDS.find((entry) => path.endsWith(entry.suffix))
      ?.field ?? 'file'
  );
}

/**
 * Map of every endpoint the API exposes, built once at boot.
 *
 * This is what lets Vexi work across the ~50 domains that have no typed tool.
 *
 * Mutating verbs used to be excluded on purpose, so that writes could only
 * happen through typed tools with their own preview. That ruled out every
 * module nobody had written a tool for — charging a sale, creating a user with
 * a role, filing an expense, setting up tables or menus — and Vexi answered
 * those with "no puedo". The verbs are catalogued now and the confirmation
 * requirement moved to `write_endpoint`, which routes every mutation through
 * the same propose→approve→apply gate the typed tools use. What did NOT change
 * is who may call what: the bridge issues an internal request carrying the
 * user's own bearer token, so guards, interceptors and tenant scoping decide,
 * exactly as they would for a browser request.
 */
@Injectable()
export class ApiCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApiCatalogService.name);
  private entries: CatalogEntry[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  /**
   * `onApplicationBootstrap`, not `onModuleInit`: this module is `@Global()`
   * and initializes early, so at its own `onModuleInit` most domain
   * controllers do not exist yet and the catalog would come out nearly empty.
   * This hook fires once every module is up.
   */
  onApplicationBootstrap(): void {
    const controllers = this.discovery.getControllers();

    for (const wrapper of controllers) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;

      const prototype = Object.getPrototypeOf(instance);
      const controllerPath = this.normalize(
        this.reflector.get<string>(PATH_METADATA, wrapper.metatype as any) ??
          '',
      );

      for (const methodName of this.metadataScanner.getAllMethodNames(
        prototype,
      )) {
        const handler = prototype[methodName];
        const verb = this.reflector.get<number>(METHOD_METADATA, handler);
        const method = CATALOGUED_VERBS.get(verb);
        if (!method) continue;

        const handlerPath = this.normalize(
          this.reflector.get<string>(PATH_METADATA, handler) ?? '',
        );

        const fullPath = [controllerPath, handlerPath]
          .filter(Boolean)
          .join('/');

        // Permissions can sit on the handler or on the controller; the guard
        // reads both, so the catalog has to as well or it would advertise
        // endpoints as open that are not.
        const permissions =
          this.reflector.get<string[]>(PERMISSIONS_KEY, handler) ??
          this.reflector.get<string[]>(
            PERMISSIONS_KEY,
            wrapper.metatype as any,
          ) ??
          [];

        const [area = '', domain = ''] = fullPath.split('/');

        // `@ApiOperation` metadata is a plain object on the handler. Read
        // defensively: it is optional, and the shape belongs to Swagger.
        const apiOperation = this.reflector.get<{ summary?: string }>(
          SWAGGER_API_OPERATION_METADATA,
          handler,
        );
        const summary =
          typeof apiOperation?.summary === 'string' &&
          apiOperation.summary.trim()
            ? apiOperation.summary.trim()
            : undefined;

        const bodySchema =
          method === 'GET'
            ? undefined
            : this.bodySchemaOf(prototype, methodName, wrapper.metatype);

        // Para todos los verbos: un GET sin sus filtros publicados obliga al
        // modelo a adivinarlos, y `forbidNonWhitelisted` castiga cada intento
        // con un 400 en vez de ignorar el parámetro sobrante.
        const querySchema = this.querySchemaOf(
          prototype,
          methodName,
          wrapper.metatype,
        );

        const multipart = this.isMultipart(handler, wrapper.metatype);

        this.entries.push({
          path: fullPath,
          method,
          area,
          domain,
          controller: wrapper.metatype?.name ?? 'unknown',
          handler: methodName,
          requiredPermissions: permissions,
          summary,
          bodyFields: bodySchema?.map((field) => field.name),
          bodySchema,
          ...(querySchema ? { querySchema } : {}),
          ...(multipart
            ? { multipart: true, fileField: fileFieldFor(fullPath) }
            : {}),
        });
      }
    }

    const byMethod = this.entries.reduce<Record<string, number>>(
      (acc, entry) => ({ ...acc, [entry.method]: (acc[entry.method] ?? 0) + 1 }),
      {},
    );
    const multipartCount = this.entries.filter((e) => e.multipart).length;
    this.logger.log(
      `api-bridge: catalogued ${this.entries.length} endpoints (${Object.entries(
        byMethod,
      )
        .map(([verb, count]) => `${verb}:${count}`)
        .join(' ')}) · multipart:${multipartCount}`,
    );
  }

  /**
   * Whether the handler expects `multipart/form-data`.
   *
   * Detected by the SOURCE of the interceptor class, never by its name. Nest's
   * `FileInterceptor` / `FilesInterceptor` return an anonymous mixin declared as
   * `class MixinInterceptor`, but SWC — which is what compiles this app in dev —
   * mangles that identifier to a hash (`ab2937d75f6537ac79daa`). A `name ===
   * 'MixinInterceptor'` gate therefore matched nothing at all and the catalog
   * reported `multipart:0` with 36 multipart routes in the tree.
   *
   * The body is what stays stable across compilers: the mixin constructs `multer(...)`
   * and its `intercept` calls `.single(fieldName)` or `.array(fieldName)`.
   */
  private isMultipart(handler: unknown, controller: unknown): boolean {
    const interceptors: unknown[] = [
      ...(this.reflector.get<unknown[]>(INTERCEPTORS_METADATA, handler as any) ??
        []),
      ...(this.reflector.get<unknown[]>(
        INTERCEPTORS_METADATA,
        controller as any,
      ) ?? []),
    ];

    return interceptors.some(
      (interceptor) =>
        typeof interceptor === 'function' &&
        /this\.multer\s*=\s*multer\(|\.single\(|\.array\(/.test(
          String(interceptor),
        ),
    );
  }

  /**
   * Endpoints the given scopes may call. Fail-closed: an endpoint declaring
   * permissions the caller lacks is not listed, so the model never learns
   * about surfaces this user cannot reach.
   */
  listFor(
    scopes: string[],
    area?: string,
    domain?: string,
    methods?: CatalogMethod[],
  ): CatalogEntry[] {
    return this.entries.filter((e) => {
      if (area && e.area !== area) return false;
      if (domain && e.domain !== domain) return false;
      if (methods && !methods.includes(e.method)) return false;
      return e.requiredPermissions.every((p) => scopes.includes(p));
    });
  }

  /**
   * Looks a path up for one specific verb.
   *
   * The verb is mandatory rather than optional: paths collide across methods —
   * `store/products/:id` is a GET, a PATCH and a DELETE — so a verb-blind
   * lookup would hand `call_endpoint` whichever entry happened to be indexed
   * first and let a read tool address a destructive route.
   */
  find(path: string, method: CatalogMethod): CatalogEntry | undefined {
    const normalized = this.normalize(path);
    const sameVerb = this.entries.filter((e) => e.method === method);

    // Literal first: a concrete segment must beat a parameter when both exist,
    // or `store/users/management` would resolve to `store/users/:id`.
    return (
      sameVerb.find((e) => e.path === normalized) ??
      sameVerb.find((e) => this.matchesPattern(e.path, normalized))
    );
  }

  /** Every verb catalogued for a path, so a miss can say what IS available. */
  methodsFor(path: string): CatalogMethod[] {
    const normalized = this.normalize(path);
    const exact = this.entries.filter((e) => e.path === normalized);
    const source = exact.length
      ? exact
      : this.entries.filter((e) => this.matchesPattern(e.path, normalized));
    return source.map((e) => e.method);
  }

  /**
   * Whether a concrete path is an instance of a catalogued pattern.
   *
   * Routes are catalogued as Nest declares them — `store/users/management/:id/
   * roles` — while the model addresses real records: `store/users/management/
   * 215/roles`. Exact string comparison made every parameterized route
   * unreachable, which is most of the mutating surface (PATCH and DELETE are
   * nearly always addressed by id). The symptom was a confident "no encontré
   * esa operación" for endpoints that plainly exist.
   */
  private matchesPattern(pattern: string, concrete: string): boolean {
    if (!pattern.includes(':')) return false;

    const patternParts = pattern.split('/');
    const concreteParts = concrete.split('/');
    if (patternParts.length !== concreteParts.length) return false;

    return patternParts.every((segment, index) => {
      if (segment.startsWith(':')) return concreteParts[index].length > 0;
      return segment === concreteParts[index];
    });
  }

  /**
   * Every permission name that at least one catalogued route requires.
   *
   * The complement of this against what a user actually holds is the honest
   * answer to "what can I do that Vexi cannot reach": a permission with no route
   * behind it is either UI-only or a gap, and either way the agent must say so
   * instead of implying full coverage.
   */
  coveredPermissions(): Set<string> {
    const covered = new Set<string>();
    for (const entry of this.entries) {
      for (const permission of entry.requiredPermissions) {
        covered.add(permission);
      }
    }
    return covered;
  }

  /** Distinct `area/domain` pairs, for orienting the model cheaply. */
  domainsFor(scopes: string[], methods?: CatalogMethod[]): string[] {
    const seen = new Set<string>();
    for (const entry of this.listFor(scopes, undefined, undefined, methods)) {
      seen.add(`${entry.area}/${entry.domain}`);
    }
    return Array.from(seen).sort();
  }

  /**
   * Field names of the handler's body DTO, read from its validators.
   *
   * Uses class-validator's metadata rather than Swagger's: `@ApiProperty` is
   * applied inconsistently across this codebase, while the validation
   * decorators are what actually decide whether a request is accepted — so
   * they are both more complete and a truer description of what the endpoint
   * will take.
   *
   * Best-effort by design: a handler with no DTO simply publishes no fields,
   * and the model falls back to asking the person.
   */
  private bodySchemaOf(
    prototype: object,
    methodName: string,
    controller: unknown,
  ): CatalogField[] | undefined {
    return this.schemaOfParam(
      prototype,
      methodName,
      controller,
      RouteParamtypes.BODY,
    );
  }

  /** Lo mismo que `bodySchemaOf`, para el DTO que viaja en `@Query()`. */
  private querySchemaOf(
    prototype: object,
    methodName: string,
    controller: unknown,
  ): CatalogField[] | undefined {
    return this.schemaOfParam(
      prototype,
      methodName,
      controller,
      RouteParamtypes.QUERY,
    );
  }

  /**
   * El DTO que el handler recibe en una posición concreta de decorador.
   *
   * Nest graba en la CLASE del controlador un mapa `__routeArguments__` con la
   * forma `"<paramtype>:<índice>"`, y `design:paramtypes` trae los tipos por
   * índice. Cruzando ambos se sabe cuál de los parámetros es el `@Body()` y
   * cuál el `@Query()`, cosa que la convención de nombre sola no distingue: un
   * handler con los dos publicaba el primero que apareciera, y si ese era el de
   * query el modelo terminaba mandando filtros como si fueran el cuerpo.
   *
   * Si el mapa no está (handler sin decoradores de parámetro), se degrada al
   * heurístico anterior — el primer `*Dto` de la firma — para no perder los
   * campos que el catálogo ya publicaba.
   */
  private dtoForParam(
    prototype: object,
    methodName: string,
    controller: unknown,
    wanted: RouteParamtypes,
  ): (new (...args: any[]) => unknown) | undefined {
    const paramTypes: unknown[] =
      Reflect.getMetadata('design:paramtypes', prototype, methodName) ?? [];

    const isDto = (t: unknown): t is new (...args: any[]) => unknown =>
      typeof t === 'function' && /Dto$/.test((t as Function).name);

    const routeArgs =
      typeof controller === 'function'
        ? (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, methodName) as
            | Record<string, { index?: number }>
            | undefined)
        : undefined;

    if (routeArgs) {
      for (const [key, meta] of Object.entries(routeArgs)) {
        // La clave es `<paramtype>:<índice>`; el sufijo tras `:` no siempre es
        // el índice (los decoradores custom lo usan de otra forma), así que el
        // índice se lee del valor.
        if (Number(key.split(':')[0]) !== wanted) continue;
        const index = meta?.index;
        if (typeof index !== 'number') continue;
        const candidate = paramTypes[index];
        // `@Query('q') q: string` es un parámetro con nombre, no un DTO: sin
        // este filtro se publicaría `String` como si fuera el esquema.
        if (isDto(candidate)) return candidate;
      }
      return undefined;
    }

    return paramTypes.find(isDto);
  }

  private schemaOfParam(
    prototype: object,
    methodName: string,
    controller: unknown,
    wanted: RouteParamtypes,
  ): CatalogField[] | undefined {
    try {
      const dto = this.dtoForParam(prototype, methodName, controller, wanted);
      if (!dto) return undefined;

      const metadatas = getMetadataStorage().getTargetValidationMetadatas(
        dto,
        '',
        false,
        false,
      );

      const byProperty = new Map<
        string,
        { constraints: string[]; enumValues?: string[] }
      >();

      for (const metadata of metadatas) {
        const property = metadata.propertyName;
        if (!property) continue;

        const entry = byProperty.get(property) ?? { constraints: [] };

        // El discriminador es `name`, no `type`.
        //
        // class-validator construye casi todos sus decoradores con `ValidateBy`,
        // y esos registran `type: 'customValidation'` — el mismo valor para
        // `@IsString`, `@IsInt`, `@IsBoolean`, `@IsEnum` y `@IsIn`. Leyendo
        // `type` (84 de 144 metadatas de `UpdateProductDto` son
        // `customValidation`) `inferFieldType` no podía distinguir nada y el
        // catálogo publicaba `type: 'unknown'` en casi todos los campos de casi
        // todos los DTO. El nombre del validador sí viene en `name`
        // (`isString`, `isInt`, `isIn`...); `type` queda de respaldo para las
        // pocas metadatas que no lo traen (`nestedValidation`).
        const type = String(
          (metadata as { name?: unknown }).name ??
            (metadata as { type?: unknown }).type ??
            '',
        );
        entry.constraints.push(type);

        // `isIn` cuenta igual que `isEnum`. 131 archivos DTO del backend
        // restringen un string con `@IsIn([...])` en vez de un enum de
        // TypeScript, y hasta acá todos salían como `type: 'unknown'` y sin un
        // solo valor permitido. El caso que lo hizo evidente es
        // `price_tiers.kind: 'customer_tier' | 'sale_unit'` — el eje entero de
        // multi-tarifa, que el agente tenía que adivinar.
        const normalized = type.toLowerCase();
        if (normalized === 'isenum' || normalized === 'isin') {
          entry.enumValues = this.enumValuesOf(metadata);
        }

        byProperty.set(property, entry);
      }

      const fields = Array.from(byProperty.entries())
        .map(([name, entry]) => {
          const description = this.fieldDescriptionOf(dto, name);
          return {
            name,
            type: this.inferFieldType(entry.constraints),
            // `@IsOptional()` registers itself as a conditional validation, so its
            // presence — not the absence of `@IsDefined()` — is what marks a field
            // as optional. Reading it the other way round labelled every field of
            // every DTO as optional.
            required: !entry.constraints.some((constraint) =>
              /conditionalValidation|isOptional/i.test(constraint),
            ),
            ...(entry.enumValues?.length
              ? { enumValues: entry.enumValues }
              : {}),
            ...(description ? { description } : {}),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return fields.length ? fields : undefined;
    } catch {
      // Never let catalog construction fail over an optional nicety.
      return undefined;
    }
  }

  /**
   * The accepted members of an `@IsEnum()` or an `@IsIn()`.
   *
   * Las dos guardan lo permitido en `constraints[0]`, pero con formas distintas:
   * `@IsEnum` deja el objeto enum y `@IsIn` deja el array literal. El array hay
   * que leerlo tal cual — pasarlo por el filtro de claves numéricas del enum lo
   * vacía entero, porque las claves de un array SON números.
   *
   * En el enum sí se descartan las claves numéricas: un enum numérico de
   * TypeScript produce el mapeo inverso (`{0:'A', A:0}`) y publicar `0` le
   * diría al modelo que es un valor válido para un campo que solo acepta `'A'`.
   */
  private enumValuesOf(metadata: unknown): string[] | undefined {
    const constraints = (metadata as { constraints?: unknown[] }).constraints;
    const target = constraints?.[0];

    if (!target || typeof target !== 'object') return undefined;

    const values = Array.isArray(target)
      ? target
          .filter((value) => value !== null && value !== undefined)
          .map((value) => String(value))
      : Object.entries(target as Record<string, unknown>)
          .filter(([key]) => !/^\d+$/.test(key))
          .map(([, value]) => String(value));

    return values.length ? values.slice(0, 40) : undefined;
  }

  /**
   * La `description` que `@ApiProperty` dejó sobre esa propiedad del DTO.
   *
   * Best-effort y silencioso: la clave de metadata es un literal por contrato
   * (ver `SWAGGER_API_MODEL_PROPERTIES`) y un DTO sin el decorador simplemente
   * no aporta nada. Nunca puede tumbar la construcción del catálogo — perder
   * una frase es aceptable, perder el mapa entero de rutas no.
   */
  private fieldDescriptionOf(
    dto: new (...args: any[]) => unknown,
    property: string,
  ): string | undefined {
    try {
      const meta = Reflect.getMetadata(
        SWAGGER_API_MODEL_PROPERTIES,
        dto.prototype,
        property,
      ) as { description?: unknown } | undefined;

      const description = meta?.description;
      return typeof description === 'string' && description.trim()
        ? description.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Tipo grueso a partir de los nombres de validador aplicados a la propiedad. */
  private inferFieldType(constraints: string[]): string {
    const has = (pattern: RegExp) =>
      constraints.some((constraint) => pattern.test(constraint));

    // El contenedor manda sobre el tipo del elemento: `@IsArray()` con
    // `@IsInt({ each: true })` es un array de enteros, no un entero. Los valores
    // permitidos del elemento siguen viajando aparte, en `enumValues`.
    if (has(/^(isArray|arrayM(in|ax)Size|arrayNotEmpty|arrayUnique)$/i))
      return 'array';
    if (has(/^is(Enum|In)$/i)) return 'enum';
    if (has(/^isBoolean$/i)) return 'boolean';
    if (has(/^isInt$/i)) return 'integer';
    if (has(/^(isNumber|isDecimal|isPositive|isNegative|min|max)$/i))
      return 'number';
    if (has(/^isDate(String)?$/i)) return 'date';
    if (has(/^(nestedValidation|isObject)$/i)) return 'object';
    if (has(/^(isString|isEmail|isUrl|isUUID|matches|length|minLength|maxLength)$/i))
      return 'string';
    return 'unknown';
  }

  private normalize(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
  }
}
