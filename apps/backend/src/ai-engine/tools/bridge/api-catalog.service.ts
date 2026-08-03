import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  RequestMethod,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { DECORATORS as SWAGGER_DECORATORS } from '@nestjs/swagger/dist/constants';
import { getMetadataStorage } from 'class-validator';
import { PERMISSIONS_KEY } from '../../../domains/auth/decorators/permissions.decorator';

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
}

const CATALOGUED_VERBS = new Map<number, CatalogMethod>([
  [RequestMethod.GET, 'GET'],
  [RequestMethod.POST, 'POST'],
  [RequestMethod.PATCH, 'PATCH'],
  [RequestMethod.PUT, 'PUT'],
  [RequestMethod.DELETE, 'DELETE'],
]);

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
          SWAGGER_DECORATORS.API_OPERATION,
          handler,
        );
        const summary =
          typeof apiOperation?.summary === 'string' &&
          apiOperation.summary.trim()
            ? apiOperation.summary.trim()
            : undefined;

        this.entries.push({
          path: fullPath,
          method,
          area,
          domain,
          controller: wrapper.metatype?.name ?? 'unknown',
          handler: methodName,
          requiredPermissions: permissions,
          summary,
          bodyFields:
            method === 'GET'
              ? undefined
              : this.bodyFieldsOf(prototype, methodName),
        });
      }
    }

    const byMethod = this.entries.reduce<Record<string, number>>(
      (acc, entry) => ({ ...acc, [entry.method]: (acc[entry.method] ?? 0) + 1 }),
      {},
    );
    this.logger.log(
      `api-bridge: catalogued ${this.entries.length} endpoints (${Object.entries(
        byMethod,
      )
        .map(([verb, count]) => `${verb}:${count}`)
        .join(' ')})`,
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
   * The DTO is identified by naming convention (`*Dto`) among the handler's
   * parameter types. Best-effort by design: a handler with no DTO simply
   * publishes no fields, and the model falls back to asking the person.
   */
  private bodyFieldsOf(
    prototype: object,
    methodName: string,
  ): string[] | undefined {
    try {
      const paramTypes: unknown[] =
        Reflect.getMetadata('design:paramtypes', prototype, methodName) ?? [];

      const dto = paramTypes.find(
        (t): t is new (...args: any[]) => unknown =>
          typeof t === 'function' && /Dto$/.test((t as Function).name),
      );
      if (!dto) return undefined;

      const fields = getMetadataStorage()
        .getTargetValidationMetadatas(dto, '', false, false)
        .map((m) => m.propertyName);

      const unique = Array.from(new Set(fields)).sort();
      return unique.length ? unique : undefined;
    } catch {
      // Never let catalog construction fail over an optional nicety.
      return undefined;
    }
  }

  private normalize(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
  }
}
