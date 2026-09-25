import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import {
  buildRefundCoverageLedger,
  REFUND_LEDGER_STATES,
} from './refund-calculation.service';

/**
 * CP-REFUND-FLOW-REDESIGN paso 7 — cobertura refund↔NC por línea.
 *
 * La verdad de `refunded_*` es el ledger unificado de `refund_items`
 * (estados LEDGER — misma semántica que el caché `order_items.*` del
 * paso 3, nunca re-derivada acá). La verdad de `nc_covered_*` es el
 * puente estructural `credit_note_refund_items`, y sólo cuenta la NC
 * `accepted`: una `draft` aún no acreditó un peso (mismo criterio que el
 * saldo acreditable en `credit-notes.service.ts`).
 *
 * Ningún UPDATE toca documentos emitidos: este servicio es lectura pura.
 * Lo consumen el aviso FE→NC del paso 8 y la sección Reembolsos del
 * ticket del paso 9.
 */

/** Estados cuyo dinero está comprometido: candidatos a sugerir NC. */
// M2 fix-forward: el conjunto vive exportado como `REFUND_LEDGER_STATES`
// (idéntico al techo del paso 1); se reutiliza en vez de replicarlo.
const NC_SUGGESTIBLE_STATES: readonly string[] = REFUND_LEDGER_STATES;

export interface RefundCoverageLineNote {
  credit_note_id: number;
  invoice_number: string | null;
  status: string;
  covered_qty: number;
  covered_amount: number;
}

export interface RefundCoverageLine {
  order_item_id: number;
  product_name: string | null;
  quantity: number;
  refunded_qty: number;
  refunded_amount: number;
  nc_covered_qty: number;
  nc_covered_amount: number;
  notes: RefundCoverageLineNote[];
}

export interface RefundCoverageFeNotice {
  related_invoice_id: number;
  invoice_number: string | null;
  message: string;
  suggested_refund_ids: number[];
  uncovered_order_item_ids: number[];
}

export interface RefundCoverageResult {
  order_id: number;
  lines: RefundCoverageLine[];
  totals: {
    refunded_qty: number;
    refunded_amount: number;
    nc_covered_qty: number;
    nc_covered_amount: number;
  };
  fe_notice: RefundCoverageFeNotice | null;
}

