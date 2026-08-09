import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CloseKdsSessionDto, OpenKdsSessionDto } from '../dto';

/**
 * KdsSessionsService — turnos de estación (QUI-651).
 *
 * Espejo de `cash-registers/sessions`, con una diferencia sustantiva: la sesión
 * de caja custodia DINERO, la de KDS custodia RESPONSABILIDAD SOBRE EL CONSUMO
 * DE INSUMOS. En el KDS se consume inventario real y se genera COGS, así que
 * para que ese consumo sea contabilizable por persona el movimiento queda atado
 * a la sesión y no solo a quien pidió el fire.
 *
 * Convención de caja respetada: la sesión se exige AL ACTUAR, no al entrar. El
 * tablero se lee sin sesión abierta — leer no genera dato que necesite dueño.
 */
@Injectable()
export class KdsSessionsService {
  constructor(private prisma: StorePrismaService) {}

  private requireContext(): { storeId: number; userId: number } {
    const ctx = RequestContextService.getContext();
    if (!ctx?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    if (!ctx.user_id) {
      // La sesión necesita un operador responsable: es todo su propósito.
      // Un diner anónimo por QR nunca debe poder reclamar una estación.
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    return { storeId: ctx.store_id, userId: ctx.user_id };
  }

  /** Sesión abierta de una estación, o null. Lo consulta el fire y la UI. */
  async findOpenByKds(kdsId: number) {
    return this.prisma.kds_sessions.findFirst({
      where: { kds_id: kdsId, status: 'open' },
      include: {
        opened_by_user: { select: { id: true, first_name: true, last_name: true } },
      },
    });
  }

  async findAll(kdsId?: number) {
    return this.prisma.kds_sessions.findMany({
      where: { ...(kdsId != null && { kds_id: kdsId }) },
      orderBy: { opened_at: 'desc' },
      take: 100,
      include: {
        kds: { select: { id: true, name: true, code: true } },
        opened_by_user: { select: { id: true, first_name: true, last_name: true } },
        closed_by_user: { select: { id: true, first_name: true, last_name: true } },
      },
    });
  }

  /**
   * Abre la sesión. La sesión RECLAMA la estación: una sola abierta por KDS.
   *
   * El guard de aplicación existe para dar un error legible, pero la garantía
   * real es el índice único parcial `kds_sessions_one_open_per_kds`: dos
   * operadores concurrentes pasarían ambos este chequeo y dejarían la estación
   * con dos dueños. Por eso el P2002 se traduce, no se propaga crudo.
   */
  async open(dto: OpenKdsSessionDto) {
    const { storeId, userId } = this.requireContext();

    const station = await this.prisma.kds.findFirst({
      where: { id: dto.kds_id, is_active: true },
      select: { id: true },
    });
    if (!station) throw new VendixHttpException(ErrorCodes.KDS_NOT_FOUND);

    const already = await this.findOpenByKds(dto.kds_id);
    if (already) {
      throw new VendixHttpException(ErrorCodes.KDS_SESSION_ALREADY_OPEN);
    }

    try {
      return await this.prisma.kds_sessions.create({
        data: {
          kds_id: dto.kds_id,
          store_id: storeId,
          opened_by: userId,
          status: 'open',
          opened_at: new Date(),
          updated_at: new Date(),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.KDS_SESSION_ALREADY_OPEN);
      }
      throw e;
    }
  }

  /**
   * Cierra la sesión y persiste el RESUMEN DEL TURNO como snapshot inmutable,
   * igual que caja: mientras está abierta el resumen se calcula en vivo, al
   * cerrar se congela en `summary` y no vuelve a cambiar.
   */
  async close(sessionId: number, dto: CloseKdsSessionDto) {
    const { storeId, userId } = this.requireContext();

    const session = await this.prisma.kds_sessions.findFirst({
      where: { id: sessionId },
    });
    if (!session) throw new VendixHttpException(ErrorCodes.KDS_SESSION_NOT_FOUND);
    if (session.status === 'closed') {
      throw new VendixHttpException(ErrorCodes.KDS_SESSION_ALREADY_CLOSED);
    }

    const summary = await this.buildConsumptionSummary(sessionId);

    await this.prisma.kds_sessions.updateMany({
      where: { id: sessionId, store_id: storeId },
      data: {
        status: 'closed',
        closed_at: new Date(),
        closed_by: userId,
        closing_notes: dto.closing_notes ?? null,
        summary: summary as any,
        updated_at: new Date(),
      },
    });

    return this.prisma.kds_sessions.findFirst({ where: { id: sessionId } });
  }

  /**
   * (a) HISTORIAL de consumos — una fila por insumo POR PEDIDO.
   *
   * Es una consulta sobre `inventory_transactions` filtrada por
   * `kds_session_id`. El costo sale de las columnas `unit_cost`/`total_cost` que
   * QUI-651 agregó: antes el costo por movimiento no existía en ninguna parte
   * joineable — no estaba en inventory_transactions ni en inventory_movements, y
   * el `total_value` de inventory_valuation_snapshots es el valor del stock
   * ON-HAND posterior al movimiento, no el costo de lo consumido.
   */
  async getConsumptionHistory(sessionId: number) {
    const rows = await this.prisma.inventory_transactions.findMany({
      where: { kds_session_id: sessionId },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        created_at: true,
        quantity_change: true,
        unit_cost: true,
        total_cost: true,
        products: { select: { id: true, name: true, sku: true } },
        order_items: {
          select: {
            id: true,
            product_name: true,
            order_id: true,
            orders: { select: { id: true, order_number: true } },
          },
        },
      },
    });

    return rows.map((r) => ({
      transaction_id: r.id,
      consumed_at: r.created_at,
      // El fire registra el consumo como cantidad NEGATIVA. Se expone en
      // positivo porque la vista es "cuánto se consumió", no "cuánto varió".
      quantity: Math.abs(r.quantity_change),
      unit_cost: r.unit_cost,
      total_cost: r.total_cost,
      ingredient: r.products,
      // El plato que originó el consumo, vía el order_item del fire.
      dish_name: r.order_items?.product_name ?? null,
      order_id: r.order_items?.order_id ?? null,
      order_number: r.order_items?.orders?.order_number ?? null,
    }));
  }

  /**
   * (b) RESUMEN de consumos — una fila por insumo, colapsando todos los pedidos.
   *
   * Se agrega en memoria y no con `groupBy` de Prisma porque hace falta el
   * nombre del insumo junto al agregado, y `groupBy` no admite include: pedirlo
   * obligaría a una segunda consulta y a re-unir a mano lo mismo.
   */
  async buildConsumptionSummary(sessionId: number) {
    const history = await this.getConsumptionHistory(sessionId);

    const byIngredient = new Map<
      number,
      { product_id: number; name: string; sku: string | null; quantity: number; total_cost: number }
    >();

    for (const row of history) {
      const id = row.ingredient?.id;
      if (id == null) continue;
      const acc = byIngredient.get(id) ?? {
        product_id: id,
        name: row.ingredient!.name,
        sku: row.ingredient!.sku ?? null,
        quantity: 0,
        total_cost: 0,
      };
      acc.quantity += row.quantity;
      acc.total_cost += Number(row.total_cost ?? 0);
      byIngredient.set(id, acc);
    }

    const ingredients = [...byIngredient.values()].sort(
      (a, b) => b.total_cost - a.total_cost,
    );

    return {
      movement_count: history.length,
      distinct_ingredients: ingredients.length,
      total_cost: ingredients.reduce((s, i) => s + i.total_cost, 0),
      ingredients,
    };
  }
}
