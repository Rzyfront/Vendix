/**
 * PlatformProfilesService — fachade org-scoped para perfiles de facturación
 * del riel VENDIX_ADMIN (NIT propio de la plataforma).
 *
 * ## Por qué servicio PARALELO y no delegación directa a ProfilesService
 *
 * El `ProfilesService` de tienda exige `ProfileScope.store_id` en su gate
 * (línea 71-79 del original — `STORE_CONTEXT_001` si falta). La plataforma no
 * tiene tienda: emite con `platform_organization_id` y `accounting_entity_id`
 * resueltos desde `platform_settings`. Sintetizar un `store_id` falso para
 * colar la fachada por el gate del servicio tienda corrompería scoping de
 * Prisma y devolvería cero filas. ADR-1 del plan CP-platform-invoicing-parity
 * dice "fachada" en espíritu (un solo motor de reglas fiscales probadas), no
 * en literal (un solo servicio): este servicio REUTILIZA todo lo reutilizable
 * (validador de config, plantillas, normalización de nombre, auditoría,
 * calculator, DTOs) y SUSTITUYE sólo lo que el ámbito cambia (queries,
 * transacciones, caché de catálogo).
 *
 * ## ADR-2 + ADR-4: ámbito organization
 *
 * Toda query lleva `organization_id` como filtro explícito. Se resuelve desde
 * `platform_settings.platform_organization_id` y se cachea por request
 * (ver `resolvePlatformOrgId`). Nunca fallback silencioso: ausencia ⇒
 * `PLATFORM_FISCAL_SCOPE_MISSING` (500 con código), nunca el
 * `PLATFORM_ORGANIZATION_ID_FALLBACK = 1` del resto del módulo.
 *
 * ## Caché de catálogo (ADR-H5 del plan)
 *
 * Clave por `organization_id` (no por `store_id`). Único punto de
 * invalidación: `runScopedTransaction`, después del commit. Si una octava
 * escritura se salta esta envoltura, sirve perfil retirado durante todo el
 * TTL — la misma trampa que el plan hermano documentó para el riel tienda.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';

import { AuditService } from '@common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { profileNotFound } from '../../../store/invoicing/profiles/profile-errors';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

import { ProfileCatalogCacheService } from '../../../store/invoicing/profiles/profile-catalog-cache.service';
import { ProfileAccountingValidator } from '../../../store/invoicing/profiles/profile-accounting.validator';
import { CloneInvoiceProfileDto } from '../../../store/invoicing/profiles/dto/clone-invoice-profile.dto';
import { CreateInvoiceProfileDto } from '../../../store/invoicing/profiles/dto/create-invoice-profile.dto';
import { normalizeName } from '../../../store/invoicing/profiles/dto/invoice-profile-name';
import { QueryInvoiceProfilesDto } from '../../../store/invoicing/profiles/dto/query-invoice-profiles.dto';
import { UpdateInvoiceProfileDto } from '../../../store/invoicing/profiles/dto/update-invoice-profile.dto';
import { InvoiceProfileConfig } from '../../../store/invoicing/profiles/invoice-profile-config.contract';
import { normalizeAndAssertProfileConfig } from '../../../store/invoicing/profiles/invoice-profile-config.validator';

/**
 * Ámbito del riel plataforma, resuelto una vez por operación.
 *
 * DIFERENCIA con `ProfileScope` de tienda: `store_id` es opcional
 * (`number | null`). Los queries usan sólo `organization_id`; `store_id` no
 * entra en NINGÚN predicado porque los perfiles plataforma viven con
 * `store_id IS NULL` por invariante del esquema (migración 20260826120000).
 */
interface PlatformProfileScope {
  organization_id: number;
  user_id?: number;
}

/** Las siete acciones auditadas — mismas cadenas que el riel tienda. */
type ProfileAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CLONE'
  | 'SET_DEFAULT'
  | 'ACTIVATE'
  | 'DEACTIVATE';

const PROFILE_AUDIT_RESOURCE = 'invoice_profiles';

const AUDITED_COLUMNS = [
  'name',
  'operation_type',
  'state',
  'is_default',
  'current_version',
  'cloned_from_profile_id',
  'cloned_from_version',
] as const;

