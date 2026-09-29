import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  assertCanChargeInc,
  assertCanChargeVat,
  isIncResponsible,
  isVatResponsible,
  type VatFiscalDataInput,
} from '../../../../common/helpers/vat-responsibility.helper';
import { storeIsRestaurant } from '../../../../common/helpers/industry-capabilities.helper';
import {
  EMPTY_SHIPPING_TAX,
  buildShippingTaxBreakdownRow,
  evaluateShippingTaxCategory,
  resolveShippingCharge,
  resolveShippingTaxSnapshot,
  type ChargedShippingCost,
  type ShippingTaxBreakdownRow,
  type ShippingTaxCategoryInput,
  type ShippingTaxOrderInput,
  type ShippingTaxSnapshot,
  type ShippingTaxType,
} from '../utils/shipping-tax.util';

/**
 * Cliente mínimo que necesita la copia. Acepta el `tx` de un `$transaction`
 * (que sale del baseClient, SIN scoping) o el baseClient: por eso todos los
 * filtros de tenant van explícitos con `store_id`.
 */
export type ShippingTaxDbClient = Pick<
  Prisma.TransactionClient,
  'shipping_rates' | 'stores'
>;

/** Forma pública de la categoría de impuesto en las lecturas de tarifa. */
export interface ShippingRateTaxCategoryView {
  id: number;
  name: string;
  /** 'iva' | 'inc' si es elegible; el tipo real (p. ej. 'ibua') si no. */
  tax_type: ShippingTaxType | string;
  rate_percent: number;
}

export interface ShippingRateTaxOptions {
  categories: Array<{
    id: number;
    name: string;
    tax_type: string | null;
    rate_percent: number | null;
    eligible: boolean;
    reason?: string;
    /**
     * Pista de preselección para tarifas NUEVAS (patrón
     * `resolveCatalogInclusiveDefault`): el `is_inclusive` crudo de la
     * categoría. Nunca entra al cálculo — el modo vive en la tarifa.
     */
    is_inclusive: boolean | null;
  }>;
  issuer: {
    vat_responsible: boolean;
    inc_responsible: boolean;
    is_restaurant: boolean;
  };
  suggestion?: {
    tax_type: 'inc';
    category_id: number | null;
    message: string;
  };
  warnings?: string[];
}

/** Select canónico de la categoría + tasas que consume el resolutor. */
export const SHIPPING_TAX_CATEGORY_SELECT = {
  id: true,
  name: true,
  tax_type: true,
  is_inclusive: true,
  store_id: true,
  organization_id: true,
  tax_rates: { select: { id: true, name: true, rate: true } },
} as const;

type CategoryRow = {
  id: number;
  name: string;
  tax_type: string | null;
  is_inclusive: boolean | null;
  store_id: number | null;
  organization_id: number | null;
  tax_rates: Array<{ id: number; name: string; rate: unknown }>;
};

/**
 * Contexto fiscal de una tarifa para el cálculo "precio → bruto". Una
 * entrada por cotización (`loadRateTaxContext`): el consumidor llama al
 * resolutor puro `resolveShippingCharge` por opción sin releer la DB.
 */
export interface RateTaxContext {
  rate_id: number;
  /** Modo de la tarifa (`shipping_rates.tax_is_inclusive`). */
  tax_is_inclusive: boolean;
  /** Categoría si está en el alcance de la tienda; null ⇒ sin impuesto. */
  category: ShippingTaxCategoryInput | null;
  vat_responsible: boolean;
  inc_responsible: boolean;
}

interface IssuerContext {
  organization_id: number | null;
  fiscal_scope: 'STORE' | 'ORGANIZATION';
  fiscal_data: VatFiscalDataInput | null;
  industries: string[];
}

export const SHIPPING_INC_RESTAURANT_SUGGESTION =
  'La DIAN (Oficio 904106/2022) considera el domicilio parte de la base del INC en restaurantes.';

/**
 * Carga tarifa → categoría → tasa, aplica la regla del emisor y devuelve la
 * copia del impuesto del envío o el costo cobrado (`chargeForRate`,
 * `loadRateTaxContext`). También valida la configuración de la tarifa y arma
 * las opciones del wizard. La regla fiscal vive en
 * `utils/shipping-tax.util.ts` (pura); aquí solo hay lectura y avisos.
 */
