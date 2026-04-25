import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { UpdateSettingsDto } from './dto';
import { RequestContextService } from '@common/context/request-context.service';
import {
  OrganizationSettings,
  OrganizationBranding,
  InventoryMode,
  OrganizationInventorySettings,
} from './interfaces/organization-settings.interface';
import { getDefaultOrganizationInventorySettings } from './defaults/default-organization-settings';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { AuditService, AuditResource } from '@common/audit/audit.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private prisma: OrganizationPrismaService,
    private auditService: AuditService,
  ) {}

  async findOne() {
    const settings = await this.prisma.organization_settings.findFirst();
    if (!settings) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }
    return settings;
  }

  async update(updateDto: UpdateSettingsDto) {
    const existing = await this.prisma.organization_settings.findFirst();
    if (existing) {
      return this.prisma.organization_settings.update({
        where: { id: existing.id },
        data: { settings: updateDto.settings, updated_at: new Date() },
      });
    } else {
      const context = RequestContextService.getContext();
      if (!context?.organization_id) {
        throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
      }

      return this.prisma.organization_settings.create({
        data: {
          settings: updateDto.settings,
          organization_id: context.organization_id,
        },
      });
    }
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
      // `transfer_status_enum` = draft | in_transit | completed | cancelled.
      // "abiertas" = draft | in_transit (no terminales).
      // NOTA sobre scoping: OrganizationPrismaService inyecta automáticamente
      // `organization_id` en el WHERE, por lo que no se duplica aquí.
      const openTransfers = await this.prisma.stock_transfers.findMany({
        where: { status: { in: ['draft', 'in_transit'] } },
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
      { action: 'set_inventory_mode', organization_id, from: currentMode, to: newMode },
    );

    return { mode: newMode, changed: true };
  }
}
