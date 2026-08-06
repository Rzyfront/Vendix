import { Injectable } from '@nestjs/common';

import {
  TenantContextRunner,
  type ResolvedTenantScope,
  type TenantTarget,
} from '@common/context/tenant-context-runner.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

import type { TenantDirectoryQueryDto } from './dto/tenant-directory-query.dto';

/**
 * Lecturas cross-tenant de la consola de super admin.
 *
 * Junto con `TenantContextRunner`, este es el ÚNICO archivo autorizado a usar
 * `GlobalPrismaService` / `withoutScope()` en este rail. La regla que lo hace
 * seguro no es el accesor sino la disciplina: **toda** query de aquí abajo
 * lleva un id de tenant obligatorio en su `where`. Un `where` incompleto sobre
 * un cliente sin scope no falla — devuelve filas de otros tenants en silencio.
 */
@Injectable()
export class TenantDirectoryService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly runner: TenantContextRunner,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  private get db() {
    return this.globalPrisma.withoutScope();
  }

  // --------------------------------------------------------------------
  // Directorio
  // --------------------------------------------------------------------

  async list(query: TenantDirectoryQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 25, 100);
    const skip = (page - 1) * limit;

    const search = query.search?.trim();
    const where: Record<string, unknown> = {
      organizations: { is_platform: false },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              {
                organizations: {
                  is: {
                    is_platform: false,
                    name: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
      ...(typeof query.is_active === 'boolean'
        ? { is_active: query.is_active }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.stores.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          is_active: true,
          created_at: true,
          organization_id: true,
          organizations: {
            select: {
              id: true,
              name: true,
              slug: true,
              fiscal_scope: true,
              operating_scope: true,
              account_type: true,
            },
          },
        },
      }),
      this.db.stores.count({ where }),
    ]);

    const data = await Promise.all(
      rows.map(async (store: any) => {
        const fiscal_scope = this.deriveFiscalScope(store.organizations);
        const dian = await this.summarizeEnablement(
          store.organization_id,
          fiscal_scope === 'ORGANIZATION' ? null : store.id,
        );

        return {
          store_id: store.id,
          store_name: store.name,
          store_slug: store.slug,
          is_active: store.is_active,
          created_at: store.created_at,
          organization_id: store.organizations.id,
          organization_name: store.organizations.name,
          organization_slug: store.organizations.slug,
          fiscal_scope,
          operating_scope: store.organizations.operating_scope ?? 'STORE',
          account_type: store.organizations.account_type,
          enablement_status: dian.enablement_status,
          environment: dian.environment,
          /**
           * Configuraciones DIAN ancladas a tienda en una organización que
           * factura con NIT único: son invisibles para el propio comerciante
           * desde su panel y son exactamente el motivo por el que llama.
           */
          scope_drift: dian.scope_drift,
        };
      }),
    );

    const filtered = query.enablement_status
      ? data.filter((row) => row.enablement_status === query.enablement_status)
      : data;

    return {
      data: filtered,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // --------------------------------------------------------------------
  // Perfil
  // --------------------------------------------------------------------

  /**
   * Perfil de configuración del tenant. Lectura estrictamente pura: usa
   * `findFiscalAccountingEntityId()` y NUNCA `resolveAccountingEntityForFiscal()`,
   * que crearía una entidad contable fantasma en un comercio que jamás activó
   * su módulo fiscal sólo porque un super admin abrió su ficha.
   */
  async getProfile(target: TenantTarget) {
    const scope = await this.runner.resolve(target);

    const [
      settings,
      accountingEntityId,
      dianConfigs,
      resolutions,
      subscription,
      storesCount,
    ] = await Promise.all([
      this.readSettings(scope),
      this.fiscalScope.findFiscalAccountingEntityId({
        organization_id: scope.organization_id,
        store_id: scope.store_id,
      }),
      this.readDianConfigs(scope),
      this.readResolutions(scope),
      scope.store_id ? this.readSubscription(scope.store_id) : null,
      this.db.stores.count({
        where: { organization_id: scope.organization_id, is_active: true },
      }),
    ]);

    const fiscalData = (settings?.fiscal_data ?? {}) as Record<string, any>;

    return {
      header: {
        organization_id: scope.organization_id,
        organization_name: scope.organization_name,
        organization_slug: scope.organization_slug,
        store_id: scope.store_id,
        store_name: scope.store_name,
        is_active: scope.store_is_active,
      },
      scope: {
        fiscal_scope: scope.fiscal_scope,
        operating_scope: scope.operating_scope,
        /** true si la entidad que se está viendo es la que posee el NIT. */
        owns_fiscal_identity:
          scope.fiscal_scope === 'ORGANIZATION'
            ? target.kind === 'organization'
            : target.kind === 'store',
        accounting_entity_id: accountingEntityId,
        stores_count: storesCount,
      },
      fiscal_identity: {
        accounting_entity_id: accountingEntityId,
        legal_name: fiscalData.legal_name ?? null,
        nit: fiscalData.nit ?? fiscalData.tax_id ?? null,
        nit_dv: fiscalData.nit_dv ?? fiscalData.tax_id_dv ?? null,
        nit_type: fiscalData.nit_type ?? null,
        person_type: fiscalData.person_type ?? null,
        tax_regime: fiscalData.tax_regime ?? null,
        responsibilities: fiscalData.tax_responsibilities ?? [],
        ciiu: fiscalData.ciiu ?? fiscalData.ciiu_code ?? null,
        fiscal_address: fiscalData.fiscal_address ?? null,
        municipality_code: fiscalData.municipality_code ?? null,
      },
      fiscal_status: settings?.fiscal_status ?? null,
      dian_configs: dianConfigs,
      resolutions,
      subscription,
    };
  }

  // --------------------------------------------------------------------
  // Lecturas auxiliares — todas con id de tenant obligatorio en el where
  // --------------------------------------------------------------------

  /**
   * Los settings se leen del nivel que posee la identidad fiscal: si la
   * organización factura con NIT único, `fiscal_data` vive en
   * `organization_settings` y leer los de la tienda daría un NIT vacío.
   */
  private async readSettings(
    scope: ResolvedTenantScope,
  ): Promise<Record<string, any> | null> {
    if (scope.fiscal_scope === 'ORGANIZATION' || scope.store_id == null) {
      const row = await this.db.organization_settings.findUnique({
        where: { organization_id: scope.organization_id },
        select: { settings: true },
      });
      return (row?.settings as Record<string, any>) ?? null;
    }

    const row = await this.db.store_settings.findUnique({
      where: { store_id: scope.store_id },
      select: { settings: true },
    });
    return (row?.settings as Record<string, any>) ?? null;
  }

  private dianScopeWhere(scope: {
    organization_id: number;
    store_id: number | null;
  }) {
    // Mismo eje que los índices únicos parciales de dian_configurations:
    // (store_id, nit, configuration_type) cuando hay tienda, y
    // (organization_id, nit, configuration_type) cuando store_id IS NULL.
    return scope.store_id == null
      ? { organization_id: scope.organization_id, store_id: null }
      : { organization_id: scope.organization_id, store_id: scope.store_id };
  }

  private async readDianConfigs(scope: ResolvedTenantScope) {
    const rows = await this.db.dian_configurations.findMany({
      where: this.dianScopeWhere(scope),
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        is_default: true,
        nit: true,
        nit_dv: true,
        nit_type: true,
        configuration_type: true,
        operation_mode: true,
        environment: true,
        enablement_status: true,
        test_set_id: true,
        enabled_at: true,
        updated_at: true,
        software_id: true,
        software_pin_encrypted: true,
        certificate_s3_key: true,
        certificate_password_encrypted: true,
        certificate_expiry: true,
        certificate_subject: true,
        certificate_issuer: true,
        certificate_nit: true,
        certificate_uploaded_at: true,
      },
    });

    return rows.map((row: any) => this.maskConfig(row));
  }

  /**
   * El perfil describe los secretos, nunca los entrega: se devuelve si están
   * puestos y los metadatos del certificado, jamás el PIN, la contraseña ni la
   * clave S3.
   */
  private maskConfig(row: Record<string, any>) {
    const expiry: Date | null = row.certificate_expiry ?? null;
    const daysToExpiry = expiry
      ? Math.floor((expiry.getTime() - Date.now()) / 86_400_000)
      : null;

    return {
      id: row.id,
      name: row.name,
      is_default: row.is_default,
      nit: row.nit,
      nit_dv: row.nit_dv,
      nit_type: row.nit_type,
      configuration_type: row.configuration_type,
      operation_mode: row.operation_mode,
      environment: row.environment,
      enablement_status: row.enablement_status,
      test_set_id: row.test_set_id,
      enabled_at: row.enabled_at,
      updated_at: row.updated_at,
      software_id_set: Boolean(row.software_id),
      software_pin_set: Boolean(row.software_pin_encrypted),
      certificate: {
        present: Boolean(row.certificate_s3_key),
        password_set: Boolean(row.certificate_password_encrypted),
        expires_at: expiry,
        days_to_expiry: daysToExpiry,
        expired: daysToExpiry !== null && daysToExpiry < 0,
        subject: row.certificate_subject ?? null,
        issuer: row.certificate_issuer ?? null,
        nit: row.certificate_nit ?? null,
        uploaded_at: row.certificate_uploaded_at ?? null,
      },
    };
  }

  private async readResolutions(scope: ResolvedTenantScope) {
    const rows = await this.db.invoice_resolutions.findMany({
      where: this.dianScopeWhere(scope),
      orderBy: [{ is_active: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        document_type: true,
        prefix: true,
        resolution_number: true,
        resolution_date: true,
        range_from: true,
        range_to: true,
        current_number: true,
        valid_from: true,
        valid_to: true,
        is_active: true,
        technical_key: true,
      },
    });

    return rows.map((row: any) => {
      const from = Number(row.range_from ?? 0);
      const to = Number(row.range_to ?? 0);
      const current = Number(row.current_number ?? from);
      const span = to - from + 1;

      return {
        id: row.id,
        document_type: row.document_type,
        prefix: row.prefix,
        resolution_number: row.resolution_number,
        resolution_date: row.resolution_date,
        range_from: from,
        range_to: to,
        current_number: current,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
        is_active: row.is_active,
        // La clave técnica alimenta el CUFE: se reporta si está puesta, nunca
        // su valor.
        technical_key_set: Boolean(row.technical_key),
        consumed_pct:
          span > 0
            ? Math.min(100, Math.max(0, ((current - from) / span) * 100))
            : 0,
      };
    });
  }

  private async readSubscription(storeId: number) {
    const row = await this.db.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: {
        state: true,
        started_at: true,
        trial_ends_at: true,
        current_period_end: true,
        next_billing_at: true,
        grace_soft_until: true,
        grace_hard_until: true,
        effective_price: true,
        currency: true,
        auto_renew: true,
        lock_reason: true,
        plan: { select: { id: true, name: true, code: true } },
      },
    });

    return row ?? null;
  }

  private async summarizeEnablement(
    organizationId: number,
    storeId: number | null,
  ) {
    const [configs, driftCount] = await Promise.all([
      this.db.dian_configurations.findMany({
        where: {
          ...this.dianScopeWhere({
            organization_id: organizationId,
            store_id: storeId,
          }),
          configuration_type: 'invoicing',
        },
        orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
        take: 1,
        select: { enablement_status: true, environment: true },
      }),
      storeId === null
        ? this.db.dian_configurations.count({
            where: {
              organization_id: organizationId,
              store_id: { not: null },
            },
          })
        : Promise.resolve(0),
    ]);

    return {
      enablement_status: configs[0]?.enablement_status ?? 'not_started',
      environment: configs[0]?.environment ?? null,
      scope_drift: driftCount > 0 ? driftCount : null,
    };
  }

  private deriveFiscalScope(organization: {
    fiscal_scope?: string | null;
    operating_scope?: string | null;
    account_type?: string | null;
  }): 'STORE' | 'ORGANIZATION' {
    // Misma escalera de fallback que FiscalScopeService.getFiscalScope, para
    // que el directorio no discrepe del panel del propio comerciante en filas
    // heredadas donde la columna sigue en su valor por defecto.
    if (organization.fiscal_scope) {
      return organization.fiscal_scope as 'STORE' | 'ORGANIZATION';
    }
    if (organization.operating_scope) {
      return organization.operating_scope as 'STORE' | 'ORGANIZATION';
    }
    return organization.account_type === 'MULTI_STORE_ORG'
      ? 'ORGANIZATION'
      : 'STORE';
  }
}