@Injectable()
export class RefundCoverageService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getCoverage(order_id: number): Promise<RefundCoverageResult> {
    // Mismo contrato que `getOrderRefunds`: orden ajena = 404, no 403.
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException(`Order #${order_id} not found`);
    }

    const [order_items, refunds] = await Promise.all([
      this.prisma.order_items.findMany({
        where: { order_id },
        select: {
          id: true,
          product_name: true,
          quantity: true,
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.refunds.findMany({
        // M2 fix-forward: solo estados LEDGER — un refund `failed` con
        // ítems persistidos no debe marcar cobertura (mismo filtro que
        // `calculate` con techo pendiente-aware).
        where: { order_id, state: { in: [...REFUND_LEDGER_STATES] } },
        select: {
          id: true,
          state: true,
          refund_items: {
            select: {
              id: true,
              order_item_id: true,
              quantity: true,
              refund_amount: true,
            },
          },
        },
      }),
    ]);

    // Ledger unificado (estados LEDGER, ya filtrados en el query; el
    // builder re-filtra por construcción): la única agregación, sin
    // re-derivar nada en este archivo.
    const ledger = buildRefundCoverageLedger(refunds);

    const refund_item_ids = refunds.flatMap((r) =>
      r.refund_items.map((ri) => ri.id),
    );
    // `withoutScope()` + ids ya verificados: el puente no está registrado
    // en `StorePrismaService` (ese archivo quedó fuera del scope de este
    // paso) y no necesita estarlo — los ids salen de lecturas scopeadas,
    // así que la consulta va anclada al tenant por construcción.
    const bridge_rows =
      refund_item_ids.length > 0
        ? await this.prisma.withoutScope().credit_note_refund_items.findMany({
            where: { refund_item_id: { in: refund_item_ids } },
            include: {
              credit_note: {
                select: { id: true, invoice_number: true, status: true },
              },
            },
          })
        : [];

    const refund_item_order_item = new Map<number, number>();
    for (const r of refunds) {
      for (const ri of r.refund_items) {
        refund_item_order_item.set(ri.id, ri.order_item_id);
      }
    }

    const notes_by_line = new Map<number, RefundCoverageLineNote[]>();
    const covered_by_line = new Map<
      number,
      { qty: number; amount: number }
    >();
    for (const row of bridge_rows) {
      const order_item_id = refund_item_order_item.get(row.refund_item_id);
      if (order_item_id == null) continue;
      const list = notes_by_line.get(order_item_id) ?? [];
      list.push({
        credit_note_id: row.credit_note.id,
        invoice_number: row.credit_note.invoice_number,
        status: row.credit_note.status,
        covered_qty: row.covered_qty,
        covered_amount: Number(row.covered_amount ?? 0),
      });
      notes_by_line.set(order_item_id, list);
      // Sólo la NC aceptada cubre: el resto se LISTA (trazabilidad) pero
      // no suma (no acreditó nada todavía).
      if (row.credit_note.status === 'accepted') {
        const acc = covered_by_line.get(order_item_id) ?? {
          qty: 0,
          amount: 0,
        };
        acc.qty += row.covered_qty;
        acc.amount += Number(row.covered_amount ?? 0);
        covered_by_line.set(order_item_id, acc);
      }
    }

    const lines: RefundCoverageLine[] = order_items.map((oi) => {
      const cov = ledger.get(oi.id);
      const nc = covered_by_line.get(oi.id) ?? { qty: 0, amount: 0 };
      return {
        order_item_id: oi.id,
        product_name: oi.product_name,
        quantity: oi.quantity,
        refunded_qty: cov?.refunded_qty ?? 0,
        refunded_amount: cov ? Number(cov.refunded_amount) : 0,
        nc_covered_qty: nc.qty,
        nc_covered_amount: nc.amount,
        notes: notes_by_line.get(oi.id) ?? [],
      };
    });

    const totals = lines.reduce(
      (acc, line) => ({
        refunded_qty: acc.refunded_qty + line.refunded_qty,
        refunded_amount: acc.refunded_amount + line.refunded_amount,
        nc_covered_qty: acc.nc_covered_qty + line.nc_covered_qty,
        nc_covered_amount: acc.nc_covered_amount + line.nc_covered_amount,
      }),
      { refunded_qty: 0, refunded_amount: 0, nc_covered_qty: 0, nc_covered_amount: 0 },
    );

    const fe_notice = await this.buildFeNotice(order_id, lines, refunds);

    return { order_id, lines, totals, fe_notice };
  }

  /**
   * Aviso obligatorio con FE: la orden tiene factura electrónica aceptada
   * y hay cantidad reembolsada sin NC que la cubra. El aviso INVITA (1
   * clic, con el `related_invoice_id` y los refunds sugeridos ya
   * resueltos) — nunca emite nada solo.
   */
  private async buildFeNotice(
    order_id: number,
    lines: RefundCoverageLine[],
    refunds: Array<{
      id: number;
      state: string;
      refund_items: Array<{ order_item_id: number; quantity: number }>;
    }>,
  ): Promise<RefundCoverageFeNotice | null> {
    const uncovered = lines.filter(
      (line) => line.refunded_qty > line.nc_covered_qty,
    );
    if (uncovered.length === 0) return null;

    // FE = factura de venta o de exportación aceptada por la DIAN. La de
    // compra no la emite el comercio (no hay FE propia que corregir).
    const fe = await this.prisma.invoices.findFirst({
      where: {
        order_id,
        invoice_type: { in: ['sales_invoice', 'export_invoice'] },
        status: 'accepted',
      },
      select: { id: true, invoice_number: true },
      orderBy: { id: 'desc' },
    });
    if (!fe) return null;

    const uncovered_ids = new Set(
      uncovered.map((line) => line.order_item_id),
    );
    const suggested_refund_ids = refunds
      .filter(
        (r) =>
          (NC_SUGGESTIBLE_STATES as readonly string[]).includes(r.state) &&
          r.refund_items.some(
            (ri) =>
              uncovered_ids.has(ri.order_item_id) && Number(ri.quantity) > 0,
          ),
      )
      .map((r) => r.id);

    return {
      related_invoice_id: fe.id,
      invoice_number: fe.invoice_number,
      message:
        `La orden tiene factura electrónica aceptada (${fe.invoice_number ?? `#${fe.id}`}) ` +
        `con ${uncovered.length} línea(s) reembolsada(s) sin nota crédito que las cubra. ` +
        `Emite la NC por lo reembolsado: el sistema deriva las líneas del reembolso, tú revisas y confirmas.`,
      suggested_refund_ids,
      uncovered_order_item_ids: uncovered.map((line) => line.order_item_id),
    };
  }
}
