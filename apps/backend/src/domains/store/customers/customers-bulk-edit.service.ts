import { HttpException, Injectable, Logger } from '@nestjs/common';
import { user_state_enum } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import type { ErrorCodeEntry } from 'src/common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CustomersService } from './customers.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  BulkCustomerFieldDiffDto,
  BulkCustomerFilters,
  BulkCustomerIdsDto,
  BulkCustomerItemStatus,
  BulkCustomerListQueryDto,
  BulkCustomerListRowDto,
  BulkCustomerPreviewItemDto,
  BulkCustomerPreviewResultDto,
  BulkCustomerResultDto,
  BulkCustomerResultItemDto,
  BulkCustomerTagActionMode,
  BulkEditableCustomerChangesDto,
  BulkEditCustomersDto,
  MAX_BULK_CUSTOMER_FILTER_IDS,
} from './dto/bulk-edit-customers.dto';

/**
 * Claves ESCALARES del contrato, en el orden del DTO.
 *
 * El diff se calcula EXCLUSIVAMENTE sobre esta lista y nunca sobre las claves
 * del payload: `price_tier_id` vive en `store_users` y `tag_action` es
 * relacional, así que los dos se comparan con su propio resolvedor.
 */
const BULK_CUSTOMER_SCALAR_FIELDS = [
  'first_name',
  'last_name',
  'legal_name',
  'phone',
  'person_type',
  'tax_regime',
  'is_withholding_agent',
  'ciiu_code',
  'fiscal_responsibilities',
] as const;

type BulkCustomerScalarField = (typeof BULK_CUSTOMER_SCALAR_FIELDS)[number];

/** Nombre del rol que identifica a un cliente de la tienda. */
const CUSTOMER_ROLE_NAME = 'customer';

/** Tipos de dirección que el panel usa para ciudad/departamento. */
const LIST_ADDRESS_TYPES = ['billing', 'shipping'] as const;

/**
 * Fila de `users` leída para el preview/apply del lote.
 *
 * `users` NO está en la lista store-scoped de `StorePrismaService` (los clientes
 * son usuarios de la organización), así que CADA consulta de este servicio
 * incluye `store_users.some.store_id` a mano. Es la única barrera de
 * multi-tenant que hay aquí y no se delega.
 */
interface CustomerRow {
  id: number;
  first_name: string;
  last_name: string;
  legal_name: string | null;
  phone: string | null;
  person_type: string | null;
  tax_regime: string | null;
  is_withholding_agent: boolean;
  ciiu_code: string | null;
  fiscal_responsibilities: string[];
  state: string;
  email: string | null;
  document_type: string | null;
  document_number: string | null;
  store_users: { price_tier_id: number | null }[];
  user_roles: { id: number }[];
}

/** Tarifa resuelta del lote. `id: null` = limpiar; `undefined` = no tocar. */
interface PriceTierContext {
  id: number | null;
  name: string | null;
}

/** Una fila clasificada: lo que preview devuelve y apply re-verifica. */
interface ClassifiedRow {
  row: CustomerRow;
  id: number;
  name: string;
  status: BulkCustomerItemStatus;
  changes: BulkCustomerFieldDiffDto[];
  code?: string;
  message?: string;
}

/**
 * Edición masiva de clientes: preview read-only + aplicación fila por fila.
 *
 * ## Qué escribe y qué no
 *
 * Solo `users` (datos de la persona y fiscales), `store_users` (la tarifa, que
 * es la única columna de cliente que vive en la membresía) y `crm_customer_tags`
 * (etiquetas pedidas explícitamente). Nada de `orders`, `invoices`, `addresses`
 * ni precios de productos: la lista de campos editables y sus exclusiones está
 * documentada en `dto/bulk-edit-customers.dto.ts`.
 *
 * ## Por qué `apply()` delega en `CustomersService.update()`
 *
 * Las reglas de identidad de cliente (coherencia persona/documento, NIT + DV,
 * razón social vs nombre, resolución del email, validación de la tarifa) viven
 * en `update()`. Duplicarlas aquí garantizaría deriva, así que `apply()` no
 * escribe `users` directamente: itera y llama `update(storeId, id, payload)`
 * capturando el fallo de cada fila para no abortar el lote.
 *
 * ## El payload SIEMPRE lleva nombre y apellido
 *
 * `update()` escribe `first_name: dto.first_name ?? ''` (igual con
 * `last_name`), porque el modal individual reenvía el formulario completo. Si
 * este servicio mandara solo el campo que el operador activó (p. ej. `phone`),
 * el PATCH borraría nombre y apellido de TODOS los clientes del lote. Por eso
 * el payload se completa con el valor EFECTIVO de la fila
 * (`changes.first_name ?? row.first_name`).
 *
 * ## Sin N+1
 *
 * Resolver el lote son 4 lecturas fijas (clientes, membresías de tarifa, tarifas
 * por nombre, etiquetas actuales) sin importar el tamaño del lote. Las escrituras
 * son una transacción por cliente, que es el mismo reparto que el masivo de
 * productos: la fila que falla no arrastra a las demás y el operador recibe un
 * resultado por cliente.
 */
