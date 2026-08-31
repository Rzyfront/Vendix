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
        // La estación va incluida porque la UI nombra el turno con ella. Sin esto
        // `session.kds` llega undefined y la pantalla muestra "Estación" genérico,
        // que es justo el dato que el turno existe para identificar.
        kds: { select: { id: true, name: true, code: true } },
        opened_by_user: { select: { id: true, first_name: true, last_name: true } },
      },
    });
  }

  async findAll(kdsId?: number) {
    const sessions = await this.prisma.kds_sessions.findMany({
      where: { ...(kdsId != null && { kds_id: kdsId }) },
      orderBy: { opened_at: 'desc' },
      take: 100,
      include: {
        kds: { select: { id: true, name: true, code: true } },
        opened_by_user: { select: { id: true, first_name: true, last_name: true } },
        closed_by_user: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    return sessions.map((s) => ({ ...s, summary: this.stripSummaryCost(s.summary) }));
  }

  /**
   * ADR-10: el KDS nunca muestra dinero. El snapshot `summary` persistido al
   * cerrar un turno ANTES de esta regla puede traer `total_cost`/`unit_cost` en
   * su JSON. Al servirlo se proyecta sin dinero: se conservan las cantidades por
   * insumo y se descartan las claves de costo. No borra nada en base — solo deja
   * de enviarlas en el payload.
   */
  private stripSummaryCost(summary: any): any {
    if (!summary || typeof summary !== 'object') return summary;
    const clean = { ...summary };
    delete clean.total_cost;
    if (Array.isArray(clean.ingredients)) {
      clean.ingredients = clean.ingredients.map((i: any) => {
        if (!i || typeof i !== 'object') return i;
        const copy = { ...i };
        delete copy.total_cost;
        delete copy.unit_cost;
        return copy;
      });
    }
    return clean;
  }

  /**
   * Abre la sesión. La sesión RECLAMA la estación: una sola abierta por KDS.
   *
   * El guard de aplicación existe para dar un error legible, pero la garantía
   * real es el índice único parcial `kds_sessions_one_open_per_kds`: dos
   * operadores concurrentes pasarían ambos este chequeo y dejarían la estación
   * con dos dueños. Por eso el P2002 se traduce, no se propaga crudo.
   *
   * QUI-760 — BACKFILL en la misma transacción: al abrir turno se RECLAMAN los
   * `inventory_transactions` previos cuyo `kds_session_id` quedó NULL porque
   * el fire ocurrió antes de que el operador abriera sesión. Si no se hacen
   * aquí, `close()` los ignora para siempre (su `buildConsumptionSummary`
   * filtra por `kds_session_id = sessionId`) y el cocinero firma consumo que
   * nunca aparece en su turno. El `updateMany` corre dentro del MISMO
   * `prisma.$transaction` que el `create`, así que un fallo en el backfill
   * también aborta la apertura — no hay sesión huérfana.
   *
   * Filtros:
   *  - `kds_session_id IS NULL`: la razón de existir del backfill.
   *  - `order_item_id IS NOT NULL` + `inventory_consumed_at_fire=true`: solo el
   *    consumo disparado al fire; las ventas, ajustes y transferencias no
   *    son elegibles.
   *  - Routing KDS: el mismo patrón que `kitchen-fire.service.ts:668-680` —
   *    cada `inventory_transaction` se imputa a `products.kds_id ?? defaultKds`.
   *    Si esta sesión es el defaultKds de la tienda, los productos SIN `kds_id`
   *    propio le pertenecen; si es OTRA estación, solo los productos con
   *    `products.kds_id = dto.kds_id`.
   *  - `kitchen_tickets.status NOT IN ('delivered','cancelled')`. Un ticket ya
   *    entregado/cancelado NO entra — el consumo ya pasó, firmarlo a
   *    posteriori inventaría responsabilidad donde no la hay.
   *  - `store_id` por tienda: filtramos por `orders.store_id` directamente,
   *    y Prisma aplica también el relational scope de
   *    `inventory_transactions` por `products.store_id`. Defensa en
   *    profundidad: una sesión en tienda A jamás estampa filas de tienda B
   *    (criterio 7 de QUI-760).
   *
   * Implementación: dos pasos dentro de la MISMA tx para evitar el nested
   * filter `inventory_transactions.where.order_items` (Prisma lo rechaza
   * porque el back-relation desde `order_items` se llama
   * `inventory_transactions[]` y el forward se llama `order_items?` — el
   * `updateMany` solo conoce los argumentos directos). Primero se resuelve
   * la lista de `order_items` candidatos por la relación `inventory_transactions`
   * desde el lado donde Prisma SÍ la expone, después se hace
   * `inventory_transactions.updateMany({ where: { order_item_id: { in } } })`.
   * La condición `kds_session_id IS NULL` se repite en los dos pasos para
   * asegurar idempotencia (una transacción candidata estampada por otra
   * sesión ya no cuenta).
   *
   * Los 45 huérfanos históricos del ticket no se tocan — están en tickets
   * entregados/cancelados y dejarán de aparecer por el filtro, no por una
   * migración retroactiva.
   *
   * Los 45 huérfanos históricos del ticket no se tocan — están en tickets
   * entregados/cancelados y dejarán de aparecer por el filtro, no por una
   * migración retroactiva.
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
      return await this.prisma.$transaction(async (tx) => {
        const session = await tx.kds_sessions.create({
          data: {
            kds_id: dto.kds_id,
            store_id: storeId,
            opened_by: userId,
            status: 'open',
            opened_at: new Date(),
            updated_at: new Date(),
          },
        });

        // Mismo routing que `kitchen-fire.service.ts:668-680`: producto con
        // `kds_id` propio va a esa estación; producto sin `kds_id` va al
        // default de su tienda. Si esta sesión es el default, los productos
        // huérfanos de KDS también le pertenecen.
        const defaultStation = await tx.kds.findFirst({
          where: { store_id: storeId, is_default: true, is_active: true },
          select: { id: true },
        });
        const isDefaultSession = defaultStation?.id === dto.kds_id;

        // Resolver candidatos por el lado de `order_items`, donde Prisma SÍ
        // expone la relación `inventory_transactions`. La guarda `some:
        // { kds_session_id: null }` ya descarta filas con sesión atribuida
        // por una apertura anterior.
        const candidateOis = await tx.order_items.findMany({
          where: {
            inventory_consumed_at_fire: true,
            orders: { store_id: storeId },
            inventory_transactions: { some: { kds_session_id: null } },
            kitchen_ticket_items: {
              some: {
                kitchen_ticket: {
                  status: { notIn: ['delivered', 'cancelled'] },
                },
              },
            },
            ...(isDefaultSession
              ? // defaultKds: productos mapeados a esta + productos huérfanos
                { OR: [{ products: { kds_id: dto.kds_id } }, { products: { kds_id: null } }] }
              : { products: { kds_id: dto.kds_id } }),
          },
          select: { id: true },
        });

        const oiIds = candidateOis.map((o) => o.id);
        if (oiIds.length > 0) {
          await tx.inventory_transactions.updateMany({
            where: {
              order_item_id: { in: oiIds },
              // Doble guarda: si otra tx estampó estas filas entre el
              // findMany y el updateMany, el `IS NULL` las preserva.
              kds_session_id: null,
            },
            data: { kds_session_id: session.id },
          });
        }

        return session;
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
   * `kds_session_id`. ADR-10: el KDS nunca muestra dinero. El historial expone
   * SOLO cantidades por insumo; `unit_cost`/`total_cost` no se proyectan (vivían
   * en las columnas que QUI-651 agregó, pero esa información pertenece a la capa
   * de contabilidad/reportes, nunca a la superficie de cocina).
   */
  async getConsumptionHistory(sessionId: number) {
    const rows = await this.prisma.inventory_transactions.findMany({
      where: { kds_session_id: sessionId },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        created_at: true,
        quantity_change: true,
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
      ingredient: r.products,
      // El plato que originó el consumo, vía el order_item del fire.
      dish_name: r.order_items?.product_name ?? null,
      order_id: r.order_items?.order_id ?? null,
      order_number: r.order_items?.orders?.order_number ?? null,
    }));
  }

  /**
   * REPORTE de consumo de insumos por estación, agregable por KDS y por rango de
   * fechas. QUI-651.
   *
   * Se apoya en la misma fuente que las dos vistas por sesión — no hay una
   * segunda verdad. Filtra por `kds_session_id IN (sesiones que cumplen el
   * criterio)` en vez de por fecha del movimiento, y esa distinción es
   * deliberada: el turno es la unidad de responsabilidad. Un movimiento
   * disparado a las 00:30 pertenece al turno que estaba abierto, no al día
   * calendario en que cayó su timestamp — el mismo razonamiento que la fecha de
   * negocio del ticket con su hora de corte.
   *
   * Los movimientos con `kds_session_id = NULL` quedan FUERA por construcción, y
   * eso es correcto: son consumo sin dueño de turno. Se reportan aparte con
   * `getUnattributedConsumption`, porque esconderlos haría que el reporte
   * pareciera cuadrar cuando no cuadra.
   */
  async getConsumptionReport(params: {
    kds_id?: number;
    from?: Date;
    to?: Date;
  }) {
    const sessions = await this.prisma.kds_sessions.findMany({
      where: {
        ...(params.kds_id != null && { kds_id: params.kds_id }),
        ...((params.from || params.to) && {
          opened_at: {
            ...(params.from && { gte: params.from }),
            ...(params.to && { lte: params.to }),
          },
        }),
      },
      select: {
        id: true,
        kds_id: true,
        opened_at: true,
        closed_at: true,
        status: true,
        kds: { select: { id: true, name: true, code: true } },
      },
      orderBy: { opened_at: 'asc' },
    });

    if (sessions.length === 0) {
      return { sessions: [], by_station: [] };
    }

    // Un solo barrido de movimientos para todo el rango: consultar por sesión
    // haría N consultas donde una alcanza, y un mes de turnos son decenas.
    const rows = await this.prisma.inventory_transactions.findMany({
      where: { kds_session_id: { in: sessions.map((s) => s.id) } },
      select: {
        kds_session_id: true,
        quantity_change: true,
        products: { select: { id: true, name: true, sku: true } },
      },
    });

    // Tipo explícito: con el `??` de fallback, TS ensancha el valor del Map a
    // `{}` y todos los accesos a `.id`/`.name` fallan.
    type StationRef = { id: number; name: string; code: string };
    const stationBySession = new Map<number, StationRef>(
      sessions.map((s) => [
        s.id,
        (s.kds ?? { id: s.kds_id, name: '—', code: '—' }) as StationRef,
      ]),
    );

    const byStation = new Map<
      number,
      {
        kds_id: number;
        name: string;
        code: string;
        session_count: number;
        movement_count: number;
        ingredients: Map<number, { product_id: number; name: string; sku: string | null; quantity: number }>;
      }
    >();

    for (const s of sessions) {
      const station = stationBySession.get(s.id)!;
      const acc = byStation.get(station.id) ?? {
        kds_id: station.id,
        name: station.name,
        code: station.code,
        session_count: 0,
        movement_count: 0,
        ingredients: new Map(),
      };
      acc.session_count += 1;
      byStation.set(station.id, acc);
    }

    for (const r of rows) {
      const station = stationBySession.get(r.kds_session_id!);
      if (!station) continue;
      const acc = byStation.get(station.id);
      if (!acc || !r.products) continue;

      acc.movement_count += 1;

      const ing = acc.ingredients.get(r.products.id) ?? {
        product_id: r.products.id,
        name: r.products.name,
        sku: r.products.sku ?? null,
        quantity: 0,
      };
      // El consumo se registra negativo; se expone en positivo porque la vista es
      // "cuánto se consumió", no "cuánto varió el stock".
      ing.quantity += Math.abs(r.quantity_change);
      acc.ingredients.set(r.products.id, ing);
    }

    // ADR-10: el reporte de consumo de cocina es SOLO cantidades. Sin totales
    // monetarios — el costo pertenece a la capa de contabilidad/reportes, nunca
    // a una superficie que el rol `cocina` puede leer.
    const by_station = [...byStation.values()]
      .map((s) => ({
        ...s,
        ingredients: [...s.ingredients.values()].sort(
          (a, b) => b.quantity - a.quantity,
        ),
      }))
      .sort((a, b) => b.movement_count - a.movement_count);

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        kds: s.kds,
        opened_at: s.opened_at,
        closed_at: s.closed_at,
        status: s.status,
      })),
      by_station,
    };
  }

  /**
   * Consumo SIN sesión atribuida: movimientos del fire cuya estación no tenía
   * turno abierto al disparar. Es un caso válido y decidido (el fire nunca se
   * bloquea), pero tiene que ser visible: si se omitiera, el reporte por
   * estación parecería cuadrar contra el COGS total cuando no cuadra.
   */
  async getUnattributedConsumption(params: { from?: Date; to?: Date }) {
    const rows = await this.prisma.inventory_transactions.findMany({
      where: {
        kds_session_id: null,
        // Solo consumo de cocina: el resto de los movimientos sin sesión son
        // ventas, ajustes y transferencias, que nunca tuvieron estación.
        order_item_id: { not: null },
        order_items: { inventory_consumed_at_fire: true },
        ...((params.from || params.to) && {
          created_at: {
            ...(params.from && { gte: params.from }),
            ...(params.to && { lte: params.to }),
          },
        }),
      },
      select: {
        id: true,
        created_at: true,
        quantity_change: true,
        products: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    // ADR-10: sin dinero en el payload de cocina.
    return {
      movement_count: rows.length,
      movements: rows.map((r) => ({
        transaction_id: r.id,
        consumed_at: r.created_at,
        quantity: Math.abs(r.quantity_change),
        ingredient: r.products,
      })),
    };
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
      { product_id: number; name: string; sku: string | null; quantity: number }
    >();

    for (const row of history) {
      const id = row.ingredient?.id;
      if (id == null) continue;
      const acc = byIngredient.get(id) ?? {
        product_id: id,
        name: row.ingredient!.name,
        sku: row.ingredient!.sku ?? null,
        quantity: 0,
      };
      acc.quantity += row.quantity;
      byIngredient.set(id, acc);
    }

    // ADR-10: el resumen del turno es SOLO cantidades por insumo. Sin totales
    // monetarios — el costo no viaja a la superficie de cocina.
    const ingredients = [...byIngredient.values()];

    return {
      movement_count: history.length,
      distinct_ingredients: ingredients.length,
      ingredients,
    };
  }
}
