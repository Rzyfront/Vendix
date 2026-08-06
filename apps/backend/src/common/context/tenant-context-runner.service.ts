import { Injectable } from '@nestjs/common';

import { ErrorCodes } from '../errors/error-codes';
import { VendixHttpException } from '../errors/vendix-http.exception';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  FiscalScopeService,
  type OrganizationFiscalScope,
} from '../services/fiscal-scope.service';
import type { OrganizationOperatingScope } from '../services/operating-scope.service';
import { RequestContextService, type RequestContext } from './request-context.service';

/**
 * Tenant al que apunta una operación de la consola de super admin.
 *
 * Se construye desde los segmentos de ruta `:scope/:tenantId`, siempre en
 * plural (`stores` / `organizations`): `DomainScopeGuard` responde 403 a
 * cualquier path que contenga el literal `/store/` con un token `VENDIX_ADMIN`.
 */
export type TenantTarget =
  | { kind: 'store'; store_id: number }
  | { kind: 'organization'; organization_id: number };

export interface ResolvedTenantScope {
  organization_id: number;
  /** `null` ⇔ `fiscal_scope === 'ORGANIZATION'`. */
  store_id: number | null;
  fiscal_scope: OrganizationFiscalScope;
  operating_scope: OrganizationOperatingScope;
  organization_name: string;
  organization_slug: string | null;
  store_name: string | null;
  store_is_active: boolean | null;
}

export interface TenantActor {
  user_id?: number;
  email?: string;
}

export interface RunAsTenantOptions {
  /** El super admin real que ejecuta. Nunca un usuario del tenant. */
  actor: TenantActor;
  permissions: string[];
}

/**
 * El único punto del sistema capaz de alcanzar un tenant arbitrario.
 *
 * Resuelve `(organization_id, store_id, fiscal_scope)` desde un id de tenant y
 * ejecuta el callback dentro de un `RequestContext` forjado, de modo que los
 * servicios de tienda y organización existentes —que leen el tenant del ALS—
 * se reutilicen sin modificarse.
 *
 * No sustituye a `StoreContextRunner`: aquel fija `is_super_admin: false` a
 * propósito para crons y webhooks, y no sabe expresar una configuración de
 * alcance organización (`store_id: null`). Dos runners, dos intenciones.
 */
