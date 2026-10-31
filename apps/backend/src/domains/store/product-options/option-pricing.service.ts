import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { ProductOptionsService } from './product-options.service';

/** Snapshot congelado que se guarda en `order_item_options`. */
export interface OrderItemOptionSnapshot {
  option_id: number;
  group_name: string;
  option_name: string;
  scope: 'per_unit' | 'per_line';
  price_delta: Prisma.Decimal;
  component_type: 'ingredient' | 'recipe' | 'product';
  component_product_id: number;
  component_variant_id: number | null;
  quantity: Prisma.Decimal;
  uom: string | null;
}

export interface ResolvedOptions {
  /** Suma a aplicar sobre el precio UNITARIO de la línea. */
  unit_price_delta: Prisma.Decimal;
  snapshots: OrderItemOptionSnapshot[];
}

interface GroupRules {
  id: number;
  name: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  scope: 'per_unit' | 'per_line';
  options: Array<{
    id: number;
    name: string;
    price_delta: Prisma.Decimal;
    component_type: 'ingredient' | 'recipe' | 'product';
    component_product_id: number;
    component_variant_id: number | null;
    quantity: Prisma.Decimal;
    uom: string | null;
  }>;
}

const EMPTY: ResolvedOptions = { unit_price_delta: new Prisma.Decimal(0), snapshots: [] };

/** Mensaje de la regla que falla, igual al que ve el cajero en el selector. */
function minMessage(group: GroupRules, min: number): string {
  return `Elige ${min} ${min === 1 ? 'opción' : 'opciones'} en ${group.name}`;
}

/**
 * Núcleo puro: valida la selección contra las reglas de los grupos y calcula
 * el delta. El cliente solo envía ids; el precio lo calcula el servidor.
 * `per_line` reparte su precio en el unitario: la suma de las opciones por
 * línea ÷ cantidad, redondeada al centavo hacia arriba para que la línea
 * nunca cobre menos que el precio configurado (exacto con cantidad 1).
 */
export function resolveOptionSelection(
  groups: GroupRules[],
  option_ids: number[],
  line_quantity: number,
): ResolvedOptions {
  if (new Set(option_ids).size !== option_ids.length) {
    throw new VendixHttpException(ErrorCodes.OPT_SELECTION_INVALID, 'Una adición está repetida.');
  }
  const byOption = new Map<number, { group: GroupRules; option: GroupRules['options'][number] }>();
  for (const group of groups) {
    for (const option of group.options) byOption.set(option.id, { group, option });
  }
  for (const id of option_ids) {
    if (!byOption.has(id)) {
      throw new VendixHttpException(
        ErrorCodes.OPT_SELECTION_INVALID,
        'Una de las adiciones elegidas no está disponible para este producto.',
      );
    }
  }

  let unit = new Prisma.Decimal(0);
  let per_line_total = new Prisma.Decimal(0);
  const quantity = Math.max(1, line_quantity);
  const snapshots: OrderItemOptionSnapshot[] = [];

  for (const group of groups) {
    const chosen = group.options.filter((o) => option_ids.includes(o.id));
    const min = group.is_required ? Math.max(1, group.min_select) : group.min_select;
    if (chosen.length < min) {
      throw new VendixHttpException(ErrorCodes.OPT_SELECTION_INVALID, minMessage(group, min));
    }
    if (chosen.length > group.max_select) {
      throw new VendixHttpException(
        ErrorCodes.OPT_SELECTION_INVALID,
        `Puedes elegir máximo ${group.max_select} en ${group.name}`,
      );
    }
    for (const option of chosen) {
      const delta = new Prisma.Decimal(option.price_delta);
      if (group.scope === 'per_line') per_line_total = per_line_total.add(delta);
      else unit = unit.add(delta);
      snapshots.push({
        option_id: option.id,
        group_name: group.name,
        option_name: option.name,
        scope: group.scope,
        price_delta: delta,
        component_type: option.component_type,
        component_product_id: option.component_product_id,
        component_variant_id: option.component_variant_id,
        quantity: new Prisma.Decimal(option.quantity),
        uom: option.uom,
      });
    }
  }

  const per_line_unit = per_line_total.div(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_CEIL);
  return { unit_price_delta: unit.add(per_line_unit).toDecimalPlaces(2), snapshots };
}

@Injectable()
export class OptionPricingService {
  constructor(private readonly productOptions: ProductOptionsService) {}

  /**
   * Resuelve la selección de una línea. Sin ids y sin grupos obligatorios →
   * sin cambios (flujo de hoy). Con el ajuste apagado e ids enviados →
   * OPT_DISABLED.
   *
   * Las adiciones solo se venden en pedidos programados (`scheduled`): su
   * insumo y su costo se registran al pasar a producción, y una venta
   * normal no tiene ese paso. Sin agendamiento, ids enviados →
   * OPT_REQUIRES_SCHEDULE; sin ids el producto se vende solo, aunque tenga
   * grupos obligatorios. Un borrador (`draft`) guarda las adiciones elegidas
   * sin agendamiento (no cobra ni descuenta); se agenda al cobrarlo.
   */
  async resolve(
    store_id: number,
    product_id: number | null | undefined,
    option_ids: number[] | undefined,
    line_quantity: number,
    options: { scheduled: boolean; draft?: boolean; client?: Prisma.TransactionClient },
  ): Promise<ResolvedOptions> {
    const ids = option_ids ?? [];
    const { scheduled, draft, client } = options;
    if (!product_id) {
      if (ids.length) throw new VendixHttpException(ErrorCodes.OPT_SELECTION_INVALID);
      return EMPTY;
    }
    const enabled = await this.productOptions.isEnabled(store_id);
    if (!enabled) {
      if (ids.length) throw new VendixHttpException(ErrorCodes.OPT_DISABLED);
      return EMPTY;
    }
    if (!scheduled) {
      if (!ids.length) return EMPTY;
      if (!draft) throw new VendixHttpException(ErrorCodes.OPT_REQUIRES_SCHEDULE);
    }
    const groups = (await this.productOptions.applicableForProduct(store_id, product_id, {
      withCost: false,
      client,
    })) as unknown as GroupRules[];
    if (!groups.length && !ids.length) return EMPTY;
    return resolveOptionSelection(groups, ids, line_quantity);
  }
}