@Injectable()
export class CustomersBulkEditService {
  private readonly logger = new Logger(CustomersBulkEditService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly customersService: CustomersService,
  ) {}

  // ===========================================================================
  // PREVIEW (read-only)
  // ===========================================================================

  async preview(
    storeId: number,
    dto: BulkEditCustomersDto,
  ): Promise<BulkCustomerPreviewResultDto> {
    const ids = this.dedupeIds(dto.ids);
    const changes = dto.changes;
    this.assertHasChanges(changes);

    // Validaciones de LOTE: fallan rápido para todo el lote (una sola vez).
    const tier = await this.resolvePriceTierContext(changes.price_tier_id);
    const tagContext = await this.resolveTagContext(changes.tag_action);

    const rows = await this.loadRows(storeId, ids);
    const rowById = new Map(rows.map((row) => [row.id, row]));

    // Nombres de las tarifas ACTUALES, para poder decir «tenía la tarifa X» en
    // vez de mostrar un id. Lectura acotada al catálogo de la tienda.
    const currentTierIds = rows
      .map((row) => row.store_users[0]?.price_tier_id)
      .filter((id): id is number => typeof id === 'number');
    const tierNames = await this.loadPriceTierNames(currentTierIds);

    const currentTags = tagContext
      ? await this.loadCustomerTagIds(ids)
      : new Map<number, number[]>();

    let tierOverwrites = 0;

    const items: BulkCustomerPreviewItemDto[] = ids.map((id) => {
      const row = rowById.get(id);
      if (!row) {
        return {
          id,
          name: '',
          document_number: null,
          status: 'error',
          changes: [],
          code: ErrorCodes.CUST_FIND_001.code,
          message: 'El cliente no existe en esta tienda',
        };
      }

      const classified = this.classifyRow(
        row,
        changes,
        tier,
        tierContextLabel(tier),
        tierNames,
        tagContext,
        currentTags.get(id) ?? [],
      );

      if (classified.status !== 'error') {
        const currentTierId = row.store_users[0]?.price_tier_id ?? null;
        if (
          changes.price_tier_id !== undefined &&
          currentTierId !== null &&
          currentTierId !== (changes.price_tier_id ?? null)
        ) {
          tierOverwrites += 1;
        }
      }

      return {
        id,
        name: classified.name,
        document_number: row.document_number,
        status: classified.status,
        changes: classified.changes,
        ...(classified.code && { code: classified.code }),
        ...(classified.message && { message: classified.message }),
      };
    });

    return {
      total: items.length,
      ok: items.filter((item) => item.status === 'ok').length,
      warnings: items.filter((item) => item.status === 'warning').length,
      errors: items.filter((item) => item.status === 'error').length,
      tier_overwrite_count: tierOverwrites,
      items,
    };
  }

  // ===========================================================================
  // APPLY
  // ===========================================================================

