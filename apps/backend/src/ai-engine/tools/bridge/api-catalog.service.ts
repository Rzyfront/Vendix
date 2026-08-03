import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  RequestMethod,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../../domains/auth/decorators/permissions.decorator';

export interface CatalogEntry {
  /** Path as mounted, without the global prefix: `store/reservations`. */
  path: string;
  /** Domain segment used for grouping: `store`, `organization`, `public`. */
  area: string;
  /** Second segment, the actual subject: `reservations`, `products`. */
  domain: string;
  controller: string;
  handler: string;
  requiredPermissions: string[];
}

/**
 * Read-only map of every `GET` endpoint the API exposes, built once at boot.
 *
 * This is what lets Vexi answer about the ~50 domains that have no typed tool.
 * Only `GET` is catalogued: mutations must go through tools with a typed
 * preview and a confirmation step, so there is deliberately no way to reach a
 * write from here.
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
        if (verb !== RequestMethod.GET) continue;

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

        this.entries.push({
          path: fullPath,
          area,
          domain,
          controller: wrapper.metatype?.name ?? 'unknown',
          handler: methodName,
          requiredPermissions: permissions,
        });
      }
    }

    this.logger.log(
      `api-bridge: catalogued ${this.entries.length} GET endpoints`,
    );
  }

  /**
   * Endpoints the given scopes may call. Fail-closed: an endpoint declaring
   * permissions the caller lacks is not listed, so the model never learns
   * about surfaces this user cannot reach.
   */
  listFor(scopes: string[], area?: string, domain?: string): CatalogEntry[] {
    return this.entries.filter((e) => {
      if (area && e.area !== area) return false;
      if (domain && e.domain !== domain) return false;
      return e.requiredPermissions.every((p) => scopes.includes(p));
    });
  }

  find(path: string): CatalogEntry | undefined {
    const normalized = this.normalize(path);
    return this.entries.find((e) => e.path === normalized);
  }

  /** Distinct `area/domain` pairs, for orienting the model cheaply. */
  domainsFor(scopes: string[]): string[] {
    const seen = new Set<string>();
    for (const entry of this.listFor(scopes)) {
      seen.add(`${entry.area}/${entry.domain}`);
    }
    return Array.from(seen).sort();
  }

  private normalize(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
  }
}
