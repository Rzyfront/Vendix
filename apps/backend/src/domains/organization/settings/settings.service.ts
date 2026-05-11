import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { UpdateSettingsDto, UpdateOrgInventorySettingsDto } from './dto';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import {
  OrganizationSettings,
  OrganizationBranding,
  InventoryMode,
  OrganizationInventorySettings,
  OrganizationFiscalData,
} from './interfaces/organization-settings.interface';
import { getDefaultOrganizationInventorySettings } from './defaults/default-organization-settings';
import { getDefaultStoreSettings } from '../../store/settings/defaults/default-store-settings';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { AuditService, AuditResource } from '@common/audit/audit.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private prisma: OrganizationPrismaService,
    private auditService: AuditService,
    private s3Service: S3Service,
    private fiscalScope: FiscalScopeService,
  ) {}

  async findOne() {
    const settings = await this.prisma.organization_settings.findFirst();
    if (!settings) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }
    return {
      ...settings,
      settings: await this.signSettingsAssets(settings.settings),
    };
  }

  async update(updateDto: UpdateSettingsDto) {
    const existing = await this.prisma.organization_settings.findFirst();
    const settingsForStorage = this.sanitizeSettingsAssets(
      updateDto.settings ?? ((existing?.settings as Record<string, any>) || {}),
    );
    let result: any;

    if (existing) {
      result = await this.prisma.organization_settings.update({
        where: { id: existing.id },
        data: { settings: settingsForStorage, updated_at: new Date() },
      });
    } else {
      const context = RequestContextService.getContext();
      if (!context?.organization_id) {
        throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
      }

      result = await this.prisma.organization_settings.create({
        data: {
          settings: settingsForStorage,
          organization_id: context.organization_id,
        },
      });
    }

    return {
      ...result,
      settings: await this.signSettingsAssets(result.settings),
    };
  }

  /**
   * Update branding configuration
   * Source of truth: organization_settings.settings.branding
   */
  async updateBranding(brandingDto: Partial<OrganizationBranding>) {
    const existing = await this.prisma.organization_settings.findFirst();
    const currentSettings = (existing?.settings as OrganizationSettings) || {
      branding: {} as OrganizationBranding,
    };

    const updatedSettings: OrganizationSettings = {
      ...currentSettings,
      branding: {
        ...currentSettings.branding,
        ...brandingDto,
      },
    };

    return this.update({ settings: updatedSettings as any });
  }

  /**
   * Get branding configuration
   * Source of truth: organization_settings.settings.branding
   */
  async getBranding(): Promise<OrganizationBranding | null> {
    try {
      const settings = await this.findOne();
      const orgSettings = settings.settings as OrganizationSettings;
      return orgSettings?.branding || null;
    } catch {
      return null;
    }
  }

  private sanitizeSettingsAssets(
    settings: Record<string, any>,
  ): Record<string, any> {
    const sanitized = { ...settings };
    const branding = sanitized['branding'];

    if (branding && typeof branding === 'object') {
      sanitized['branding'] = {
        ...branding,
        ...(Object.prototype.hasOwnProperty.call(branding, 'logo_url') && {
          logo_url: this.sanitizeAssetUrl(branding['logo_url']),
        }),
        ...(Object.prototype.hasOwnProperty.call(branding, 'favicon_url') && {
          favicon_url: this.sanitizeAssetUrl(branding['favicon_url']),
        }),
      };
    }

    return sanitized;
  }

  private sanitizeAssetUrl(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return undefined;
    if (value.trim() === '') return '';
    return extractS3KeyFromUrl(value) ?? '';
  }

  private async signSettingsAssets(settings: unknown): Promise<unknown> {
    if (!settings || typeof settings !== 'object') return settings;

    const signed = { ...(settings as Record<string, any>) };
    const branding = signed['branding'];

    if (branding && typeof branding === 'object') {
      const signedBranding = { ...branding };
      const signedLogo = await this.s3Service.signUrl(
        signedBranding['logo_url'],
      );
      const signedFavicon = await this.s3Service.signUrl(
        signedBranding['favicon_url'],
      );

      if (signedLogo !== undefined) signedBranding['logo_url'] = signedLogo;
      if (signedFavicon !== undefined) {
        signedBranding['favicon_url'] = signedFavicon;
      }

      signed['branding'] = signedBranding;
    }

    return signed;
  }

  /**
   * Cambia el modo de inventario de la organización con validaciones pre-switch
   * estrictas.
   *
   * Reglas:
   * - Si `newMode === currentMode` retorna `{ changed: false }` (idempotente).
   * - Al pasar de `organizational -> independent`, bloquea el cambio si:
   *   1. Existen transferencias cross-store abiertas (status = `draft` o
   *      `in_transit`). Evita dejar transfers huérfanas imposibles de completar
   *      bajo el nuevo régimen de aislamiento.
   *   2. Existen `inventory_locations` org-wide (store_id = NULL) sin asignar
   *      a una store concreta. Bajo `independent`, las locations deben
   *      pertenecer a una store para respetar el aislamiento.
   *
   * El cambio en sentido `independent -> organizational` no requiere
   * validaciones: relaja el modelo, no lo restringe.
   *
   * NOTA — Audit log:
   *   No existe aún infra de audit log transversal (ver Fase 2). Este cambio
   *   de configuración crítica debería registrarse, pero se deja como gap y
   *   se emite un `logger.warn` con metadatos para trazabilidad mínima hasta
   *   que Fase 6 implemente `organization_settings_audit`.
   */
  async setInventoryMode(
    newMode: InventoryMode,
  ): Promise<{ mode: InventoryMode; changed: boolean }> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    const organization_id = context.organization_id;

    const existing = await this.prisma.organization_settings.findFirst();
    const currentSettings =
      (existing?.settings as OrganizationSettings | null) ?? null;
    const defaults = getDefaultOrganizationInventorySettings();
    const currentInventory: OrganizationInventorySettings =
      currentSettings?.inventory ?? defaults;
    const currentMode: InventoryMode = currentInventory.mode ?? defaults.mode;

    // Idempotente — no cambio, no validaciones.
    if (currentMode === newMode) {
      return { mode: newMode, changed: false };
    }

    // Validaciones pre-switch solo al restringir el modelo
    // (organizational -> independent).
    if (currentMode === 'organizational' && newMode === 'independent') {
      // Validación 1: transferencias cross-store abiertas.
      // `transfer_status_enum` (M3) = pending | approved | in_transit | received | cancelled,
      // con legacy `draft` (= alias pre-M3 de pending) y `completed` (= alias pre-M3 de received).
      // "abiertas" = no-terminales: pending | approved | in_transit | draft.
      // NOTA sobre scoping: OrganizationPrismaService inyecta automáticamente
      // `organization_id` en el WHERE, por lo que no se duplica aquí.
      const openTransfers = await this.prisma.stock_transfers.findMany({
        where: {
          status: { in: ['pending', 'approved', 'in_transit', 'draft'] },
        },
        select: {
          id: true,
          transfer_number: true,
          status: true,
          from_location: { select: { id: true, store_id: true } },
          to_location: { select: { id: true, store_id: true } },
        },
      });

      // Cross-store = from.store_id !== to.store_id (incluye el caso en que
      // alguno sea NULL = org-wide, considerado cross-store bajo independent).
      const crossStore = openTransfers.filter(
        (t) =>
          (t.from_location?.store_id ?? null) !==
          (t.to_location?.store_id ?? null),
      );

      if (crossStore.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.INV_MODE_CHANGE_BLOCKED_BY_TRANSFERS,
          `Cross-store transfers abiertas: ${crossStore.length}`,
          {
            transfers: crossStore.map((t) => ({
              id: t.id,
              transfer_number: t.transfer_number,
              status: t.status,
              from_location_id: t.from_location?.id,
              from_store_id: t.from_location?.store_id ?? null,
              to_location_id: t.to_location?.id,
              to_store_id: t.to_location?.store_id ?? null,
            })),
          },
        );
      }

      // Validación 2: bodegas org-wide (store_id=null) que quedarían huérfanas
      // al aplicar aislamiento por store.
      const orphanLocations = await this.prisma.inventory_locations.findMany({
        where: { store_id: null },
        select: { id: true, name: true, code: true },
      });

      if (orphanLocations.length > 0) {
        throw new VendixHttpException(
          ErrorCodes.INV_MODE_CHANGE_BLOCKED_BY_ORPHAN_LOCATIONS,
          `Bodegas org-wide sin asignar a store: ${orphanLocations.length}`,
          {
            orphan_count: orphanLocations.length,
            locations: orphanLocations,
          },
        );
      }
    }

    // Cambio permitido — merge in-place de la sección `inventory`, respetando
    // defaults y el resto de secciones existentes (branding, fonts, etc.).
    const nextSettings: OrganizationSettings = {
      ...(currentSettings as OrganizationSettings),
      inventory: {
        ...defaults,
        ...currentInventory,
        mode: newMode,
      },
    } as OrganizationSettings;

    if (existing) {
      await this.prisma.organization_settings.update({
        where: { id: existing.id },
        data: { settings: nextSettings as any, updated_at: new Date() },
      });
    } else {
      await this.prisma.organization_settings.create({
        data: {
          organization_id,
          settings: nextSettings as any,
        },
      });
    }

    await this.auditService.logUpdate(
      context.user_id!,
      AuditResource.SETTINGS,
      existing?.id ?? 0,
      { inventory_mode: currentMode },
      { inventory_mode: newMode },
      {
        action: 'set_inventory_mode',
        organization_id,
        from: currentMode,
        to: newMode,
      },
    );

    return { mode: newMode, changed: true };
  }

  // ---------------------------------------------------------------------------
  // Fiscal Data section (legal/tax identity)
  // ---------------------------------------------------------------------------

  async getFiscalData(store_id?: number): Promise<OrganizationFiscalData> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const target = await this.resolveFiscalDataTarget(
      context.organization_id,
      store_id,
    );

    if (target.scope === 'store') {
      const row = await this.prisma.withoutScope().store_settings.findUnique({
        where: { store_id: target.store_id },
        select: { settings: true },
      });
      return (((row?.settings as any)?.fiscal_data ?? {}) as OrganizationFiscalData);
    }

    const row = await this.prisma.organization_settings.findFirst();
    return (((row?.settings as any)?.fiscal_data ?? {}) as OrganizationFiscalData);
  }

  /**
   * Patch-style update for `settings.fiscal_data`. Deep-merges over the
   * existing section and preserves every other key (branding, fonts,
   * inventory, payroll, panel_ui, fiscal_status).
   *
   * Canonical endpoint: `PATCH /organization/settings/fiscal-data`.
   *
   * This sidesteps the generic `update()` flow which overwrites the whole
   * `settings` JSON — see Plan: fiscal_legal_data step persistence.
   */
  async updateFiscalData(
    dto: Record<string, unknown>,
    store_id?: number,
  ): Promise<OrganizationFiscalData> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const target = await this.resolveFiscalDataTarget(
      context.organization_id,
      store_id,
    );
    const cleanDto = { ...dto };
    delete (cleanDto as any).store_id;

    if (target.scope === 'store') {
      const existing = await this.prisma.withoutScope().store_settings.findUnique({
        where: { store_id: target.store_id },
        select: { id: true, settings: true },
      });
      const currentSettings =
        (existing?.settings as Record<string, any> | null) ?? {};
      const previousFiscalData =
        (currentSettings.fiscal_data ?? {}) as OrganizationFiscalData;
      const nextFiscalData = {
        ...previousFiscalData,
        ...cleanDto,
      } as OrganizationFiscalData;
      const nextSettings = {
        ...getDefaultStoreSettings(),
        ...currentSettings,
        fiscal_data: nextFiscalData,
      };

      await this.prisma.withoutScope().store_settings.upsert({
        where: { store_id: target.store_id },
        create: {
          store_id: target.store_id,
          settings: nextSettings as any,
        },
        update: {
          settings: nextSettings as any,
          updated_at: new Date(),
        },
      });

      if (context.user_id) {
        try {
          await this.auditService.logUpdate(
            context.user_id,
            AuditResource.SETTINGS,
            existing?.id ?? 0,
            { fiscal_data: previousFiscalData },
            { fiscal_data: nextFiscalData },
            {
              action: 'update_fiscal_data',
              organization_id: context.organization_id,
              store_id: target.store_id,
            },
          );
        } catch (err) {
          this.logger.warn(
            `Audit log for store fiscal_data update failed: ${(err as Error).message}`,
          );
        }
      }

      return nextFiscalData;
    }

    const existing = await this.prisma.organization_settings.findFirst();
    const currentSettings =
      (existing?.settings as OrganizationSettings | null) ?? null;
    const previousFiscalData: OrganizationFiscalData =
      currentSettings?.fiscal_data ?? {};

    const nextFiscalData: OrganizationFiscalData = {
      ...previousFiscalData,
      ...cleanDto,
    } as OrganizationFiscalData;

    const nextSettings: OrganizationSettings = {
      ...((currentSettings as OrganizationSettings | null) ??
        ({} as OrganizationSettings)),
      fiscal_data: nextFiscalData,
    } as OrganizationSettings;

    if (existing) {
      await this.prisma.organization_settings.update({
        where: { id: existing.id },
        data: { settings: nextSettings as any, updated_at: new Date() },
      });
    } else {
      await this.prisma.organization_settings.create({
        data: {
          organization_id: context.organization_id,
          settings: nextSettings as any,
        },
      });
    }

    if (context.user_id) {
      try {
        await this.auditService.logUpdate(
          context.user_id,
          AuditResource.SETTINGS,
          existing?.id ?? 0,
          { fiscal_data: previousFiscalData },
          { fiscal_data: nextFiscalData },
          {
            action: 'update_fiscal_data',
            organization_id: context.organization_id,
          },
        );
      } catch (err) {
        this.logger.warn(
          `Audit log for fiscal_data update failed: ${(err as Error).message}`,
        );
      }
    }

    return nextFiscalData;
  }

  private async resolveFiscalDataTarget(
    organization_id: number,
    store_id?: number,
  ): Promise<
    | { scope: 'organization' }
    | { scope: 'store'; store_id: number }
  > {
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    if (fiscalScope === 'ORGANIZATION') {
      return { scope: 'organization' };
    }

    if (store_id) {
      const store = await this.prisma.withoutScope().stores.findFirst({
        where: { id: store_id, organization_id, is_active: true },
        select: { id: true },
      });
      if (!store) {
        throw new BadRequestException(
          'Store does not belong to the current organization',
        );
      }
      return { scope: 'store', store_id: store.id };
    }

    const stores = await this.prisma.withoutScope().stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
      take: 2,
    });
    if (stores.length === 1) {
      return { scope: 'store', store_id: stores[0].id };
    }

    throw new BadRequestException(
      'store_id is required when fiscal_scope is STORE',
    );
  }

  // ---------------------------------------------------------------------------
  // Inventory section helpers (Plan Unificado P3.2 — costing_method)
  // ---------------------------------------------------------------------------

  /**
   * Devuelve la sección `inventory` mergeada con defaults para la organización
   * vigente del request. Idempotente — no persiste nada si no existe la fila.
   *
   * Comportamiento:
   * - Si no existe `organization_settings` → retorna defaults sin
   *   `costing_method` (undefined → resolver cae al store/default).
   * - Si existe pero `inventory` no está poblado → retorna defaults.
   * - Si existe `inventory` → mergea sobre defaults para garantizar que los
   *   campos requeridos (`mode`, `low_stock_alerts_scope`, etc.) siempre estén
   *   definidos al lector.
   */
  async getInventory(): Promise<OrganizationInventorySettings> {
    const existing = await this.prisma.organization_settings.findFirst();
    const settings = existing?.settings as OrganizationSettings | null;
    const defaults = getDefaultOrganizationInventorySettings();
    return {
      ...defaults,
      ...(settings?.inventory ?? {}),
    };
  }

  /**
   * Actualiza únicamente la sub-sección `inventory.costing_method` preservando
   * el resto (`mode`, `low_stock_alerts_scope`, `fallback_on_stockout`).
   *
   * Restricciones de validación adicionales a las del DTO:
   * - `lifo` → rechazado por DTO (`@IsEnum`).
   * - `cpp` → rechazado por DTO (no es valor válido a nivel ORG).
   *
   * NOTA: el merge se hace in-place sobre `organization_settings.settings`
   * para no pisar otras secciones (branding, fonts, panel_ui, payroll).
   */
  async updateInventory(
    dto: UpdateOrgInventorySettingsDto,
  ): Promise<OrganizationInventorySettings> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const existing = await this.prisma.organization_settings.findFirst();
    const currentSettings =
      (existing?.settings as OrganizationSettings | null) ?? null;
    const defaults = getDefaultOrganizationInventorySettings();
    const currentInventory: OrganizationInventorySettings = {
      ...defaults,
      ...(currentSettings?.inventory ?? {}),
    };

    const nextInventory: OrganizationInventorySettings = {
      ...currentInventory,
      ...(dto.costing_method !== undefined
        ? { costing_method: dto.costing_method }
        : {}),
    };

    const nextSettings: OrganizationSettings = {
      ...((currentSettings as OrganizationSettings | null) ??
        ({} as OrganizationSettings)),
      inventory: nextInventory,
    } as OrganizationSettings;

    if (existing) {
      await this.prisma.organization_settings.update({
        where: { id: existing.id },
        data: { settings: nextSettings as any, updated_at: new Date() },
      });
    } else {
      await this.prisma.organization_settings.create({
        data: {
          organization_id: context.organization_id,
          settings: nextSettings as any,
        },
      });
    }

    if (dto.costing_method !== undefined && context.user_id) {
      try {
        await this.auditService.logUpdate(
          context.user_id,
          AuditResource.SETTINGS,
          existing?.id ?? 0,
          { costing_method: currentInventory.costing_method ?? null },
          { costing_method: dto.costing_method },
          {
            action: 'update_inventory_costing_method',
            organization_id: context.organization_id,
            from: currentInventory.costing_method ?? null,
            to: dto.costing_method,
          },
        );
      } catch (err) {
        this.logger.warn(
          `Audit log for inventory costing_method update failed: ${(err as Error).message}`,
        );
      }
    }

    return nextInventory;
  }
}