  async apply(
    storeId: number,
    dto: BulkEditCustomersDto,
  ): Promise<BulkCustomerResultDto> {
    const ids = this.dedupeIds(dto.ids);
    const changes = dto.changes;
    this.assertHasChanges(changes);

    // Mismas validaciones de LOTE que el preview, resueltas una sola vez.
    const tier = await this.resolvePriceTierContext(changes.price_tier_id);
    const tagContext = await this.resolveTagContext(changes.tag_action);

    const rows = await this.loadRows(storeId, ids);
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const currentTags = await this.loadCustomerTagIds(ids);

    const results: BulkCustomerResultItemDto[] = [];

    for (const id of ids) {
      const row = rowById.get(id);
      try {
        const failure = row ? this.detectFailure(row, changes) : null;
        if (!row || failure) {
          throw new VendixHttpException(
            failure?.entry ?? ErrorCodes.CUST_FIND_001,
            failure?.message ?? 'El cliente no existe en esta tienda',
          );
        }

        // Tarifa: batch-level ya validada; aquí solo se decide si se toca.
        const payload = this.buildUpdatePayload(row, changes, tier);
        await this.customersService.update(storeId, id, payload);

        // Etiquetas: se escriben DESPUÉS del update escalar. `tag_action` es
        // idempotente por fila, así que un cliente que ya tenía la etiqueta no
        // genera escritura. Si las etiquetas fallan, la fila NO se reporta como
        // fallo total: los datos del cliente YA se guardaron, y decir lo
        // contrario mandaría al operador a repetir una escritura que ya ocurrió.
        if (tagContext) {
          const nextTags = this.applyTagAction(
            currentTags.get(id) ?? [],
            tagContext.action,
          );
          try {
            await this.replaceCustomerTags(storeId, id, nextTags);
          } catch (tagError) {
            const info = this.extractErrorInfo(tagError);
            this.logger.warn(
              `Bulk customer edit: las etiquetas del cliente ${id} fallaron: ${info.message}`,
            );
            results.push({
              id,
              name: this.displayName(row),
              status: 'error',
              ...(info.code && { code: info.code }),
              message: `Los datos del cliente se guardaron, pero las etiquetas no: ${info.message}`,
            });
            continue;
          }
        }

        results.push({ id, name: this.displayName(row), status: 'ok' });
      } catch (error) {
        const { code, message } = this.extractErrorInfo(error);
        this.logger.warn(
          `Bulk customer edit falló para el cliente ${id}: ${message}`,
        );
        results.push({
          id,
          name: row ? this.displayName(row) : '',
          status: 'error',
          ...(code && { code }),
          message,
        });
      }
    }

    return {
      total: results.length,
      successful: results.filter((result) => result.status === 'ok').length,
      failed: results.filter((result) => result.status === 'error').length,
      results,
    };
  }

  // ===========================================================================
  // SELECCIÓN POR FILTRO
  // ===========================================================================

