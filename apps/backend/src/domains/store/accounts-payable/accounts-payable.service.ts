import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ApQueryDto } from './dto/ap-query.dto';
import { RegisterApPaymentDto } from './dto/register-ap-payment.dto';

@Injectable()
export class AccountsPayableService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────
  async findAll(query: ApQueryDto) {
    const {
      page = 1,
      limit = 20,
      status,
      supplier_id,
      priority,
      search,
      date_from,
      date_to,
      sort_by = 'due_date',
      sort_order = 'asc',
    } = query;

    const where: any = {};

    if (status) where.status = status;
    if (supplier_id) where.supplier_id = supplier_id;
    if (priority) where.priority = priority;

    if (search) {
      where.OR = [
        { document_number: { contains: search, mode: 'insensitive' } },
        {
          supplier: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }

    if (date_from || date_to) {
      where.due_date = {};
      if (date_from) where.due_date.gte = new Date(date_from);
      if (date_to) where.due_date.lte = new Date(date_to);
    }

    const [data, total] = await Promise.all([
      this.prisma.accounts_payable.findMany({
        where,
        include: {
          supplier: {
            select: { id: true, name: true, tax_id: true, phone: true },
          },
          ap_payments: {
            orderBy: { payment_date: 'desc' },
          },
          ap_payment_schedules: {
            where: { status: 'scheduled' },
            orderBy: { scheduled_date: 'asc' },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.accounts_payable.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── DETAIL ────────────────────────────────────────────────
  async findOne(id: number) {
    const ap = await this.prisma.accounts_payable.findFirst({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            tax_id: true,
            phone: true,
            bank_name: true,
            bank_account_number: true,
            bank_account_type: true,
          },
        },
        ap_payments: {
          orderBy: { payment_date: 'desc' },
        },
        ap_payment_schedules: {
          orderBy: { scheduled_date: 'asc' },
        },
      },
    });

    if (!ap) {
      throw new NotFoundException(`Cuenta por pagar #${id} no encontrada`);
    }

    return ap;
  }

  // ─── DASHBOARD ─────────────────────────────────────────────
  async getDashboard() {
    const now = new Date();
    const start_of_month = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total_pending, total_overdue, total_scheduled, paid_month] =
      await Promise.all([
        this.prisma.accounts_payable.aggregate({
          where: { status: { in: ['open', 'partial'] } },
          _sum: { balance: true },
          _count: true,
        }),
        this.prisma.accounts_payable.aggregate({
          where: { status: 'overdue' },
          _sum: { balance: true },
          _count: true,
        }),
        this.prisma.ap_payment_schedules.aggregate({
          where: { status: 'scheduled' },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.ap_payments.aggregate({
          where: { payment_date: { gte: start_of_month } },
          _sum: { amount: true },
        }),
      ]);

    return {
      total_pending: {
        amount: Number(total_pending._sum.balance || 0),
        count: total_pending._count,
      },
      total_overdue: {
        amount: Number(total_overdue._sum.balance || 0),
        count: total_overdue._count,
      },
      total_scheduled: {
        amount: Number(total_scheduled._sum.amount || 0),
        count: total_scheduled._count,
      },
      paid_this_month: Number(paid_month._sum.amount || 0),
    };
  }

  // ─── REGISTER PAYMENT ──────────────────────────────────────
  async registerPayment(
    ap_id: number,
    dto: RegisterApPaymentDto,
    user_id: number,
  ) {
    const ap = await this.prisma.accounts_payable.findFirst({
      where: { id: ap_id },
    });

    if (!ap) {
      throw new NotFoundException(`Cuenta por pagar #${ap_id} no encontrada`);
    }

    const current_balance = Number(ap.balance);

    if (dto.amount > current_balance) {
      throw new BadRequestException(
        `El monto del pago ($${dto.amount}) excede el saldo pendiente ($${current_balance})`,
      );
    }

    if (ap.status === 'paid' || ap.status === 'written_off') {
      throw new BadRequestException(
        `No se puede registrar un pago en una cuenta con estado "${ap.status}"`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create ap_payment record
      const payment = await tx.ap_payments.create({
        data: {
          accounts_payable_id: ap_id,
          amount: dto.amount,
          payment_date: new Date(),
          payment_method: dto.payment_method,
          reference: dto.reference || null,
          bank_export_ref: dto.bank_export_ref || null,
          notes: dto.notes || null,
          created_by: user_id,
        },
      });

      // 2. Calculate new balance
      const new_paid = Number(ap.paid_amount) + dto.amount;
      const new_balance = Number(ap.original_amount) - new_paid;
      const new_status = new_balance <= 0 ? 'paid' : 'partial';

      // 3. Update AP
      const updated_ap = await tx.accounts_payable.update({
        where: { id: ap_id },
        data: {
          paid_amount: new_paid,
          balance: Math.max(new_balance, 0),
          status: new_status,
        },
      });

      // 4. FASE 3 — PUENTE AP→OC: si la CxP origen es una OC, espejar el
      // pago a purchase_order_payments (source='ap_bridge') y re-disparar
      // recalculatePaymentStatus para que `payment_status` de la OC avance.
      // El espejo es CONTABLEMENTE SILENCIOSO (solo este handler emite
      // ap.payment_registered → una sola fila de caja).
      if (ap.source_type === 'purchase_order' && ap.source_id != null) {
        const mirror = await this.mirrorApPaymentToPo(
          {
            ap_payment_id: payment.id,
            purchase_order_id: ap.source_id,
            amount: dto.amount,
            payment_date: payment.payment_date,
            payment_method: dto.payment_method,
            reference: dto.reference,
            notes: dto.notes,
            user_id,
          },
          tx,
        );

        // Recalc payment_status del PO in-line (mismo algoritmo que
        // PurchaseOrdersService.recalculatePaymentStatus — duplicado a
        // propósito para evitar dependencia circular PO↔AP; cualquier
        // cambio debe replicarse en ambos sitios).
        const poTotals = await tx.purchase_orders.findUnique({
          where: { id: ap.source_id },
          select: { total_amount: true },
        });
        if (poTotals) {
          const agg = await tx.purchase_order_payments.aggregate({
            where: { purchase_order_id: ap.source_id },
            _sum: { amount: true },
          });
          const grossTotal = Number(poTotals.total_amount);
          const totalPaid = Number(agg._sum.amount || 0);
          const EPS = 0.005;
          let newPoStatus: 'unpaid' | 'partial' | 'paid' = 'unpaid';
          if (totalPaid >= grossTotal - EPS) newPoStatus = 'paid';
          else if (totalPaid > EPS) newPoStatus = 'partial';
          await tx.purchase_orders.update({
            where: { id: ap.source_id },
            data: { payment_status: newPoStatus as any },
          });
          // 'mirror' is referenced to avoid unused-var; carries the
          // purchase_order_payment_id that was just mirrored.
          void mirror;
        }
      }

      return { payment, ap: updated_ap };
    });

    // 5. Emit event for accounting entry
    this.event_emitter.emit('ap.payment_registered', {
      ap_id: ap.id,
      ap_payment_id: result.payment.id,
      organization_id: ap.organization_id,
      store_id: ap.store_id,
      supplier_id: ap.supplier_id,
      amount: dto.amount,
      payment_method: dto.payment_method,
      document_number: ap.document_number,
      user_id,
    });

    return result;
  }

  /** Helper que el lado PO llama en su registerPayment para resolver la
   *  CxP de la OC (si existe) y espejar el pago hacia AP dentro del mismo tx. */
  async findPayableForPurchaseOrder(
    purchase_order_id: number,
    parent_tx?: any,
  ): Promise<{ id: number } | null> {
    const client = parent_tx ?? this.prisma;
    const ap = await client.accounts_payable.findFirst({
      where: {
        source_type: 'purchase_order',
        source_id: purchase_order_id,
      },
      select: { id: true },
    });
    return ap;
  }

  /** Sube el balance de una CxP al original_amount (compensación de espejo PO).
   *  Usado por el lado PO en registerPayment cuando NO existe CxP previa. */
  async applyPoPaymentToApBalance(params: {
    purchase_order_id: number;
    purchase_order_payment_id: number;
    amount: number;
    payment_date: Date;
    payment_method: string;
    reference?: string;
    notes?: string;
    user_id?: number;
  }, parent_tx?: any): Promise<{ applied: boolean; ap_payment_id?: number }> {
    const run = async (tx: any) => {
      const ap = await tx.accounts_payable.findFirst({
        where: {
          source_type: 'purchase_order',
          source_id: params.purchase_order_id,
        },
      });
      if (!ap) return { applied: false };

      const mirror = await this.mirrorPoPaymentToAp(
        {
          purchase_order_payment_id: params.purchase_order_payment_id,
          accounts_payable_id: ap.id,
          amount: params.amount,
          payment_date: params.payment_date,
          payment_method: params.payment_method,
          reference: params.reference,
          notes: params.notes,
          user_id: params.user_id,
        },
        tx,
      );

      // Bajar balance / paid_amount de la CxP (consolidación 1:1).
      const newPaid = Number(ap.paid_amount) + params.amount;
      const newBalance = Math.max(Number(ap.original_amount) - newPaid, 0);
      const newStatus =
        newBalance <= 0 ? 'paid' : Number(ap.balance) <= 0 ? 'partial' : ap.status;
      await tx.accounts_payable.update({
        where: { id: ap.id },
        data: {
          paid_amount: newPaid,
          balance: newBalance,
          status: newStatus,
        },
      });
      return { applied: true, ap_payment_id: mirror.ap_payment_id };
    };
    if (parent_tx) return run(parent_tx);
    return this.prisma.$transaction(run);
  }

  // ─── WRITE OFF ─────────────────────────────────────────────
  async writeOff(ap_id: number, user_id: number) {
    const ap = await this.prisma.accounts_payable.findFirst({
      where: { id: ap_id },
    });

    if (!ap) {
      throw new NotFoundException(`Cuenta por pagar #${ap_id} no encontrada`);
    }

    if (ap.status === 'paid') {
      throw new BadRequestException(
        'No se puede castigar una cuenta ya pagada',
      );
    }

    if (ap.status === 'written_off') {
      throw new BadRequestException('Esta cuenta ya fue castigada');
    }

    const updated = await this.prisma.accounts_payable.update({
      where: { id: ap_id },
      data: {
        status: 'written_off',
        notes:
          `${ap.notes || ''}\n[Castigada por usuario #${user_id} el ${new Date().toISOString()}]`.trim(),
      },
    });

    // Emit event for accounting entry
    this.event_emitter.emit('ap.written_off', {
      ap_id: ap.id,
      organization_id: ap.organization_id,
      store_id: ap.store_id,
      supplier_id: ap.supplier_id,
      amount: Number(ap.balance),
      document_number: ap.document_number,
      user_id,
    });

    return updated;
  }

  // ─── CREATE FROM EVENT ─────────────────────────────────────
  async createFromEvent(data: {
    supplier_id: number;
    source_type: string;
    source_id?: number;
    document_number?: string;
    original_amount: number;
    currency?: string;
    due_date?: Date;
    priority?: string;
    notes?: string;
    organization_id: number;
    store_id?: number;
  }) {
    const due_date =
      data.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return this.prisma.accounts_payable.create({
      data: {
        organization_id: data.organization_id,
        store_id: data.store_id || null,
        supplier_id: data.supplier_id,
        source_type: data.source_type,
        source_id: data.source_id || null,
        document_number: data.document_number || null,
        original_amount: data.original_amount,
        paid_amount: 0,
        balance: data.original_amount,
        currency: data.currency || 'COP',
        issue_date: new Date(),
        due_date,
        status: 'open',
        days_overdue: 0,
        priority: data.priority || 'normal',
        notes: data.notes || null,
      },
    });
  }

  // ─── UPSERT PAYABLE FOR OC RECEPTION (Fase 2) ─────────────
  // A single OC may be received in N partial batches. The OLD createFromEvent
  // spawned a fresh `accounts_payable` per reception, creating duplicate CxP
  // rows for the same supplier × same OC. This method guarantees ONE CxP per
  // (source_type='purchase_order', source_id=poId), increments the gross on
  // each subsequent reception (never decreasing `original_amount` or
  // `balance` below what has already been paid), and is idempotent per
  // reception via `ap_reception_links.reception_id @unique`.
  //
  // `grossReceptionShare` is the BRUTO (= neto + vat_deductible, for O-48)
  // or the NETO alone (for O-49 where VAT is non-deductible and already
  // capitalized at cost). Per `vendix-tax-typing`: purchases post only the
  // scalar `vat_deductible`; no `tax_breakdown` is built here.
  async upsertPayableForReception(data: {
    supplier_id: number;
    source_id: number; // purchase_order_id
    reception_id: number;
    gross_reception_share: number; // gross amount contributed by THIS reception
    document_number?: string;
    currency?: string;
    due_date?: Date;
    organization_id: number;
    store_id?: number;
  }) {
    const due_date =
      data.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const contribution = Math.max(Number(data.gross_reception_share), 0);

    return this.prisma.$transaction(async (tx) => {
      // 1. Idempotency: if this reception is already linked to a CxP, return it.
      const existing_link = await tx.ap_reception_links.findUnique({
        where: { reception_id: data.reception_id },
        include: { accounts_payable: true },
      });
      if (existing_link) {
        return existing_link.accounts_payable;
      }

      // 2. Find or create the single CxP for this (OC, supplier).
      const ap = await tx.accounts_payable.findFirst({
        where: {
          source_type: 'purchase_order',
          source_id: data.source_id,
        },
      });

      let result_ap: { id: number; original_amount: any; balance: any };
      if (!ap) {
        result_ap = await tx.accounts_payable.create({
          data: {
            organization_id: data.organization_id,
            store_id: data.store_id ?? null,
            supplier_id: data.supplier_id,
            source_type: 'purchase_order',
            source_id: data.source_id,
            document_number: data.document_number ?? null,
            original_amount: contribution,
            paid_amount: 0,
            balance: contribution,
            currency: data.currency ?? 'COP',
            issue_date: new Date(),
            due_date,
            status: 'open',
            days_overdue: 0,
            priority: 'normal',
            notes: null,
          },
        });
        // FASE 3 — Backfill anticipos: si la OC ya tenía pagos del modal PO
        // ANTES de esta primera recepción (pagos anticipados reales a 133005),
        // espejarlos a ap_payments (source='advance_backfill') para que el
        // paid_amount/balance arranque consistente. Los espejos NO emiten
        // ap.payment_registered (no hay doble caja contable).
        const seeded = await this.backfillAdvancePayments(
          {
            purchase_order_id: data.source_id,
            accounts_payable_id: result_ap.id,
          },
          tx,
        );
        if (seeded > 0) {
          const seededAgg = await tx.ap_payments.aggregate({
            where: {
              accounts_payable_id: result_ap.id,
              source: 'advance_backfill',
            },
            _sum: { amount: true },
          });
          const seededPaid = Number(seededAgg._sum.amount || 0);
          result_ap = await tx.accounts_payable.update({
            where: { id: result_ap.id },
            data: {
              paid_amount: seededPaid,
              balance: Math.max(Number(result_ap.original_amount) - seededPaid, 0),
              status: seededPaid >= Number(result_ap.original_amount) ? 'paid' : 'partial',
            },
          });
        }
      } else {
        // 3. Increment gross / balance, but NEVER below `paid_amount` (a
        // partial payment has already shrunk the balance; a subsequent
        // reception cannot underflow that).
        const newOriginal = Number(ap.original_amount) + contribution;
        const projectedBalance = Number(ap.balance) + contribution;
        const newBalance = Math.max(projectedBalance, 0);
        result_ap = await tx.accounts_payable.update({
          where: { id: ap.id },
          data: {
            original_amount: newOriginal,
            balance: newBalance,
            // status moves back to open/partial if it had been marked paid by a
            // prior interim balance, but typically it's still open/partial here.
            status: Number(ap.balance) <= 0 ? 'open' : ap.status,
          },
        });
      }

      // 4. Link this reception to the CxP (UNIQUE on reception_id → safe).
      await tx.ap_reception_links.create({
        data: {
          accounts_payable_id: result_ap.id,
          reception_id: data.reception_id,
          gross_amount: contribution,
        },
      });

      return result_ap;
    });
  }

  // ════════════════════════════════════════════════════════════════
  // FASE 3 — PUENTE BIDIRECCIONAL AP↔OC (anti-doble-posteo de caja)
  // ════════════════════════════════════════════════════════════════
  //
  // Cada pago económico genera UNA sola fila de caja contable (su
  // dominio de ORIGEN postea). La fila espejo en el dominio VICTIMA es
  // CONTABLEMENTE SILENCIOSA: no emite `purchase_order.payment` ni
  // `ap.payment_registered` (solo el origen emite). El `source` enum
  // distingue: `po_modal` / `ap_ui` (origen, contable) vs
  // `po_bridge` / `ap_bridge` / `advance_backfill` (espejo, inerte).
  //
  // Los índices UNIQUE PARCIALES sobre las columnas de enlace en
  // purchase_order_payments.ap_payment_id y ap_payments.purchase_order_payment_id
  // garantizan idempotencia al nivel de BD.

  /** Espeja un pago del modal OC hacia la CxP (baja balance). Silencioso. */
  async mirrorPoPaymentToAp(params: {
    purchase_order_payment_id: number;
    accounts_payable_id: number;
    amount: number;
    payment_date: Date;
    payment_method: string;
    reference?: string;
    notes?: string;
    user_id?: number;
  }, parent_tx?: any): Promise<{ ap_payment_id: number }> {
    const run = async (tx: any) => {
      // Idempotencia por el unique parcial sobre ap_payments.purchase_order_payment_id.
      const existing = await tx.ap_payments.findFirst({
        where: { purchase_order_payment_id: params.purchase_order_payment_id },
        select: { id: true },
      });
      if (existing) return { ap_payment_id: existing.id };

      const ap_payment = await tx.ap_payments.create({
        data: {
          accounts_payable_id: params.accounts_payable_id,
          amount: params.amount,
          payment_date: params.payment_date,
          payment_method: params.payment_method,
          reference: params.reference ?? null,
          notes: params.notes ?? null,
          created_by: params.user_id ?? null,
          purchase_order_payment_id: params.purchase_order_payment_id,
          source: 'po_bridge',
        },
      });
      return { ap_payment_id: ap_payment.id };
    };
    if (parent_tx) return run(parent_tx);
    return this.prisma.$transaction(run);
  }

  /** Espeja un pago desde CxP hacia la OC (avanza payment_status). Silencioso.
   *  Retorna el purchase_order_payment_id creado para que el caller pueda
   *  re-disparar el recalcPaymentStatus desde el lado PO. */
  async mirrorApPaymentToPo(params: {
    ap_payment_id: number;
    purchase_order_id: number;
    amount: number;
    payment_date: Date;
    payment_method: string;
    reference?: string;
    notes?: string;
    user_id?: number;
  }, parent_tx?: any): Promise<{ purchase_order_payment_id: number }> {
    const run = async (tx: any) => {
      // Idempotencia por el unique parcial sobre purchase_order_payments.ap_payment_id.
      const existing = await tx.purchase_order_payments.findFirst({
        where: { ap_payment_id: params.ap_payment_id },
        select: { id: true },
      });
      if (existing) return { purchase_order_payment_id: existing.id };

      const po_payment = await tx.purchase_order_payments.create({
        data: {
          purchase_order_id: params.purchase_order_id,
          amount: params.amount,
          payment_date: params.payment_date,
          payment_method: params.payment_method,
          reference: params.reference ?? null,
          notes: params.notes ?? null,
          created_by_user_id: params.user_id ?? null,
          ap_payment_id: params.ap_payment_id,
          source: 'ap_bridge',
        },
      });
      return { purchase_order_payment_id: po_payment.id };
    };
    if (parent_tx) return run(parent_tx);
    return this.prisma.$transaction(run);
  }

  /**
   * Backfill de ANTICIPOS: cuando una OC se recibe por primera vez y existe
   * una CxP, todos los purchase_order_payments previos sin `ap_payment_id`
   * (pagos ANTICIPADOS hechos por el modal OC antes de la primera recepción)
   * se espejan como `ap_payments` con `source='advance_backfill'`. Esto
   * siembra `paid_amount`/`balance` de la CxP hasta igualar lo ya cobrado
   * al proveedor (los anticipos son reales — no se pueden perder al crear
   * el pasivo).
   *
   * No emite `ap.payment_registered` (sería doble-posteo de caja). El
   * `accounts_payable.balance` simplemente arranca en
   * `original_amount − sum(espejos)`.
   *
   * Idempotente: corre en `upsertPayableForReception` cuando se crea la CxP,
   * y los unique parciales evitan duplicar espejos si vuelve a correr.
   */
  async backfillAdvancePayments(params: {
    purchase_order_id: number;
    accounts_payable_id: number;
  }, parent_tx?: any): Promise<number> {
    const run = async (tx: any) => {
      const orphans = await tx.purchase_order_payments.findMany({
        where: {
          purchase_order_id: params.purchase_order_id,
          ap_payment_id: null,
        },
        select: {
          id: true,
          amount: true,
          payment_date: true,
          payment_method: true,
          reference: true,
          notes: true,
          created_by_user_id: true,
        },
      });

      let seeded = 0;
      for (const o of orphans) {
        // 1. Upsert la fila espejo en ap_payments (idempotente por el unique
        // parcial sobre ap_payments.purchase_order_payment_id).
        const mirror = await tx.ap_payments.upsert({
          where: { purchase_order_payment_id: o.id },
          create: {
            accounts_payable_id: params.accounts_payable_id,
            amount: o.amount,
            payment_date: o.payment_date,
            payment_method: o.payment_method,
            reference: o.reference,
            notes: o.notes,
            created_by: o.created_by_user_id,
            purchase_order_payment_id: o.id,
            source: 'advance_backfill',
          },
          update: {}, // ya existe, no tocar
        });
        // 2. Enlazar el lado PO con el id del espejo (unique parcial garantiza
        // que no se duplica). Si ya estaba enlazado, el set es no-op.
        await tx.purchase_order_payments.update({
          where: { id: o.id },
          data: { ap_payment_id: mirror.id },
        });
        seeded += 1;
      }
      return seeded;
    };
    if (parent_tx) return run(parent_tx);
    return this.prisma.$transaction(run);
  }
}
