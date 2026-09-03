import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PrintGatewayService } from './print-gateway.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
// [print-editor-dsk P7] — Adapter registry: 11 FormatAdapter records keyed by
// `format_type`. Used here to enforce that `sections` referenced by an
// override or a library template live inside the adapter's
// `availableRegions` allowlist. Keeps AJV (structural) and the adapter
// (per-format capability) as separate concerns.
import { FormatAdapterRegistryService } from './format-adapter-registry.service';
import { sectionTypeToRegionKind } from '../lib/format-adapter';
import {
  UpdatePrintFormatConfigDto,
} from '../dto/print-format-config.dto';
import {
  CreatePrintTemplateDto,
  UpdatePrintTemplateDto,
} from '../dto/print-template.dto';
// [print-editor-dsk P1.1] — AJV runtime validation against definition-v2.schema.json.
// Runs UNCONDITIONALLY now (see `shouldValidateV2Payload` below for why the
// old gate was removed from the call sites) — every non-empty payload is
// normalized with `normalizeDefinition()` first, then validated here.
import { validatePrintFormatDefinition } from '../schemas/ajv-instance';
// [print-editor-dsk] — Reescribe los 8 alias camelCase legados
// (`heightMm`, `marginTopMm`, ..., `customLabel`, `companyBlock`) a su
// forma snake_case canónica ANTES de validar, y estampa `v: 2` cuando falta.
// Ver doc del módulo para la razón de cada alias y del estampado.
import { normalizeDefinition } from '../schemas/definition-normalizer';

/**
 * @deprecated [print-editor-dsk] — La validación pasó a ser INCONDICIONAL:
 * `updateStoreFormat()` y `createLibraryTemplate()` ya no consultan esta
 * compuerta antes de llamar a `validatePrintFormatDefinition()`. Existía
 * porque ningún escritor del repositorio emitía `v: 2` nunca — así que AJV
 * jamás corría y `additionalProperties: false` nunca disparaba; un campo
 * con el nombre equivocado (p. ej. un alias camelCase legado) se guardaba
 * tal cual y el compositor, que solo lee las claves snake_case, lo omitía
 * en silencio. Respuesta 200 con el dato perdido, no un error visible.
 *
 * Ahora el flujo es siempre `normalizeDefinition()` → `validatePrintFormatDefinition()`
 * → persistir lo normalizado, salvo cuando `overrides`/`definition` es
 * `null` o `{}` (no-op legítimo de "limpiar personalización" en el override
 * de tienda). No se borra esta función sin permiso explícito del usuario —
 * queda sin consumidores.
 */
function shouldValidateV2Payload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const v = (payload as Record<string, unknown>).v;
  return v === 2;
}

/**
 * [print-editor-dsk] — Un `overrides`/`definition` `null` o `{}` (objeto sin
 * llaves) es el no-op legítimo de "limpiar personalización" / "sin cambios
 * estructurales" — NO debe pasar por `normalizeDefinition()` ni por
 * `validatePrintFormatDefinition()`, porque un objeto vacío nunca podría
 * satisfacer `required: ["v", "paper"]` del schema v2. `undefined` (el
 * campo ni siquiera se envió) se trata igual por el llamador: no entra a
 * esta función porque las ramas de `updateStoreFormat()` ya distinguen
 * "campo ausente" de "campo presente" antes de decidir si normalizar.
 */
function isEmptyDefinitionPayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) return true;
  if (typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Object.keys(payload as Record<string, unknown>).length === 0;
}

/**
 * [print-editor-dsk P7] — Validate that every `section.type` referenced by
 * a v2 payload lives inside the adapter's `availableRegions` allowlist.
 *
 * Called AFTER the AJV shape check (so `sections` is already a valid array)
 * and BEFORE persisting overrides or templates. A section that names a
 * region the format doesn't expose (e.g. `qr_block` on `pos_sale_ticket`,
 * `fiscal_block` on `dispatch_note`) is rejected with
 * `PRINT_CONFIG_VALIDATION_001` — same HTTP shape as a failed AJV
 * validation, so the editor surfaces a single coherent error channel.
 *
 * `sectionType` values that don't map to any known `RegionKind` (forward
 * compatibility with future compositor types) are NOT rejected — the
 * adapter table is a superset of what the canvas exposes, not the wire
 * format. We deliberately err on the side of allowing unknown types: a
 * newer compositor may add a section kind the adapter hasn't been taught
 * about yet, and persisting it should not block.
 */