  /**
   * Ids que satisfacen el filtro, para "seleccionar todos los que cumplen" sin
   * materializar filas. Devuelve `capped` en vez de truncar en silencio.
   */
  async listIds(
    storeId: number,
    filters: BulkCustomerFilters,
  ): Promise<BulkCustomerIdsDto> {
    const where = this.buildFilterWhere(storeId, filters);
    const total = await this.prisma.users.count({ where });
    const rows = await this.prisma.users.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'desc' },
      take: MAX_BULK_CUSTOMER_FILTER_IDS,
    });
    return {
      ids: rows.map((row) => row.id),
      total,
      capped: total > rows.length,
    };
  }

  /** Página del panel: lo justo para elegir y reconocer al cliente. */
  async listPage(
    storeId: number,
    query: BulkCustomerListQueryDto & {
      customer_ids?: number[];
      ids?: number[];
    },
  ): Promise<{
    data: BulkCustomerListRowDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildFilterWhere(storeId, query);

    const [total, rows] = await Promise.all([
      this.prisma.users.count({ where }),
      this.prisma.users.findMany({
        where,
        select: {
          id: true,
          first_name: true,
          last_name: true,
          legal_name: true,
          document_type: true,
          document_number: true,
          email: true,
          phone: true,
          person_type: true,
          state: true,
          created_at: true,
          store_users: {
            where: { store_id: storeId },
            select: {
              price_tier_id: true,
              price_tier: { select: { name: true } },
            },
          },
          addresses: {
            where: { type: { in: [...LIST_ADDRESS_TYPES] } },
            select: {
              type: true,
              is_primary: true,
              city: true,
              state_province: true,
            },
          },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((row) => this.toListRow(row)),
      total,
      page,
      limit,
    };
  }

  /**
   * Clasifica una fila: diff + bloqueos (`error`) + avisos (`warning`).
   *
   * Es la MISMA función que `apply()` usa para re-verificar antes de escribir,
   * así que lo que el preview anuncia como bloqueo es exactamente lo que el
   * apply rechaza. (A diferencia de productos, aquí no hace falta re-verificar
   * estado remoto: no hay reservas ni pedidos que cambien entre preview y
   * apply, y la tarifa/etiquetas se revalidan por lote.)
   */
  private classifyRow(
    row: CustomerRow,
    changes: BulkEditableCustomerChangesDto,
    tier: PriceTierContext | undefined,
    tierLabel: string,
    currentTierNames: Map<number, string>,
    tagContext: TagContext | undefined,
    currentTagIds: number[],
  ): ClassifiedRow {
    const name = this.displayName(row);
    const changesDiff = this.buildDiff(row, changes, tier, tagContext, currentTagIds);
    const base: ClassifiedRow = {
      row,
      id: row.id,
      name,
      status: 'ok',
      changes: changesDiff,
    };

    const failure = this.detectFailure(row, changes);
    if (failure) {
      return {
        ...base,
        status: 'error',
        code: failure.entry.code,
        message: failure.message,
      };
    }

    const warnings: string[] = [];

    // La tarifa se SOBRESCRIBE: no es un error, pero el operador tiene que
    // saberlo antes de confirmar (el panel además lo cuenta aparte).
    if (tier !== undefined && tier.id !== null) {
      const currentTierId = row.store_users[0]?.price_tier_id ?? null;
      if (currentTierId !== null && currentTierId !== tier.id) {
        const currentName =
          currentTierNames.get(currentTierId) ?? `tarifa #${currentTierId}`;
        warnings.push(
          `Tenía la tarifa «${currentName}»: se reemplazará por «${tierLabel}».`,
        );
      }
    }
    if (tier !== undefined && tier.id === null) {
      const currentTierId = row.store_users[0]?.price_tier_id ?? null;
      if (currentTierId !== null) {
        const currentName =
          currentTierNames.get(currentTierId) ?? `tarifa #${currentTierId}`;
        warnings.push(`Tenía la tarifa «${currentName}»: quedará sin tarifa.`);
      }
    }

    // Cambio a persona jurídica con nombre de persona natural en la fila: el
    // servicio los vacía en silencio (`update()` fuerza '' al escribir
    // person_type JURIDICA). Se avisa porque el resultado no es literal.
    if (changes.person_type === 'JURIDICA') {
      const keepsNaturalName =
        ((changes.first_name ?? row.first_name) ?? '').trim() !== '' ||
        ((changes.last_name ?? row.last_name) ?? '').trim() !== '';
      if (keepsNaturalName) {
        warnings.push(
          'Al quedar como persona jurídica se vacían nombre y apellido; la razón social los reemplaza.',
        );
      }
    }

    if (warnings.length > 0) {
      return { ...base, status: 'warning', message: warnings.join(' ') };
    }

    return base;
  }

  // ===========================================================================
  // Reglas por fila
  // ===========================================================================

  /**
   * Bloqueos de una fila.
   *
   * Replica las compuertas de `CustomersService.update()` que pueden impedir la
   * escritura, para que el preview no prometa lo que el apply va a rechazar.
   * El documento NO se toca en lote, así que las reglas de NIT/DV y de
   * unicidad documental no aplican; la coherencia persona/documento SÍ, porque
   * un cambio a JURIDICA choca con una cédula ya guardada.
   */
  private detectFailure(
    row: CustomerRow,
    changes: BulkEditableCustomerChangesDto,
  ): { entry: ErrorCodeEntry; message: string } | null {
    if (row.state === user_state_enum.archived) {
      return {
        entry: ErrorCodes.CUST_FIND_001,
        message: 'El cliente está archivado y no se puede editar en lote.',
      };
    }

    if (row.store_users.length === 0) {
      return {
        entry: ErrorCodes.CUST_FIND_001,
        message: 'El cliente no está vinculado a esta tienda.',
      };
    }

    if (row.user_roles.length === 0) {
      return {
        entry: ErrorCodes.CUST_VALIDATE_001,
        message:
          'No es un cliente de la tienda (parece staff o manager): el lote no edita membresías internas.',
      };
    }

    const nextPersonType =
      changes.person_type !== undefined
        ? changes.person_type
        : row.person_type;

    // `assertPersonaDocumentCoherence()` de `CustomersService`: solo se evalúa
    // cuando ESTA petición toca `person_type`, igual que el update individual.
    if (
      changes.person_type === 'JURIDICA' &&
      row.document_type &&
      row.document_type !== 'NIT'
    ) {
      return {
        entry: ErrorCodes.CUST_VALIDATE_001,
        message: `person_type 'JURIDICA' requiere document_type 'NIT'; '${row.document_type}' es un tipo de documento de persona natural y no puede combinarse con persona jurídica.`,
      };
    }

    const effectiveLegalName = (
      (changes.legal_name !== undefined ? changes.legal_name : row.legal_name) ??
      ''
    ).trim();
    const effectiveFirstName = (
      (changes.first_name !== undefined ? changes.first_name : row.first_name) ??
      ''
    ).trim();
    const effectiveLastName = (
      (changes.last_name !== undefined ? changes.last_name : row.last_name) ??
      ''
    ).trim();

    if (nextPersonType === 'JURIDICA' && effectiveLegalName === '') {
      return {
        entry: ErrorCodes.CUST_VALIDATE_001,
        message:
          'Es persona jurídica y el lote no define razón social: activa «Razón social» o cambia antes el tipo de persona.',
      };
    }

    if (
      nextPersonType !== 'JURIDICA' &&
      effectiveFirstName === '' &&
      effectiveLastName === ''
    ) {
      return {
        entry: ErrorCodes.CUST_VALIDATE_001,
        message:
          'El cliente quedaría sin nombre ni apellido: una persona natural necesita al menos uno de los dos.',
      };
    }

    return null;
  }

  // ===========================================================================
  // Diff
  // ===========================================================================

  private buildDiff(
    row: CustomerRow,
    changes: BulkEditableCustomerChangesDto,
    tier: PriceTierContext | undefined,
    tagContext: TagContext | undefined,
    currentTagIds: number[],
  ): BulkCustomerFieldDiffDto[] {
    const diff: BulkCustomerFieldDiffDto[] = [];

    for (const field of BULK_CUSTOMER_SCALAR_FIELDS) {
      const next = changes[field as keyof BulkEditableCustomerChangesDto];
      if (next === undefined) {
        continue;
      }
      const current = row[field as BulkCustomerScalarField];
      if (!this.hasChanged(current, next)) {
        continue;
      }
      diff.push({ field, current: current ?? null, next });
    }

    // Tarifa: vive en `store_users`, no en `users`.
    if (tier !== undefined) {
      const current = row.store_users[0]?.price_tier_id ?? null;
      const next = tier.id;
      if (current !== next) {
        diff.push({ field: 'price_tier_id', current, next });
      }
    }

    // Etiquetas: conjunto resultante, para que el modal muestre el antes/después
    // completo y no solo «+1 etiqueta».
    if (tagContext) {
      const next = this.applyTagAction(currentTagIds, tagContext.action);
      const currentSorted = [...currentTagIds].sort((a, b) => a - b);
      const nextSorted = [...next].sort((a, b) => a - b);
      if (JSON.stringify(currentSorted) !== JSON.stringify(nextSorted)) {
        diff.push({ field: 'tags', current: currentSorted, next: nextSorted });
      }
    }

    return diff;
  }

  /** `null`/`undefined`/`''` son el mismo "vacío"; números como string se igualan. */
  private hasChanged(current: unknown, next: unknown): boolean {
    const a = this.toComparable(current);
    const b = this.toComparable(next);
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a ?? []) !== JSON.stringify(b ?? []);
    }
    return a !== b;
  }

  private toComparable(value: unknown): unknown {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') return value.trim();
    return value;
  }

  // ===========================================================================
  // Validaciones de lote
  // ===========================================================================

  /**
   * Un lote sin campos no es un no-op inofensivo: es una petición que no
   * significa nada y que, si se aceptara, devolvería «100 clientes editados»
   * sin haber escrito nada. Se rechaza con el código de validación de cliente.
   */
  private assertHasChanges(changes: BulkEditableCustomerChangesDto): void {
    const raw = changes as Record<string, unknown>;
    const hasScalar = BULK_CUSTOMER_SCALAR_FIELDS.some(
      (field) => raw[field] !== undefined,
    );
    if (hasScalar || changes.price_tier_id !== undefined || changes.tag_action) {
      return;
    }
    throw new VendixHttpException(
      ErrorCodes.CUST_VALIDATE_001,
      'El lote no trae ningún cambio: activa al menos un campo antes de previsualizar o aplicar.',
    );
  }

  /**
   * Resuelve la tarifa del lote.
   *
   * `storeId` NO se recibe: `price_tiers` está en la lista store-scoped de
   * `StorePrismaService`, así que el filtro por tienda es automático y una
   * tarifa de otra tienda simplemente no existe para esta consulta. Eso es
   * deliberado — nunca se resuelve una tarifa ajena.
   */
  private async resolvePriceTierContext(
    priceTierId: number | null | undefined,
  ): Promise<PriceTierContext | undefined> {
    if (priceTierId === undefined) {
      return undefined;
    }
    if (priceTierId === null) {
      // «Sin tarifa»: no hay nada que resolver, y limpiar no exige catálogo.
      return { id: null, name: null };
    }
    const tier = await this.prisma.price_tiers.findFirst({
      where: { id: priceTierId, kind: 'customer_tier', is_active: true },
      select: { id: true, name: true },
    });
    if (!tier) {
      throw new VendixHttpException(
        ErrorCodes.CUST_PRICE_TIER_001,
        'La tarifa no existe en esta tienda, no es una tarifa de cliente o está inactiva.',
      );
    }
    return { id: tier.id, name: tier.name };
  }

  /** Valida que TODAS las etiquetas del lote sean de la tienda (scoped). */
  private async resolveTagContext(
    action: BulkEditableCustomerChangesDto['tag_action'],
  ): Promise<TagContext | undefined> {
    if (!action) {
      return undefined;
    }
    const ids = [...new Set(action.ids)];
    const found = await this.prisma.crm_tags.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new VendixHttpException(
        ErrorCodes.CRM_TAG_001,
        'Alguna de las etiquetas del lote no existe en esta tienda.',
      );
    }
    return {
      action: { mode: action.mode, ids },
      ids,
    };
  }

  // ===========================================================================
  // Lecturas del lote (cantidad FIJA de consultas)
  // ===========================================================================

  private loadRows(storeId: number, ids: number[]): Promise<CustomerRow[]> {
    return this.prisma.users.findMany({
      where: {
        id: { in: ids },
        // Multi-tenant: sin este filtro, un id de otra tienda entraría al lote.
        store_users: { some: { store_id: storeId } },
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        legal_name: true,
        phone: true,
        person_type: true,
        tax_regime: true,
        is_withholding_agent: true,
        ciiu_code: true,
        fiscal_responsibilities: true,
        state: true,
        email: true,
        document_type: true,
        document_number: true,
        store_users: {
          where: { store_id: storeId },
          select: { price_tier_id: true },
        },
        user_roles: {
          where: { roles: { name: CUSTOMER_ROLE_NAME } },
          select: { id: true },
        },
      },
    }) as unknown as Promise<CustomerRow[]>;
  }

  private async loadPriceTierNames(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const tiers = await this.prisma.price_tiers.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(tiers.map((tier) => [tier.id, tier.name]));
  }

  /** Etiquetas actuales por cliente del lote (scoped por tienda). */
  private async loadCustomerTagIds(
    ids: number[],
  ): Promise<Map<number, number[]>> {
    const assignments = await this.prisma.crm_customer_tags.findMany({
      where: { customer_id: { in: ids } },
      select: { customer_id: true, tag_id: true },
    });
    const map = new Map<number, number[]>();
    for (const assignment of assignments) {
      const list = map.get(assignment.customer_id) ?? [];
      list.push(assignment.tag_id);
      map.set(assignment.customer_id, list);
    }
    return map;
  }

  // ===========================================================================
  // Escrituras auxiliares
  // ===========================================================================

  /**
   * Reemplaza el conjunto de etiquetas del cliente, igual que
   * `CustomerCrmService.setTags()` pero sin acoplar el módulo (el CRM importa
   * `CustomersModule`, así que inyectarlo aquí sería un ciclo).
   */
  private async replaceCustomerTags(
    storeId: number,
    customerId: number,
    tagIds: number[],
  ): Promise<void> {
    await this.prisma.crm_customer_tags.deleteMany({
      where: { customer_id: customerId, tag_id: { notIn: tagIds } },
    });
    if (tagIds.length === 0) {
      return;
    }
    await this.prisma.crm_customer_tags.createMany({
      data: tagIds.map((tagId) => ({
        store_id: storeId,
        customer_id: customerId,
        tag_id: tagId,
      })),
      skipDuplicates: true,
    });
  }

  // ===========================================================================
  // Payload
  // ===========================================================================

  /**
   * `UpdateCustomerDto` efectivo de una fila.
   *
   * Incluye SIEMPRE `first_name`/`last_name` (ver el docblock de la clase) y
   * solo los campos que el operador activó. `price_tier_id` viaja únicamente si
   * el lote lo pidió: `undefined` significa "no tocar la tarifa".
   */
  private buildUpdatePayload(
    row: CustomerRow,
    changes: BulkEditableCustomerChangesDto,
    tier: PriceTierContext | undefined,
  ): UpdateCustomerDto {
    const payload: UpdateCustomerDto = {
      first_name: changes.first_name ?? row.first_name ?? '',
      last_name: changes.last_name ?? row.last_name ?? '',
    };

    if (changes.legal_name !== undefined) {
      payload.legal_name = changes.legal_name;
    }
    if (changes.phone !== undefined) {
      payload.phone = changes.phone;
    }
    if (changes.person_type !== undefined) {
      payload.person_type = changes.person_type;
    }
    if (changes.tax_regime !== undefined) {
      payload.tax_regime = changes.tax_regime;
    }
    if (changes.is_withholding_agent !== undefined) {
      payload.is_withholding_agent = changes.is_withholding_agent;
    }
    if (changes.ciiu_code !== undefined) {
      payload.ciiu_code = changes.ciiu_code;
    }
    if (changes.fiscal_responsibilities !== undefined) {
      payload.fiscal_responsibilities = changes.fiscal_responsibilities;
    }
    if (tier !== undefined) {
      payload.price_tier_id = tier.id;
    }

    return payload;
  }

  // ===========================================================================
  // Filtros y listado
  // ===========================================================================

  /**
   * `where` único para el listado y para "seleccionar los N del filtro".
   *
   * El scope de tienda y el rol `customer` NO son filtros opcionales: sin ellos
   * el panel podría listar usuarios de otra tienda o staff de la propia.
   *
   * Los segmentos llegan ya compilados como `customer_ids`: el motor de reglas
   * del CRM (`CrmSegmentQueryService`) vive en `CustomerCrmModule` y lo resuelve
   * el controlador con la MISMA evaluación que el listado individual — así el
   * panel masivo y la lista grande nunca discrepan sobre quién está en un
   * segmento.
   */
  private buildFilterWhere(
    storeId: number,
    filters: BulkCustomerFilters,
  ): Record<string, any> {
    const and: Record<string, any>[] = [
      { store_users: { some: { store_id: storeId } } },
      { user_roles: { some: { roles: { name: CUSTOMER_ROLE_NAME } } } },
      // Los archivados no se editan en lote ni se listan en el panel.
      { state: { not: user_state_enum.archived } },
    ];

    if (filters.state) {
      and.push({ state: filters.state });
    }

    if (filters.search) {
      const search = filters.search.trim();
      if (search) {
        and.push({
          OR: [
            { first_name: { contains: search, mode: 'insensitive' } },
            { last_name: { contains: search, mode: 'insensitive' } },
            { legal_name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { document_number: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ],
        });
      }
    }

    if (filters.tag_ids?.length) {
      // Scope explícito de tienda: una etiqueta de otra tienda nunca matchea,
      // aunque el id exista (mismo criterio que `findAll`).
      and.push({
        crm_customer_tags: {
          some: { store_id: storeId, tag_id: { in: filters.tag_ids } },
        },
      });
    }

    // Segmento: `in: []` no devuelve filas, que es exactamente lo que se quiere
    // cuando el segmento no tiene a nadie.
    if (filters.customer_ids !== undefined) {
      and.push({ id: { in: filters.customer_ids } });
    }

    // Lectura acotada por id (hidratación del stack de seleccionados).
    if (filters.ids?.length) {
      and.push({ id: { in: filters.ids } });
    }

    if (filters.price_tier_id) {
      and.push({
        store_users: {
          some: { store_id: storeId, price_tier_id: filters.price_tier_id },
        },
      });
    }

    if (filters.without_price_tier) {
      and.push({
        store_users: { some: { store_id: storeId, price_tier_id: null } },
      });
    }

    if (filters.city) {
      and.push({
        addresses: {
          some: {
            city: { equals: filters.city.trim(), mode: 'insensitive' },
            type: { in: [...LIST_ADDRESS_TYPES] },
          },
        },
      });
    }

    if (filters.state_province) {
      and.push({
        addresses: {
          some: {
            state_province: {
              equals: filters.state_province.trim(),
              mode: 'insensitive',
            },
            type: { in: [...LIST_ADDRESS_TYPES] },
          },
        },
      });
    }

    if (filters.created_from || filters.created_to) {
      const range: Record<string, Date> = {};
      if (filters.created_from) {
        range.gte = new Date(filters.created_from);
      }
      if (filters.created_to) {
        // Fin de día inclusive: el operador elige una fecha, no una hora.
        range.lte = endOfDay(filters.created_to);
      }
      and.push({ created_at: range });
    }

    return { AND: and };
  }

  private toListRow(row: Record<string, any>): BulkCustomerListRowDto {
    const membership = (row.store_users ?? [])[0];
    const addresses: any[] = row.addresses ?? [];
    const billing =
      addresses.find((address) => address.type === 'billing') ??
      addresses.find((address) => address.is_primary) ??
      addresses[0];

    return {
      id: row.id,
      first_name: row.first_name ?? '',
      last_name: row.last_name ?? '',
      legal_name: row.legal_name ?? null,
      document_type: row.document_type ?? null,
      document_number: row.document_number ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      person_type: row.person_type ?? null,
      state: String(row.state),
      price_tier_id: membership?.price_tier_id ?? null,
      price_tier_name: membership?.price_tier?.name ?? null,
      city: billing?.city ?? null,
      state_province: billing?.state_province ?? null,
      created_at: row.created_at ?? null,
    };
  }

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  private dedupeIds(ids: number[]): number[] {
    return [...new Set(ids)];
  }

  /** Nombre visible: razón social para jurídicas, nombre + apellido para el resto. */
  private displayName(row: CustomerRow): string {
    const legalName = (row.legal_name ?? '').trim();
    if (row.person_type === 'JURIDICA' && legalName) {
      return legalName;
    }
    const natural = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim();
    return natural || legalName || `Cliente #${row.id}`;
  }

  /** Conjunto de etiquetas resultante de la acción (idempotente por fila). */
  private applyTagAction(
    currentIds: number[],
    action: TagContext['action'],
  ): number[] {
    const current = new Set(currentIds);
    for (const id of action.ids) {
      if (action.mode === BulkCustomerTagActionMode.ADD) {
        current.add(id);
      } else {
        current.delete(id);
      }
    }
    return [...current];
  }

  /** Extrae `error_code` + mensaje de la excepción de una fila. */
  private extractErrorInfo(error: unknown): {
    code?: string;
    message: string;
  } {
    if (error instanceof VendixHttpException) {
      const response = error.getResponse() as { message?: string } | string;
      const message =
        typeof response === 'string'
          ? response
          : (response?.message ?? error.message);
      return { code: error.errorCode, message };
    }
    if (error instanceof HttpException) {
      const response = error.getResponse() as
        | { message?: unknown; error_code?: string }
        | string;
      if (typeof response === 'string') {
        return { message: response };
      }
      const raw = response?.message;
      const message = Array.isArray(raw)
        ? raw.join('; ')
        : typeof raw === 'string'
          ? raw
          : error.message;
      return {
        ...(response?.error_code && { code: response.error_code }),
        message,
      };
    }
    if (error instanceof Error) {
      return { message: error.message };
    }
    return { message: 'Error desconocido al actualizar el cliente' };
  }
}

/** Acción de etiquetas ya validada y deduplicada. */
interface TagContext {
  action: { mode: BulkCustomerTagActionMode; ids: number[] };
  ids: number[];
}

/** Etiqueta legible de la tarifa destino, para los mensajes del preview. */
function tierContextLabel(tier: PriceTierContext | undefined): string {
  if (tier === undefined) {
    return '';
  }
  if (tier.id === null) {
    return 'Sin tarifa';
  }
  return tier.name ?? `tarifa #${tier.id}`;
}

/** Fin del día (23:59:59.999) de una fecha `YYYY-MM-DD`, en UTC. */
function endOfDay(value: string): Date {
  const date = new Date(value);
  if (value.length <= 10) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}