/** Mismo `PROFILE_SELECT` que tienda: el consumidor frontend espera el mismo shape. */
const PROFILE_SELECT = {
  id: true,
  organization_id: true,
  store_id: true,
  name: true,
  operation_type: true,
  state: true,
  is_default: true,
  current_version: true,
  cloned_from_profile_id: true,
  cloned_from_version: true,
  created_by: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class PlatformProfilesService {
  private readonly logger = new Logger(PlatformProfilesService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly catalog_cache: ProfileCatalogCacheService,
    private readonly audit: AuditService,
    private readonly accounts: ProfileAccountingValidator,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  // ─── Contexto ───────────────────────────────────────────────────────────

  /**
   * Resuelve `organization_id` desde `platform_settings.platform_organization_id`
   * vía `PlatformOrgService.requirePlatformContext()`. Ausencia ⇒
   * `PLATFORM_FISCAL_SCOPE_MISSING` 500-guard (ADR-4). Nunca el fallback
   * `= 1` del resto del módulo: la plataforma sin settings debe gritar, no
   * emitir contra una organización equivocada.
   */
  private async resolvePlatformOrgId(): Promise<number> {
    const ctx = await this.platformOrg.requirePlatformContext();
    return ctx.organization_id;
  }

  private async getScope(): Promise<PlatformProfileScope> {
    return { organization_id: await this.resolvePlatformOrgId() };
  }

  // ─── Transacciones (envoltura + invalidación de caché) ──────────────────

  /**
   * Envolvente ÚNICA para escrituras: cualquier mutación pasa por acá. Tras
   * el commit, invalida el caché del catálogo — después y no antes, para no
   * dejar ventana en la que un lector repuebla con estado viejo. Mismo
   * razonamiento que el `runScopedTransaction` de tienda, aplicado a la
   * clave por organización que requiere este riel.
   */
  private async runScopedTransaction<T>(
    work: (tx: any, scope: PlatformProfileScope) => Promise<T>,
  ): Promise<T> {
    const scope = await this.getScope();
    const result = (await this.prisma
      .withoutScope()
      .$transaction((tx: any) => work(tx, scope))) as T;
    await this.catalog_cache.invalidateOrg(scope.organization_id);
    return result;
  }

  /** Detecta violación de unicidad traducida por el validador. */
  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { code?: string };
    return e.code === 'P2002';
  }

  /**
   * Traduce una violación de unicidad en el mensaje correcto del catálogo de
   * errores (`INVOICING_PROFILE_002`, `_003`, `_005` según campo). Réplica
   * de la lógica de tienda; la forma de respuesta la define el código, no
   * este servicio.
   */
  private async uniqueConflict(
    target: { name: string; operation_type: string },
    profile_id: number | null,
  ): Promise<VendixHttpException> {
    const org = await this.resolvePlatformOrgId();
    if (target.name === 'is_default') {
      return new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_002,
        `Ya existe un perfil predeterminado para (organization_id=${org}, operation_type=${target.operation_type}).`,
        { organization_id: org, operation_type: target.operation_type },
      );
    }
    if (target.name === 'name') {
      return new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_005,
        `Ya existe un perfil con el mismo nombre en esta organización.`,
        { operation_type: target.operation_type },
      );
    }
    return new VendixHttpException(
      ErrorCodes.INVOICING_PROFILE_005,
      `Conflicto de unicidad en perfil plataforma (campo ${target.name}).`,
      { field: target.name, operation_type: target.operation_type },
    );
  }

  // ─── Lectura ────────────────────────────────────────────────────────────

  async findAll(query: QueryInvoiceProfilesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const org_id = await this.resolvePlatformOrgId();

    const where: Record<string, unknown> = {
      organization_id: org_id,
      store_id: null,
    };
    if (query.operation_type) where.operation_type = query.operation_type;
    if (query.state) where.state = query.state;
    if (query.search?.trim()) {
      where.name = { contains: query.search.trim(), mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.withoutScope().invoice_profiles.findMany({
        where,
        select: PROFILE_SELECT,
        orderBy: [{ is_default: 'desc' }, { updated_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.withoutScope().invoice_profiles.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: number) {
    const org_id = await this.resolvePlatformOrgId();
    const profile = await this.prisma.withoutScope().invoice_profiles.findFirst({
      where: { id, organization_id: org_id, store_id: null },
      select: PROFILE_SELECT,
    });
    if (!profile) throw profileNotFound(id);

    const version = await this.prisma.withoutScope().invoice_profile_versions.findFirst({
      where: { profile_id: id, version: profile.current_version },
      select: { id: true, version: true, config: true, created_at: true, created_by: true },
    });

    if (!version && profile.current_version > 0) {
      this.logger.error(
        `invoice_profiles.id=${id} apunta a la versión ${profile.current_version}, que no existe`,
      );
    }

    return { ...profile, current_config: version?.config ?? null, version };
  }

  // ─── Catálogo (Redis-cached, read-only para el wizard) ──────────────────

  /**
   * Catálogo de perfiles ACTIVOS para el selector del wizard plataforma.
   * El caché lo sirve `ProfileCatalogCacheService.invalidateOrg(org_id)`
   * (mismo componente de tienda, método paralelo que añade abajo).
   */
  async catalog() {
    const org_id = await this.resolvePlatformOrgId();
    const cached = await this.catalog_cache.readOrg(org_id);
    if (cached) return cached;

    const rows = await this.prisma.withoutScope().invoice_profiles.findMany({
      where: {
        organization_id: org_id,
        store_id: null,
        state: 'active',
      },
      select: {
        id: true,
        name: true,
        operation_type: true,
        is_default: true,
        current_version: true,
      },
      orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
    });

    await this.catalog_cache.writeOrg(org_id, rows);
    return rows;
  }

  // ─── Escritura (CREATE/UPDATE/DELETE/CLONE/SET_DEFAULT/ACTIVATE/DEACTIVATE) ─

  async create(dto: CreateInvoiceProfileDto) {
    const scope = await this.getScope();
    return this.runScopedTransaction(async (tx, s) => {
      const config = normalizeAndAssertProfileConfig(dto.config, {
        operation_type: dto.operation_type,
      });

      const profile = await tx.invoice_profiles
        .create({
          data: {
            organization_id: s.organization_id,
            store_id: null,
            name: normalizeName(dto.name),
            operation_type: dto.operation_type,
            state: 'active',
            is_default: dto.is_default ?? false,
            current_version: 1,
            created_by: s.user_id ?? null,
          },
          select: PROFILE_SELECT,
        })
        .catch(async (err: unknown) => {
          if (this.isUniqueViolation(err)) {
            throw await this.uniqueConflict(
              { name: 'name', operation_type: dto.operation_type },
              null,
            );
          }
          throw err;
        });

      await tx.invoice_profile_versions.create({
        data: {
          profile_id: profile.id,
          version: 1,
          config: config as any,
          created_by: s.user_id ?? null,
        },
      });

      await this.writeAudit(tx, 'CREATE', profile.id, null, profile, s.user_id);
      return { ...profile, current_config: config, version: 1 };
    });
  }

  async update(id: number, dto: UpdateInvoiceProfileDto) {
    const scope = await this.getScope();
    return this.runScopedTransaction(async (tx, s) => {
      const existing = await tx.invoice_profiles.findFirst({
        where: { id, organization_id: s.organization_id, store_id: null },
        select: PROFILE_SELECT,
      });
      if (!existing) throw profileNotFound(id);

      let config: InvoiceProfileConfig | null = null;
      if (dto.config) {
        config = normalizeAndAssertProfileConfig(dto.config, {
          operation_type: existing.operation_type,
          profile_id: id,
        });
      }

      const next_version = existing.current_version + 1;
      const updated = await tx.invoice_profiles.update({
        where: { id },
        data: {
          name: dto.name ? normalizeName(dto.name) : undefined,
          current_version: next_version,
          updated_at: new Date(),
        },
        select: PROFILE_SELECT,
      });

      if (config) {
        await tx.invoice_profile_versions.create({
          data: {
            profile_id: id,
            version: next_version,
            config: config as any,
            created_by: s.user_id ?? null,
          },
        });
      }

      await this.writeAudit(tx, 'UPDATE', id, existing, updated, s.user_id);
      return {
        ...updated,
        current_config: config ?? null,
        version: next_version,
      };
    });
  }

  async clone(id: number, dto: CloneInvoiceProfileDto) {
    const scope = await this.getScope();
    return this.runScopedTransaction(async (tx, s) => {
      const source = await tx.invoice_profiles.findFirst({
        where: { id, organization_id: s.organization_id, store_id: null },
        select: PROFILE_SELECT,
      });
      if (!source) throw profileNotFound(id);

      const source_version = dto.source_version ?? source.current_version;
      const version_row = await tx.invoice_profile_versions.findFirst({
        where: { profile_id: id, version: source_version },
        select: { config: true },
      });
      if (!version_row) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_PROFILE_005,
          `La versión ${source_version} del perfil ${id} no existe.`,
          { profile_id: id, version: source_version },
        );
      }

      const config = normalizeAndAssertProfileConfig(
        version_row.config as unknown as InvoiceProfileConfig,
        {
          operation_type: source.operation_type,
        },
      );

      const cloned = await tx.invoice_profiles
        .create({
          data: {
            organization_id: s.organization_id,
            store_id: null,
            name: normalizeName(dto.name),
            operation_type: source.operation_type,
            state: 'inactive',
            is_default: false,
            current_version: 1,
            cloned_from_profile_id: id,
            cloned_from_version: source_version,
            created_by: s.user_id ?? null,
          },
          select: PROFILE_SELECT,
        })
        .catch(async (err: unknown) => {
          if (this.isUniqueViolation(err)) {
            throw await this.uniqueConflict(
              { name: 'name', operation_type: source.operation_type },
              null,
            );
          }
          throw err;
        });

      await tx.invoice_profile_versions.create({
        data: {
          profile_id: cloned.id,
          version: 1,
          config: config as any,
          created_by: s.user_id ?? null,
        },
      });

      await this.writeAudit(
        tx,
        'CLONE',
        cloned.id,
        null,
        cloned,
        s.user_id,
        { source_profile_id: id, source_version },
      );
      return { ...cloned, current_config: config, version: 1 };
    });
  }

  async setDefault(id: number) {
    return this.runScopedTransaction(async (tx, s) => {
      const profile = await tx.invoice_profiles.findFirst({
        where: { id, organization_id: s.organization_id, store_id: null },
        select: PROFILE_SELECT,
      });
      if (!profile) throw profileNotFound(id);

      if (profile.is_default) return profile;

      await tx.invoice_profiles.updateMany({
        where: {
          organization_id: s.organization_id,
          store_id: null,
          operation_type: profile.operation_type,
          is_default: true,
          NOT: { id },
        },
        data: { is_default: false },
      });

      const updated = await tx.invoice_profiles.update({
        where: { id },
        data: { is_default: true, updated_at: new Date() },
        select: PROFILE_SELECT,
      });

      await this.writeAudit(tx, 'SET_DEFAULT', id, profile, updated, s.user_id);
      return updated;
    });
  }

  async activate(id: number) {
    return this.runScopedTransaction(async (tx, s) => {
      const profile = await tx.invoice_profiles.findFirst({
        where: { id, organization_id: s.organization_id, store_id: null },
        select: PROFILE_SELECT,
      });
      if (!profile) throw profileNotFound(id);

      if (profile.state === 'active') return profile;
      const updated = await tx.invoice_profiles.update({
        where: { id },
        data: { state: 'active', updated_at: new Date() },
        select: PROFILE_SELECT,
      });
      await this.writeAudit(tx, 'ACTIVATE', id, profile, updated, s.user_id);
      return updated;
    });
  }

  async deactivate(id: number) {
    return this.runScopedTransaction(async (tx, s) => {
      const profile = await tx.invoice_profiles.findFirst({
        where: { id, organization_id: s.organization_id, store_id: null },
        select: PROFILE_SELECT,
      });
      if (!profile) throw profileNotFound(id);

      if (profile.state === 'inactive') return profile;
      const updated = await tx.invoice_profiles.update({
        where: { id },
        data: { state: 'inactive', is_default: false, updated_at: new Date() },
        select: PROFILE_SELECT,
      });
      await this.writeAudit(tx, 'DEACTIVATE', id, profile, updated, s.user_id);
      return updated;
    });
  }

  async remove(id: number) {
    return this.runScopedTransaction(async (tx, s) => {
      const profile = await tx.invoice_profiles.findFirst({
        where: { id, organization_id: s.organization_id, store_id: null },
        select: PROFILE_SELECT,
      });
      if (!profile) throw profileNotFound(id);

      const referenced = await tx.invoice_profile_versions.count({
        where: { profile_id: id },
      });
      if (referenced > 0 && profile.current_version > 0) {
        throw new VendixHttpException(
          ErrorCodes.INVOICING_PROFILE_003,
          'El perfil tiene versiones comprometidas y no puede borrarse. Desactívalo como alternativa.',
          { profile_id: id, versions: referenced },
        );
      }
      await tx.invoice_profiles.delete({ where: { id } });
      await this.writeAudit(tx, 'DELETE', id, profile, null, s.user_id);
      return { id, deleted: true };
    });
  }

  // ─── Auditoría ──────────────────────────────────────────────────────────

  private async writeAudit(
    tx: any,
    action: ProfileAuditAction,
    resource_id: number,
    old_values: Record<string, unknown> | null,
    new_values: Record<string, unknown> | null,
    user_id: number | undefined,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const audit_old: Record<string, unknown> = {};
    const audit_new: Record<string, unknown> = {};
    for (const col of AUDITED_COLUMNS) {
      if (old_values && (old_values as any)[col] !== undefined) {
        audit_old[col] = (old_values as any)[col];
      }
      if (new_values && (new_values as any)[col] !== undefined) {
        audit_new[col] = (new_values as any)[col];
      }
    }
    const scope = await this.getScope();
    await this.audit.log({
      action,
      resource: PROFILE_AUDIT_RESOURCE,
      resourceId: resource_id,
      oldValues: audit_old,
      newValues: audit_new,
      userId: user_id,
      organizationId: scope.organization_id,
      storeId: undefined,
      metadata: extra ?? undefined,
    });
  }
}