function assertSectionsWithinAdapterRegions(
  formatType: print_format_type_enum,
  payload: Record<string, any> | null | undefined,
  adapters: FormatAdapterRegistryService,
  context: 'store override' | 'library template',
): void {
  if (!payload || !Array.isArray(payload.sections)) return;
  const allowed = new Set(adapters.availableRegions(formatType as string));

  const offending: Array<{ sectionId: string; type: string }> = [];
  for (const section of payload.sections as Array<Record<string, any>>) {
    if (!section || typeof section !== 'object') continue;
    const sectionId =
      typeof section.id === 'string' ? section.id : '(missing-id)';
    const sectionType =
      typeof section.type === 'string' ? section.type : '';
    const regionKind = sectionTypeToRegionKind(sectionType);
    // Unknown section.type — leave it alone; see function header comment.
    if (regionKind === null) continue;
    if (!allowed.has(regionKind)) {
      offending.push({ sectionId, type: sectionType });
    }
  }

  if (offending.length > 0) {
    throw new VendixHttpException(
      ErrorCodes.PRINT_CONFIG_VALIDATION_001,
      `v2 ${context} for "${formatType as string}" references sections outside the adapter's availableRegions`,
      { offending, allowedRegions: [...allowed] },
    );
  }
}

export const ALL_FORMAT_TYPES: print_format_type_enum[] = [
  'pos_sale_ticket',
  'pos_electronic_invoice',
  'sales_order_invoice',
  'dispatch_note',
  'quotation',
  'credit_note',
  'purchase_order',
  'transfer_note',
  'fiscal_electronic_invoice',
  'fiscal_credit_note',
  'kitchen_ticket',
  'dispatch_ticket',
  'dispatch_route',
  'withholding_practiced',
  'withholding_suffered',
  'withholding_employee_certificate',
];

export const FORMAT_TYPE_METADATA: Record<
  print_format_type_enum,
  { name: string; category: string; icon: string; engine: 'html' | 'pdf' }
> = {
  pos_sale_ticket: { name: 'Ticket de Venta POS', category: 'Ventas POS', icon: 'receipt', engine: 'html' },
  pos_electronic_invoice: { name: 'Factura Electrónica POS (80mm)', category: 'Ventas POS', icon: 'receipt-text', engine: 'html' },
  sales_order_invoice: { name: 'Factura de Venta / Orden', category: 'Ventas', icon: 'file-text', engine: 'html' },
  dispatch_note: { name: 'Remisión / Despacho', category: 'Logística', icon: 'truck', engine: 'html' },
  quotation: { name: 'Cotización Comercial', category: 'Comercial', icon: 'file-spreadsheet', engine: 'html' },
  credit_note: { name: 'Nota Crédito Comercial', category: 'Ventas', icon: 'corner-down-left', engine: 'html' },
  purchase_order: { name: 'Orden de Compra', category: 'Compras', icon: 'shopping-cart', engine: 'html' },
  transfer_note: { name: 'Traslado entre Tiendas', category: 'Inventario', icon: 'arrow-left-right', engine: 'html' },
  fiscal_electronic_invoice: { name: 'Factura Electrónica (DIAN)', category: 'Facturación', icon: 'shield-check', engine: 'html' },
  fiscal_credit_note: { name: 'Nota Crédito Electrónica', category: 'Facturación', icon: 'file-minus', engine: 'html' },
  kitchen_ticket: { name: 'Ticket de Cocina (KDS)', category: 'Restaurante', icon: 'utensils', engine: 'html' },
  dispatch_ticket: { name: 'Tiquete de Despacho', category: 'Logística', icon: 'package', engine: 'html' },
  dispatch_route: { name: 'Planilla de Ruta (DSD)', category: 'Logística', icon: 'route', engine: 'html' },
  withholding_practiced: { name: 'Certificado Retención Practicada', category: 'Tributario', icon: 'file-minus', engine: 'html' },
  withholding_suffered: { name: 'Certificado Retención Sufrida', category: 'Tributario', icon: 'file-plus', engine: 'html' },
  withholding_employee_certificate: { name: 'Certificado Laboral Empleado', category: 'Tributario', icon: 'file-badge', engine: 'html' },
};

@Injectable()
export class PrintFormatsService {
  private readonly logger = new Logger(PrintFormatsService.name);