@Injectable()
export class TenantContextRunner {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  /**
   * Resuelve el alcance del tenant. Lectura pura: no crea entidades contables
   * ni ninguna otra fila, así que es seguro llamarla desde un GET.
   */
  async resolve(target: TenantTarget): Promise<ResolvedTenantScope> {
    this.assertAmbientSuperAdmin();

    const tenant = await this.loadTenant(target);

    if (tenant.is_platform) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La organización plataforma no se administra desde la consola de tenants: usa superadmin/subscriptions/fiscal o super-admin/fiscal',
      );
    }

    const fiscal_scope = await this.fiscalScope.requireFiscalScope(
      tenant.organization_id,
    );
    const operating_scope = (tenant.operating_scope ??
      'STORE') as OrganizationOperatingScope;

    // Deja que la combinación prohibida salga como 400 aquí y no tres capas
    // más abajo con un mensaje que no nombra al tenant.
    this.fiscalScope.assertValidScopeCombination(operating_scope, fiscal_scope);

    const store_id = this.resolveStoreId(target, tenant, fiscal_scope);

    // Invariante duro. Con `organization_id` en undefined el OR-scope de
    // `dian_configurations` degenera en un match-all sobre todos los tenants,
    // porque Prisma descarta las claves undefined del where.
    if (
      !Number.isInteger(tenant.organization_id) ||
      tenant.organization_id <= 0
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_INTERNAL_001,
        'No se pudo resolver un organization_id válido para el tenant',
      );
    }

    return {
      organization_id: tenant.organization_id,
      store_id,
      fiscal_scope,
      operating_scope,
      organization_name: tenant.organization_name,
      organization_slug: tenant.organization_slug,
      store_name: tenant.store_name,
      store_is_active: tenant.store_is_active,
    };
  }

  /**
   * Ejecuta `fn` dentro del contexto forjado del tenant.
   *
   * Todo lo que dependa del ALS —incluido el encolado de jobs, que snapshotea
   * el contexto en el payload— debe ocurrir DENTRO del callback. Encolar fuera
   * guardaría la organización del super admin y el worker resolvería la
   * entidad fiscal equivocada.
   */
  async runAsTenant<T>(
    target: TenantTarget,
    options: RunAsTenantOptions,
    fn: (scope: ResolvedTenantScope) => Promise<T>,
  ): Promise<T> {
    const scope = await this.resolve(target);

    const forged: RequestContext = {
      user_id: options.actor.user_id,
      email: options.actor.email,
      organization_id: scope.organization_id,
      store_id: scope.store_id ?? undefined,
      // Nunca STORE_ADMIN: que el forjado siga siendo identificable en logs.
      app_type: 'VENDIX_ADMIN',
      roles: ['super_admin'],
      permissions: options.permissions,
      is_super_admin: true,
      is_owner: false,
      request_id: RequestContextService.getRequestId(),
      // `access_token` se omite deliberadamente: el api-bridge de IA lo replaya
      // y reemitiría la credencial del super admin desde dentro de un contexto
      // de tenant ajeno.
    };

    return RequestContextService.runIsolated(forged, () => fn(scope));
  }

  /**
   * Defensa en profundidad: si alguien cablea este runner en un controlador de
   * tienda, se niega en runtime en vez de conceder alcance cross-tenant.
   */
  private assertAmbientSuperAdmin(): void {
    const ambient = RequestContextService.getContext();
    if (ambient?.is_super_admin !== true) {
      throw new VendixHttpException(
        ErrorCodes.AUTH_PERM_001,
        'La consola de tenants requiere un contexto de super administrador',
      );
    }
  }

  private async loadTenant(target: TenantTarget) {
    if (target.kind === 'store') {
      const store = await this.globalPrisma.stores.findUnique({
        where: { id: target.store_id },
        select: {
          id: true,
          name: true,
          is_active: true,
          organization_id: true,
          organizations: {
            select: {
              id: true,
              name: true,
              slug: true,
              operating_scope: true,
              is_platform: true,
            },
          },
        },
      });

      if (!store?.organizations) {
        throw new VendixHttpException(
          ErrorCodes.SYS_NOT_FOUND_001,
          `Tienda ${target.store_id} no encontrada`,
        );
      }

      return {
        organization_id: store.organizations.id,
        organization_name: store.organizations.name,
        organization_slug: store.organizations.slug ?? null,
        operating_scope: store.organizations.operating_scope,
        is_platform: store.organizations.is_platform,
        store_id: store.id,
        store_name: store.name,
        store_is_active: store.is_active,
      };
    }

    const organization = await this.globalPrisma.organizations.findUnique({
      where: { id: target.organization_id },
      select: {
        id: true,
        name: true,
        slug: true,
        operating_scope: true,
        is_platform: true,
      },
    });

    if (!organization) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        `Organización ${target.organization_id} no encontrada`,
      );
    }

    return {
      organization_id: organization.id,
      organization_name: organization.name,
      organization_slug: organization.slug ?? null,
      operating_scope: organization.operating_scope,
      is_platform: organization.is_platform,
      store_id: null as number | null,
      store_name: null as string | null,
      store_is_active: null as boolean | null,
    };
  }

  private resolveStoreId(
    target: TenantTarget,
    tenant: { store_id: number | null },
    fiscal_scope: OrganizationFiscalScope,
  ): number | null {
    // La identidad DIAN de un tenant de alcance organización está anclada a
    // nivel organización, aunque la URL nombre una tienda concreta. Forjar un
    // store_id aquí escribiría una configuración de tienda que contradice el
    // modelo fiscal de la organización y aterrizaría en el índice único
    // parcial equivocado.
    if (fiscal_scope === 'ORGANIZATION') {
      return null;
    }

    if (target.kind === 'store') {
      return tenant.store_id;
    }

    // Deliberadamente NO se llama a resolveStoreIdForFiscalScope(): su
    // auto-selección silenciosa cuando la organización tiene una sola tienda
    // es aceptable dentro de la sesión del propio comerciante, pero desde una
    // consola cross-tenant es el mecanismo exacto por el que se configura el
    // NIT equivocado.
    throw new VendixHttpException(
      ErrorCodes.SYS_VALIDATION_001,
      'Esta organización factura con el NIT de cada tienda: entra por superadmin/tenants/stores/:storeId para elegir la tienda titular',
    );
  }
}