@Injectable()
export class ShippingTaxService {
  private readonly logger = new Logger(ShippingTaxService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  // ========== COPIA AL VENDER ==========

  /**
   * Copia del impuesto para una orden cuyo `shipping_cost` salió de la tarifa
   * `rate_id`. Devuelve el bloque `data` para `prisma.orders`:
   * `{ shipping_tax_rate_id, shipping_tax_name, shipping_tax_type,
   * shipping_tax_rate, shipping_tax_amount }`.
   *
   * Nunca lanza por el impuesto (es accesorio a la venta): tarifa ajena o
   * inexistente, sin categoría, categoría no elegible o costo 0 ⇒ copia
   * vacía. Un bruto que no cierra exacto SÍ se grava (base = bruto − impuesto). IVA con emisor sin O-48 ⇒ copia vacía + warn; INC con emisor sin O-33 ⇒ copia vacía + warn.
   * Costo digitado a mano ⇒ el llamador NO debe llamar a esto (copia vacía).
   *
   * `client`: pasar el `tx` si se está dentro de una transacción (evita tomar
   * otra conexión del pool). Sin él se usa el baseClient con filtros
   * explícitos.
   */
  async snapshotForRate(
    client: ShippingTaxDbClient | null | undefined,
    rate_id: number | null | undefined,
    shipping_cost: unknown,
    options: { store_id: number },
  ): Promise<ShippingTaxSnapshot> {
    if (!rate_id || !options?.store_id) return { ...EMPTY_SHIPPING_TAX };
    const gross = Number(shipping_cost ?? 0);
    if (!Number.isFinite(gross) || gross <= 0) return { ...EMPTY_SHIPPING_TAX };

    const db: ShippingTaxDbClient = client ?? this.prisma.withoutScope();
    const store_id = options.store_id;

    const rate = await db.shipping_rates.findFirst({
      where: {
        id: rate_id,
        shipping_zone: {
          OR: [{ store_id }, { is_system: true, store_id: null }],
        },
      },
      select: {
        id: true,
        tax_category: { select: SHIPPING_TAX_CATEGORY_SELECT },
      },
    });
    const category = (rate?.tax_category ?? null) as CategoryRow | null;
    if (!rate || !category) return { ...EMPTY_SHIPPING_TAX };

    const issuer = await this.readIssuerContext(db, store_id);
    if (!this.categoryInScope(category, store_id, issuer)) {
      this.logger.warn(
        `[shipping-tax] store=${store_id} rate=${rate_id} category=${category.id} ` +
          'fuera del alcance fiscal de la tienda; el envío sale sin impuesto',
      );
      return { ...EMPTY_SHIPPING_TAX };
    }

    const evaluation = evaluateShippingTaxCategory(category);
    // B4 — tarifa INC heredada con emisor sin O-33: copia vacía + aviso. El
    // cliente paga lo mismo; no se inventa un impuesto que el RUT no respalda.
    if (
      evaluation.eligible &&
      evaluation.tax_type === 'inc' &&
      !isIncResponsible(issuer?.fiscal_data ?? null)
    ) {
      this.logger.warn(
        `[shipping-tax] store=${store_id} rate=${rate_id} category=${category.id} ` +
          'envío sin impuesto (inc_not_responsible)',
      );
      return { ...EMPTY_SHIPPING_TAX };
    }
    const vat_responsible =
      evaluation.eligible && evaluation.tax_type === 'iva'
        ? isVatResponsible(issuer?.fiscal_data ?? null)
        : undefined;

    const result = resolveShippingTaxSnapshot({
      shipping_cost: gross,
      category,
      vat_responsible,
    });
    if (!result.applies && result.reason !== 'no_shipping') {
      this.logger.warn(
        `[shipping-tax] store=${store_id} rate=${rate_id} category=${category.id} ` +
          `envío sin impuesto (${result.reason})`,
      );
    }
    return result.snapshot;
  }

  /**
   * Costo cobrado al cliente por la tarifa `rate_id` (`ChargedShippingCost`,
   * siempre el BRUTO): incluido ⇒ bruto = precio de tarifa; agregado ⇒ bruto
   * = base + trunc(base·r). Si el impuesto no aplica ⇒ bruto = precio: nunca
   * hay recargo sin impuesto registrado.
   *
   * Nunca lanza por el impuesto (es accesorio a la venta): tarifa ajena o
   * inexistente, sin categoría, categoría no elegible o fuera de alcance ⇒
   * `applies:false` con el motivo. Emisor sin O-48/O-33 según el tipo ⇒
   * `vat_not_responsible`/`inc_not_responsible` + warn.
   *
   * `client`: pasar el `tx` si se está dentro de una transacción. `store_id`
   * explícito para no depender del contexto de request (webhooks, jobs).
   */
  async chargeForRate(
    client: ShippingTaxDbClient | null | undefined,
    rate_id: number | null | undefined,
    rate_price: unknown,
    options: { store_id: number },
  ): Promise<ChargedShippingCost> {
    const noRate = (tax_is_inclusive: boolean): ChargedShippingCost =>
      resolveShippingCharge({
        rate_price,
        category: null,
        tax_is_inclusive,
      });
    if (!rate_id || !options?.store_id) return noRate(true);

    const db: ShippingTaxDbClient = client ?? this.prisma.withoutScope();
    const store_id = options.store_id;

    const rate = await db.shipping_rates.findFirst({
      where: {
        id: rate_id,
        shipping_zone: {
          OR: [{ store_id }, { is_system: true, store_id: null }],
        },
      },
      select: {
        id: true,
        tax_is_inclusive: true,
        tax_category: { select: SHIPPING_TAX_CATEGORY_SELECT },
      },
    });
    if (!rate) return noRate(true);
    const tax_is_inclusive = rate.tax_is_inclusive ?? true;
    const category = (rate.tax_category ?? null) as CategoryRow | null;
    if (!category) return noRate(tax_is_inclusive);

    const issuer = await this.readIssuerContext(db, store_id);
    if (!this.categoryInScope(category, store_id, issuer)) {
      this.logger.warn(
        `[shipping-tax] store=${store_id} rate=${rate_id} category=${category.id} ` +
          'fuera del alcance fiscal de la tienda; el envío sale sin impuesto',
      );
      return noRate(tax_is_inclusive);
    }

    const charge = resolveShippingCharge({
      rate_price,
      category,
      tax_is_inclusive,
      vat_responsible: isVatResponsible(issuer?.fiscal_data ?? null),
      inc_responsible: isIncResponsible(issuer?.fiscal_data ?? null),
    });
    if (!charge.applies && charge.reason !== 'no_price') {
      this.logger.warn(
        `[shipping-tax] store=${store_id} rate=${rate_id} category=${category.id} ` +
          `envío sin impuesto (${charge.reason})`,
      );
    }
    return charge;
  }

  /**
   * Contexto fiscal de varias tarifas en UNA lectura (cotización): modo +
   * categoría en alcance + responsabilidades del emisor (una sola lectura del
   * emisor para todo el lote). Tarifas ajenas o inexistentes ⇒ ausentes del
   * mapa (el consumidor cobra precio = bruto). Categoría fuera de alcance ⇒
   * entrada con `category: null` + warn.
   *
   * `store_id` explícito cuando no hay contexto de request (storefront);
   * omitido ⇒ contexto en curso.
   */
  async loadRateTaxContext(
    rate_ids: readonly number[],
    options?: { store_id?: number },
  ): Promise<Map<number, RateTaxContext>> {
    const out = new Map<number, RateTaxContext>();
    const ids = [
      ...new Set(
        (rate_ids ?? []).filter(
          (id): id is number => Number.isInteger(id) && id > 0,
        ),
      ),
    ];
    if (ids.length === 0) return out;
    const store_id = options?.store_id ?? this.requireStoreId();

    const db = this.prisma.withoutScope();
    const issuer = await this.readIssuerContext(db, store_id);
    const vat_responsible = isVatResponsible(issuer?.fiscal_data ?? null);
    const inc_responsible = isIncResponsible(issuer?.fiscal_data ?? null);

    const rates = await db.shipping_rates.findMany({
      where: {
        id: { in: ids },
        shipping_zone: {
          OR: [{ store_id }, { is_system: true, store_id: null }],
        },
      },
      select: {
        id: true,
        tax_is_inclusive: true,
        tax_category: { select: SHIPPING_TAX_CATEGORY_SELECT },
      },
    });
    for (const rate of rates) {
      const category = (rate.tax_category ?? null) as CategoryRow | null;
      const in_scope =
        !category || this.categoryInScope(category, store_id, issuer);
      if (category && !in_scope) {
        this.logger.warn(
          `[shipping-tax] store=${store_id} rate=${rate.id} category=${category.id} ` +
            'fuera del alcance fiscal de la tienda; el envío sale sin impuesto',
        );
      }
      out.set(rate.id, {
        rate_id: rate.id,
        tax_is_inclusive: rate.tax_is_inclusive ?? true,
        category: in_scope ? category : null,
        vat_responsible,
        inc_responsible,
      });
    }
    return out;
  }

  /** Fila de desglose del envío desde la COPIA de la orden (ver util). */
  buildShippingTaxBreakdownRow(
    order: ShippingTaxOrderInput | null | undefined,
  ): ShippingTaxBreakdownRow | null {
    return buildShippingTaxBreakdownRow(order);
  }

  // ========== CONFIGURACIÓN DE TARIFA ==========

  /**
   * Valida la categoría que se quiere asignar a una tarifa de la tienda en
   * contexto. `null`/`undefined` ⇒ sin impuesto, nada que validar.
   * - Fuera del alcance (otra tienda/org, o inexistente) ⇒ 404.
   * - No elegible ⇒ 400 con el motivo.
   * - IVA con emisor sin O-48 ⇒ 412 `FISCAL_VAT_NOT_RESPONSIBLE_001`
   *   (`context: 'shipping'`).
   * - INC con emisor sin O-33 ⇒ 412 `FISCAL_INC_NOT_RESPONSIBLE_001`
   *   (`context: 'shipping'`).
   */
  async assertCategoryAssignable(
    tax_category_id: number | null | undefined,
  ): Promise<void> {
    if (tax_category_id === null || tax_category_id === undefined) return;
    const store_id = this.requireStoreId();
    const db = this.prisma.withoutScope();
    const issuer = await this.readIssuerContext(db, store_id);

    const category = (await db.tax_categories.findFirst({
      where: { id: tax_category_id, ...this.categoryScopeWhere(store_id, issuer) },
      select: SHIPPING_TAX_CATEGORY_SELECT,
    })) as CategoryRow | null;
    if (!category) {
      throw new VendixHttpException(
        ErrorCodes.CAT_FIND_001,
        'La categoría de impuesto no existe en esta tienda',
        { tax_category_id },
      );
    }

    const evaluation = evaluateShippingTaxCategory(category);
    if (!evaluation.eligible) {
      throw new VendixHttpException(
        ErrorCodes.SHIP_VALIDATE_001,
        `La categoría "${category.name}" no se puede usar en el envío: ${evaluation.reason}`,
        { tax_category_id, reason: evaluation.reason_code },
      );
    }
    if (evaluation.tax_type === 'iva') {
      assertCanChargeVat(issuer?.fiscal_data ?? null, 'shipping');
    }
    if (evaluation.tax_type === 'inc') {
      assertCanChargeInc(issuer?.fiscal_data ?? null, 'shipping');
    }
  }

  /** Opciones del selector de impuesto del wizard de tarifas. */
  async getRateTaxOptions(): Promise<ShippingRateTaxOptions> {
    const store_id = this.requireStoreId();
    const db = this.prisma.withoutScope();
    const issuer = await this.readIssuerContext(db, store_id);

    const rows = (await db.tax_categories.findMany({
      where: this.categoryScopeWhere(store_id, issuer),
      select: SHIPPING_TAX_CATEGORY_SELECT,
      orderBy: { name: 'asc' },
    })) as CategoryRow[];

    const vat_responsible = isVatResponsible(issuer?.fiscal_data ?? null);
    const inc_responsible = isIncResponsible(issuer?.fiscal_data ?? null);
    const is_restaurant = storeIsRestaurant(issuer?.industries ?? null);

    const categories: ShippingRateTaxOptions['categories'] = rows.map((row) => {
      const evaluation = evaluateShippingTaxCategory(row);
      // Pista de preselección para tarifas nuevas; nunca entra al cálculo.
      const is_inclusive = row.is_inclusive ?? null;
      if (!evaluation.eligible) {
        return {
          id: row.id,
          name: row.name,
          tax_type: evaluation.tax_type,
          rate_percent: evaluation.rate_percent,
          eligible: false,
          reason: evaluation.reason,
          is_inclusive,
        };
      }
      if (evaluation.tax_type === 'iva' && !vat_responsible) {
        return {
          id: row.id,
          name: row.name,
          tax_type: 'iva',
          rate_percent: evaluation.rate_percent,
          eligible: false,
          reason:
            'Tu RUT no declara la responsabilidad O-48 (IVA). Completa tu configuración fiscal para cobrar IVA en el envío.',
          is_inclusive,
        };
      }
      if (evaluation.tax_type === 'inc' && !inc_responsible) {
        return {
          id: row.id,
          name: row.name,
          tax_type: 'inc',
          rate_percent: evaluation.rate_percent,
          eligible: false,
          reason:
            'Tu RUT no declara la responsabilidad O-33 (INC). Completa tu configuración fiscal para cobrar INC en el envío.',
          is_inclusive,
        };
      }
      return {
        id: row.id,
        name: row.name,
        tax_type: evaluation.tax_type,
        rate_percent: evaluation.rate_percent,
        eligible: true,
        is_inclusive,
      };
    });

    const warnings: string[] = [];

    const options: ShippingRateTaxOptions = {
      categories,
      issuer: { vat_responsible, inc_responsible, is_restaurant },
    };
    if (is_restaurant && inc_responsible) {
      const firstInc = categories.find((c) => c.eligible && c.tax_type === 'inc');
      options.suggestion = {
        tax_type: 'inc',
        category_id: firstInc?.id ?? null,
        message: SHIPPING_INC_RESTAURANT_SUGGESTION,
      };
    }
    if (warnings.length > 0) options.warnings = warnings;
    return options;
  }

  /**
   * Proyección pública de la categoría de una tarifa para las lecturas
   * (`GET :zoneId/rates`, create/update). Categoría no elegible (p. ej. se le
   * añadió otra tasa después) ⇒ se sigue mostrando, con el tipo resuelto y la
   * tasa única si la hay; `rate_percent` 0 si no hay una sola.
   */
  static toTaxCategoryView(
    category: CategoryRow | null | undefined,
  ): ShippingRateTaxCategoryView | null {
    if (!category) return null;
    // `evaluation.tax_type` ya viene resuelto en la fila de origen: sin tipo ⇒
    // 'iva'; cualquier otro tipo se muestra tal cual (y sigue no elegible).
    const evaluation = evaluateShippingTaxCategory(category);
    return {
      id: category.id,
      name: category.name,
      tax_type: evaluation.tax_type,
      rate_percent: evaluation.rate_percent ?? 0,
    };
  }

  // ========== INTERNOS ==========

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  /**
   * Alcance de categorías igual que `TaxesService.findAll`: bajo
   * `fiscal_scope=ORGANIZATION` las categorías son de la org (`store_id=null`);
   * si no, de la tienda.
   */
  private categoryScopeWhere(
    store_id: number,
    issuer: IssuerContext | null,
  ): Prisma.tax_categoriesWhereInput {
    if (issuer?.fiscal_scope === 'ORGANIZATION' && issuer.organization_id) {
      return { organization_id: issuer.organization_id, store_id: null };
    }
    return { store_id };
  }

  private categoryInScope(
    category: CategoryRow,
    store_id: number,
    issuer: IssuerContext | null,
  ): boolean {
    if (issuer?.fiscal_scope === 'ORGANIZATION' && issuer.organization_id) {
      return (
        category.store_id === null &&
        category.organization_id === issuer.organization_id
      );
    }
    return category.store_id === store_id;
  }

  /**
   * `fiscal_data` del emisor con el alcance fiscal de la organización (mismo
   * criterio que `SettingsService.getFiscalData`), leído con el cliente
   * recibido para no depender del contexto de request (webhooks, jobs).
   */
  private async readIssuerContext(
    db: ShippingTaxDbClient,
    store_id: number,
  ): Promise<IssuerContext | null> {
    const store = await db.stores.findFirst({
      where: { id: store_id },
      select: {
        organization_id: true,
        industries: true,
        store_settings: { select: { settings: true } },
        organizations: {
          select: {
            fiscal_scope: true,
            organization_settings: { select: { settings: true } },
          },
        },
      },
    });
    if (!store) return null;
    const fiscal_scope =
      store.organizations?.fiscal_scope === 'ORGANIZATION'
        ? 'ORGANIZATION'
        : 'STORE';
    const settings =
      fiscal_scope === 'ORGANIZATION'
        ? store.organizations?.organization_settings?.settings
        : store.store_settings?.settings;
    const fiscal_data =
      ((settings as Record<string, unknown> | null)?.fiscal_data as
        | VatFiscalDataInput
        | undefined) ?? null;
    return {
      organization_id: store.organization_id ?? null,
      fiscal_scope,
      fiscal_data,
      industries: (store.industries as string[] | null) ?? [],
    };
  }
}