  constructor(
    private readonly storePrisma: StorePrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly gateway: PrintGatewayService,
    private readonly fiscalValidator: PrintFiscalValidatorService,
    private readonly registry: DocumentDataProviderRegistry,
    // [print-editor-dsk P7] — DI for the adapter registry, used to enforce
    // `availableRegions` allowlist on overrides / template definitions.
    private readonly adapterRegistry: FormatAdapterRegistryService,
  ) {}

  /**
   * Lista el catálogo de los 10 formatos con el estado actual para la tienda
   */
  async listStoreFormats(storeId: number, organizationId: number) {
    const storeConfigs = await this.storePrisma.store_print_format_configs.findMany({
      where: { store_id: storeId },
      include: { template: true },
    });

    const configMap = new Map<print_format_type_enum, any>();
    for (const cfg of storeConfigs) {
      configMap.set(cfg.format_type, cfg);
    }

    return ALL_FORMAT_TYPES.map((type) => {
      const cfg = configMap.get(type);
      const meta = FORMAT_TYPE_METADATA[type];
      return {
        format_type: type,
        name: meta.name,
        category: meta.category,
        icon: meta.icon,
        engine: meta.engine,
        is_configured: Boolean(cfg),
        is_active: cfg?.is_active ?? true,
        gateway_enabled: cfg?.gateway_enabled ?? false,
        template_name: cfg?.template?.name || (cfg?.overrides ? 'Personalizado (Overrides)' : 'Por defecto del sistema'),
        updated_at: cfg?.updated_at || null,
      };
    });
  }

  /**
   * Obtiene la configuración detallada de un formato de impresión
   */
  async getStoreFormatDetail(storeId: number, formatType: print_format_type_enum) {
    const effective = await this.gateway.resolveEffectiveConfig(storeId, formatType);
    const provider = this.registry.getProvider(formatType);
    const meta = FORMAT_TYPE_METADATA[formatType];

    const storeConfig = await this.storePrisma.store_print_format_configs.findFirst({
      where: { store_id: storeId, format_type: formatType },
      include: { template: true },
    });

    return {
      format_type: formatType,
      name: meta.name,
      category: meta.category,
      is_active: effective.is_active,
      gateway_enabled: effective.gateway_enabled,
      is_customized: effective.is_customized,
      template_id: storeConfig?.template_id || null,
      template_name: storeConfig?.template?.name || null,
      definition: effective.definition,
      overrides: storeConfig?.overrides || null,
      available_tokens: provider.getAvailableTokens(),
    };
  }

  /**
   * Actualiza o crea la configuración y overrides para un formato en la tienda
   */
  async updateStoreFormat(
    storeId: number,
    organizationId: number,
    formatType: print_format_type_enum,
    dto: UpdatePrintFormatConfigDto,
  ) {
    // [print-editor-dsk] — Normalización + validación INCONDICIONAL (ver
    // `shouldValidateV2Payload` arriba para el porqué del cambio). `null` o
    // `{}` siguen siendo el no-op legítimo de "limpiar personalización":
    // ni se normalizan ni se validan. Cualquier otro payload se normaliza
    // primero (alias camelCase legados → snake_case, `v` estampado si
    // falta) y LO NORMALIZADO es lo que se valida, se usa en el chequeo de
    // regiones del adapter, se funde para el chequeo fiscal, y finalmente
    // se persiste — nunca el payload crudo.
    const rawOverrides = dto.overrides;
    const overridesIsNoop = isEmptyDefinitionPayload(rawOverrides);
    let normalizedOverrides: Record<string, any> | null | undefined = rawOverrides as
      | Record<string, any>
      | null
      | undefined;

    if (rawOverrides !== undefined && !overridesIsNoop) {
      normalizedOverrides = normalizeDefinition(rawOverrides) as Record<string, any>;

      const result = validatePrintFormatDefinition(normalizedOverrides);
      if (!result.valid) {
        throw new VendixHttpException(
          ErrorCodes.PRINT_CONFIG_VALIDATION_001,
          'schema validation failed for store format overrides',
          { errors: result.errors },
        );
      }

      // [print-editor-dsk P7] — Per-format region allowlist (runs after AJV
      // shape validation so `sections` is already a valid array).
      assertSectionsWithinAdapterRegions(
        formatType,
        normalizedOverrides,
        this.adapterRegistry,
        'store override',
      );
    }

    // Si se están enviando overrides con definición estructurada o custom, validar fiscalmente
    if (normalizedOverrides) {
      const current = await this.gateway.resolveEffectiveConfig(storeId, formatType);
      const merged = { ...current.definition, ...normalizedOverrides };
      this.fiscalValidator.assertFiscalCompliance(formatType, merged as any);
    }

    const existing = await this.storePrisma.store_print_format_configs.findFirst({
      where: { store_id: storeId, format_type: formatType },
    });

    let result;
    if (existing) {
      result = await this.storePrisma.store_print_format_configs.update({
        where: { id: existing.id },
        data: {
          is_active: dto.is_active !== undefined ? dto.is_active : existing.is_active,
          gateway_enabled: dto.gateway_enabled !== undefined ? dto.gateway_enabled : existing.gateway_enabled,
          template_id: dto.template_id !== undefined ? dto.template_id : existing.template_id,
          overrides: rawOverrides !== undefined ? (normalizedOverrides as any) : existing.overrides,
          updated_at: new Date(),
        },
        include: { template: true },
      });
    } else {
      result = await this.storePrisma.store_print_format_configs.create({
        data: {
          store_id: storeId,
          organization_id: organizationId,
          format_type: formatType,
          is_active: dto.is_active ?? true,
          gateway_enabled: dto.gateway_enabled ?? true,
          template_id: dto.template_id || null,
          overrides: (normalizedOverrides as any) || null,
        },
        include: { template: true },
      });
    }

    return this.getStoreFormatDetail(storeId, formatType);
  }

  /**
   * Restablece la configuración de un formato a los defaults del sistema
   */
  async resetStoreFormatToDefault(storeId: number, formatType: print_format_type_enum) {
    const existing = await this.storePrisma.store_print_format_configs.findFirst({
      where: { store_id: storeId, format_type: formatType },
    });

    if (existing) {
      await this.storePrisma.store_print_format_configs.delete({
        where: { id: existing.id },
      });
    }

    return { success: true, message: 'Configuración restablecida a los valores por defecto del sistema.' };
  }

  /**
   * Activa el flag gateway_enabled para un formato
   */
  async activateGateway(storeId: number, organizationId: number, formatType: print_format_type_enum) {
    await this.updateStoreFormat(storeId, organizationId, formatType, { gateway_enabled: true });
    return { format_type: formatType, gateway_enabled: true };
  }

  /**
   * Desactiva el flag gateway_enabled (revierte a legacy emitter)
   */
  async deactivateGateway(storeId: number, organizationId: number, formatType: print_format_type_enum) {
    await this.updateStoreFormat(storeId, organizationId, formatType, { gateway_enabled: false });
    return { format_type: formatType, gateway_enabled: false };
  }

  // ============================================
  // BIBLIOTECA DE ORGANIZACIÓN (TEMPLATES COMPARTIDOS)
  // ============================================

  async listLibraryTemplates(organizationId: number, formatType?: print_format_type_enum) {
    const where: any = {
      OR: [
        { is_system: true },
        { organization_id: organizationId, is_shared: true },
        { organization_id: organizationId },
      ],
    };

    if (formatType) {
      where.format_type = formatType;
    }

    // `withoutScope()` es deliberado, no un descuido de alcance.
    //
    // `this.orgPrisma.print_templates` (el getter por defecto) pasa por
    // `OrganizationPrismaService.applyOrganizationScoping`, que para modelos
    // sin `SCOPE_OVERRIDES` inyecta `organization_id: context.organization_id`
    // como llave HERMANA del `where` del llamador (no dentro de un `AND`
    // explícito) — ver `organization-prisma.service.ts`. Con un `OR` de primer
    // nivel como el de arriba, Postgres exige AMBAS condiciones: el `OR` de
    // esta consulta Y la igualdad inyectada. Las plantillas de sistema
    // (`is_system = true`) tienen `organization_id = NULL` a propósito —son de
    // TODAS las organizaciones—, así que la igualdad inyectada las descarta
    // siempre. Medido en vivo el 2026-08-24: con 10 plantillas de sistema y 1
    // de la organización 6, `GET /store/print-formats/library` devolvía **1**
    // fila en vez de **11** — el catálogo entero desaparecía en silencio, sin
    // error, y parecía que la biblioteca compartida no existía.
    //
    // El alcance real de esta consulta ya está impuesto A MANO en el `OR` de
    // arriba con el `organizationId` recibido por parámetro (nunca del
    // contexto de otro tenant), así que `withoutScope()` no abre nada: sólo
    // evita que la capa de scoping genérica AND-ee una igualdad que este
    // modelo, por diseño, no puede satisfacer para sus filas de sistema.
    return this.orgPrisma.withoutScope().print_templates.findMany({
      where,
      include: {
        author: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
      orderBy: [{ is_system: 'desc' }, { created_at: 'desc' }],
    });
  }

  async createLibraryTemplate(
    organizationId: number,
    userId: number,
    dto: CreatePrintTemplateDto,
  ) {
    // [print-editor-dsk] — Normalización + validación INCONDICIONAL. Las
    // plantillas de biblioteca son SIEMPRE una `definition` completa (no un
    // parche parcial como `overrides`), así que no hay caso "no-op vacío"
    // equivalente al de `updateStoreFormat`: un `definition` sin `paper`
    // debe fallar, no pasarse en silencio.
    const normalizedDefinition = normalizeDefinition(dto.definition) as Record<string, any>;

    const result = validatePrintFormatDefinition(normalizedDefinition);
    if (!result.valid) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_CONFIG_VALIDATION_001,
        'schema validation failed for library template definition',
        { errors: result.errors },
      );
    }

    // [print-editor-dsk P7] — Per-format region allowlist, same gate as
    // `updateStoreFormat`. Templates are scoped to a single
    // `format_type`, so a wrong region means a future render will fall
    // back to the default for that region (silent regression). Better
    // to reject at create time.
    assertSectionsWithinAdapterRegions(
      dto.format_type as print_format_type_enum,
      normalizedDefinition,
      this.adapterRegistry,
      'library template',
    );

    // `CreatePrintTemplateDto.format_type` está tipado con el enum TS local
    // `PrintFormatTypeEnum` (validado por `@IsEnum` en el DTO); el validador
    // fiscal espera el tipo unión de Prisma `print_format_type_enum`. Ambos
    // comparten exactamente los mismos 15 valores de string, pero un enum TS
    // no es estructuralmente idéntico a la unión de literales que genera
    // Prisma, así que sigue haciendo falta un cast en la frontera — un solo
    // cast, sin pasar por `unknown`.
    this.fiscalValidator.assertFiscalCompliance(
      dto.format_type as print_format_type_enum,
      normalizedDefinition as any,
    );

    return this.orgPrisma.print_templates.create({
      data: {
        organization_id: organizationId,
        created_by: userId,
        format_type: dto.format_type,
        name: dto.name,
        description: dto.description || null,
        definition: normalizedDefinition as any,
        is_system: false,
        is_shared: dto.is_shared ?? true,
      },
    });
  }

  async cloneTemplateToStore(
    storeId: number,
    organizationId: number,
    templateId: number,
  ) {
    // Mismo motivo que en `listLibraryTemplates`: el `OR` que admite plantillas
    // de sistema (`organization_id = NULL`) quedaría ANDado con la igualdad de
    // alcance que `this.orgPrisma.print_templates` inyecta sola, y ninguna
    // plantilla de sistema pasaría el filtro. `withoutScope()` con el `OR`
    // manual de abajo (que ya acota a `organizationId`) es el filtro correcto.
    const template = await this.orgPrisma.withoutScope().print_templates.findFirst({
      where: {
        id: templateId,
        OR: [{ is_system: true }, { organization_id: organizationId }],
      },
    });

    if (!template) {
      throw new VendixHttpException(ErrorCodes.PRINT_TEMPLATE_NOT_FOUND_001);
    }

    await this.updateStoreFormat(storeId, organizationId, template.format_type, {
      template_id: template.id,
      overrides: {},
      is_active: true,
      gateway_enabled: true,
    });

    return this.getStoreFormatDetail(storeId, template.format_type);
  }

  async updateTemplateShareState(
    organizationId: number,
    templateId: number,
    isShared: boolean,
  ) {
    const template = await this.orgPrisma.print_templates.findFirst({
      where: { id: templateId, organization_id: organizationId },
    });

    if (!template) {
      throw new VendixHttpException(ErrorCodes.PRINT_TEMPLATE_NOT_FOUND_001);
    }

    if (template.is_system) {
      throw new VendixHttpException(ErrorCodes.PRINT_TEMPLATE_SYSTEM_PROTECTED_001);
    }

    return this.orgPrisma.print_templates.update({
      where: { id: templateId },
      data: { is_shared: isShared, updated_at: new Date() },
    });
  }
}
