import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { DecideServiceProposalDto, SetServiceBudgetDto } from './dto';

/** Exact values produced by a trusted server-side order quote calculator. */
export interface ServerProposalSnapshot {
  lines: Prisma.InputJsonValue;
  subtotal: Prisma.Decimal | number | string;
  tax: Prisma.Decimal | number | string;
  discount: Prisma.Decimal | number | string;
  currency: string;
  total: Prisma.Decimal | number | string;
  expiresAt: Date;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class ServiceBudgetsService {
  private eventId = 0;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsSseService,
  ) {}

  private get storeId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new BadRequestException('No se encontró contexto de tienda');
    return storeId;
  }

  private async requireSession(sessionId: number) {
    const session = await this.prisma.service_sessions.findFirst({
      where: { id: sessionId, store_id: this.storeId },
      select: { id: true, store_id: true, order_id: true, status: true },
    });
    if (!session) throw new NotFoundException('Sesión de servicio no encontrada');
    return session;
  }

  async getBudget(sessionId: number) {
    await this.requireSession(sessionId);
    return this.prisma.service_budgets.findFirst({
      where: { store_id: this.storeId, session_id: sessionId },
      orderBy: { version: 'desc' },
    });
  }

  async setBudget(sessionId: number, dto: SetServiceBudgetDto) {
    const session = await this.requireSession(sessionId);
    const currency = dto.currency.trim().toUpperCase();
    if (!currency) throw new BadRequestException('La moneda es obligatoria');
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const current = await tx.service_budgets.findFirst({
          where: { store_id: this.storeId, session_id: sessionId },
          orderBy: { version: 'desc' },
        });
        if (dto.expectedVersion !== undefined && (current?.version ?? 0) !== dto.expectedVersion) {
          throw new ConflictException('El presupuesto cambió; recarga la sesión');
        }
        if (session.order_id) {
          const pendingPayment = await tx.payments.findFirst({
            where: { order_id: session.order_id, state: 'pending' },
            select: { id: true },
          });
          if (pendingPayment) {
            throw new ConflictException(
              'No se puede cambiar el límite mientras hay un intento de pago pendiente para esta orden.',
            );
          }
        }
        if (session.order_id) {
          const order = await tx.orders.findFirst({
            where: { id: session.order_id, store_id: this.storeId },
            select: { grand_total: true, tip_amount: true, currency: true },
          });
          if (!order) throw new NotFoundException('Orden de la sesión no encontrada');
          const totalExcludingTip = new Prisma.Decimal(order.grand_total).minus(order.tip_amount ?? 0);
          if (order.currency !== currency || totalExcludingTip.greaterThan(new Prisma.Decimal(dto.amount))) {
            throw new VendixHttpException(
              ErrorCodes.SERVICE_BUDGET_001,
              'El límite debe usar la moneda de la orden y no puede quedar por debajo de su total autorizado.',
              { session_id: sessionId },
            );
          }
        }
        return tx.service_budgets.create({
          data: {
            store_id: this.storeId,
            session_id: sessionId,
            amount: new Prisma.Decimal(dto.amount),
            currency,
            version: (current?.version ?? 0) + 1,
            // Consent semantics for approved_at remain a business decision.
            // Do not imply customer approval when an operator merely saves a value.
            approved_at: null,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return outcome;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if ((error as { code?: string })?.code === 'P2002' || (error as { code?: string })?.code === 'P2034') {
        throw new ConflictException('El presupuesto cambió en otra solicitud; recarga la sesión');
      }
      throw error;
    }
  }

  /**
   * Internal seam for order writers. The snapshot must come from a server-owned
   * quote calculation; this API deliberately has no HTTP endpoint accepting
   * client-supplied prices, taxes, discounts or totals.
   */
  async openProposal(
    sessionId: number,
    expectedOrderVersion: number,
    snapshot: ServerProposalSnapshot,
  ) {
    const session = await this.requireSession(sessionId);
    if (!session.order_id) throw new ConflictException('La sesión aún no tiene una orden asociada');
    if (!Number.isInteger(expectedOrderVersion) || expectedOrderVersion < 1) {
      throw new BadRequestException('expectedOrderVersion inválida');
    }
    if (snapshot.expiresAt <= new Date()) throw new BadRequestException('La propuesta debe expirar en el futuro');
    let normalized: {
      lines: Prisma.InputJsonValue;
      subtotal: string;
      tax: string;
      discount: string;
      currency: string;
      total: string;
      expires_at: string;
    };
    const rawLines = snapshot.lines;
    const lineItems = Array.isArray(rawLines)
      ? rawLines
      : rawLines && typeof rawLines === 'object' && !Array.isArray(rawLines) && Array.isArray((rawLines as Record<string, unknown>).items)
        ? (rawLines as Record<string, unknown>).items as unknown[]
        : null;
    if (!lineItems || lineItems.length < 1 || lineItems.length > 100 || lineItems.some((line) => !line || typeof line !== 'object' || Array.isArray(line))) {
      throw new BadRequestException('La propuesta debe contener entre 1 y 100 líneas válidas.');
    }
    try {
      normalized = {
        lines: snapshot.lines,
        subtotal: new Prisma.Decimal(snapshot.subtotal).toFixed(2),
        tax: new Prisma.Decimal(snapshot.tax).toFixed(2),
        discount: new Prisma.Decimal(snapshot.discount).toFixed(2),
        currency: snapshot.currency.trim().toUpperCase(),
        total: new Prisma.Decimal(snapshot.total).toFixed(2),
        expires_at: snapshot.expiresAt.toISOString(),
      };
    } catch {
      throw new BadRequestException('El snapshot de propuesta no contiene importes o expiración válidos');
    }
    if (!normalized.currency) throw new BadRequestException('La moneda de la propuesta es obligatoria');
    const [subtotal, tax, discount, total] = [normalized.subtotal, normalized.tax, normalized.discount, normalized.total].map((value) => new Prisma.Decimal(value));
    if ([subtotal, tax, discount, total].some((value) => value.isNegative())) {
      throw new BadRequestException('Los importes del snapshot no pueden ser negativos');
    }
    if (!subtotal.plus(tax).minus(discount).equals(total)) {
      throw new BadRequestException('El total propuesto debe coincidir con subtotal + impuestos - descuentos.');
    }
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const order = await tx.orders.findFirst({
          where: { id: session.order_id!, store_id: this.storeId },
          select: { id: true, service_version: true, currency: true },
        });
        if (!order) throw new NotFoundException('Orden de la sesión no encontrada');
        if (order.service_version !== expectedOrderVersion) {
          throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_002, 'La orden cambió; vuelve a calcular la propuesta.');
        }
        if (order.currency !== normalized.currency) {
          throw new BadRequestException('La propuesta debe usar la moneda de la orden.');
        }
        const currentBudget = await tx.service_budgets.findFirst({
          where: { store_id: this.storeId, session_id: sessionId },
          orderBy: { version: 'desc' },
        });
        const latest = await tx.service_change_proposals.findFirst({
          where: { store_id: this.storeId, session_id: sessionId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const lines = {
          items: normalized.lines,
          budget_snapshot: currentBudget ? {
            version: currentBudget.version,
            amount: currentBudget.amount.toFixed(2),
            currency: currentBudget.currency,
          } : null,
        } as Prisma.InputJsonValue;
        const hash = createHash('sha256').update(canonicalJson({ ...normalized, budget_snapshot: lines })).digest('hex');
        return tx.service_change_proposals.create({
          data: {
            store_id: this.storeId,
            session_id: sessionId,
            version: (latest?.version ?? 0) + 1,
            order_version: expectedOrderVersion,
            snapshot_hash: hash,
            lines,
            subtotal: new Prisma.Decimal(normalized.subtotal),
            tax: new Prisma.Decimal(normalized.tax),
            discount: new Prisma.Decimal(normalized.discount),
            currency: normalized.currency,
            total: new Prisma.Decimal(normalized.total),
            status: 'pending',
            expires_at: snapshot.expiresAt,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return outcome;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ConflictException) throw error;
      if ((error as { code?: string })?.code === 'P2002' || (error as { code?: string })?.code === 'P2034') {
        throw new ConflictException('La orden o la propuesta cambió; vuelve a calcular');
      }
      throw error;
    }
  }

  async listProposals(sessionId: number) {
    await this.requireSession(sessionId);
    const now = new Date();
    await this.prisma.service_change_proposals.updateMany({
      where: { store_id: this.storeId, session_id: sessionId, status: 'pending', expires_at: { lte: now } },
      data: { status: 'expired' },
    });
    const proposals = await this.prisma.service_change_proposals.findMany({
      where: { store_id: this.storeId, session_id: sessionId },
      orderBy: { version: 'desc' },
    });
    const decisions = proposals.length
      ? await this.prisma.service_proposal_decisions.findMany({
          where: { store_id: this.storeId, proposal_id: { in: proposals.map((row) => row.id) } },
          orderBy: { decided_at: 'desc' },
        })
      : [];
    const decisionByProposal = new Map(decisions.map((row) => [row.proposal_id, row]));
    return proposals.map((proposal) => ({ ...proposal, decision_record: decisionByProposal.get(proposal.id) ?? null }));
  }

  async decideWithToken(token: string, dto: DecideServiceProposalDto) {
    if (!/^[A-Za-z0-9._~-]{32,512}$/.test(token)) {
      throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_003);
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const sessionToken = await this.prisma.service_session_tokens.findFirst({
      where: { token_hash: tokenHash, revoked_at: null, expires_at: { gt: now }, store_id: this.storeId },
      select: { id: true, session_id: true },
    });
    if (!sessionToken) throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_003);

    const proposal = await this.prisma.service_change_proposals.findFirst({
      where: { session_id: sessionToken.session_id, store_id: this.storeId, version: dto.proposal_version },
    });
    if (!proposal) throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_003);
    if (proposal.snapshot_hash !== dto.snapshot_hash) throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_004);
    if (proposal.expires_at <= now) {
      await this.prisma.service_change_proposals.updateMany({
        where: { id: proposal.id, store_id: this.storeId, status: 'pending' },
        data: { status: 'expired' },
      });
      throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_003);
    }
    const session = await this.requireSession(proposal.session_id);
    if (!session.order_id) throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_002, 'La propuesta no tiene una orden asociada.');

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const order = await tx.orders.findFirst({
          where: { id: session.order_id!, store_id: this.storeId },
          select: { service_version: true, currency: true },
        });
        if (!order || order.service_version !== proposal.order_version || order.currency !== proposal.currency) {
          await tx.service_change_proposals.updateMany({
            where: { id: proposal.id, store_id: this.storeId, status: 'pending' },
            data: { status: 'stale' },
          });
          return { stale: 'La propuesta quedó obsoleta porque cambió la orden' } as const;
        }
        const storedLines = proposal.lines as { budget_snapshot?: { version?: number } | null };
        const currentBudget = await tx.service_budgets.findFirst({
          where: { store_id: this.storeId, session_id: sessionToken.session_id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const proposedBudgetVersion = storedLines?.budget_snapshot?.version ?? null;
        if ((currentBudget?.version ?? null) !== proposedBudgetVersion) {
          await tx.service_change_proposals.updateMany({
            where: { id: proposal.id, store_id: this.storeId, status: 'pending' },
            data: { status: 'stale' },
          });
          return { stale: 'El presupuesto cambió después de crear la propuesta' } as const;
        }
        const updated = await tx.service_change_proposals.updateMany({
          where: {
            id: proposal.id,
            store_id: this.storeId,
            session_id: sessionToken.session_id,
            version: proposal.version,
            order_version: proposal.order_version,
            status: 'pending',
            expires_at: { gt: now },
          },
          data: { status: dto.decision },
        });
        if (updated.count !== 1) throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_002, 'La propuesta ya fue decidida o expiró.');
        await tx.service_proposal_decisions.create({
          data: {
            store_id: this.storeId,
            proposal_id: proposal.id,
            decision: dto.decision,
            actor_type: 'customer',
            actor_id: `session-token:${sessionToken.id}`,
            proof: { token_id: sessionToken.id, proposal_version: proposal.version, snapshot_hash: proposal.snapshot_hash },
          },
        });
        if (dto.decision === 'approved') {
          await tx.service_budgets.create({
            data: {
              store_id: this.storeId,
              session_id: sessionToken.session_id,
              version: (currentBudget?.version ?? 0) + 1,
              amount: proposal.total,
              currency: proposal.currency,
              approved_at: now,
            },
          });

          const storedLinesPayload = proposal.lines as { items?: any[] } | any[];
          const items = Array.isArray(storedLinesPayload)
            ? storedLinesPayload
            : Array.isArray(storedLinesPayload?.items)
              ? storedLinesPayload.items
              : [];

          for (const item of items) {
            const qty = Math.max(1, Number(item.quantity || 1));
            await tx.order_items.create({
              data: {
                order_id: session.order_id!,
                service_session_id: sessionToken.session_id,
                product_id: item.product_id ? Number(item.product_id) : null,
                product_variant_id: item.product_variant_id ? Number(item.product_variant_id) : null,
                product_name: String(item.product_name || item.name || item.description || 'Servicio adicional'),
                description: item.description ? String(item.description) : null,
                quantity: qty,
                unit_price: new Prisma.Decimal(item.unit_price ?? item.total ?? 0),
                total_price: new Prisma.Decimal(
                  item.total_price ?? item.total ?? (Number(item.unit_price ?? 0) * qty),
                ),
                tax_rate: item.tax_rate != null ? new Prisma.Decimal(item.tax_rate) : null,
                tax_amount_item: item.tax_amount_item != null ? new Prisma.Decimal(item.tax_amount_item) : null,
                item_type: item.item_type || (item.product_id ? 'physical' : 'service'),
                updated_at: now,
              },
            });

            if (item.product_id) {
              const prod = await tx.products.findFirst({
                where: { id: Number(item.product_id), store_id: this.storeId },
                select: { id: true, track_inventory: true },
              });
              if (prod?.track_inventory) {
                const stockLevel = await tx.stock_levels.findFirst({
                  where: {
                    product_id: prod.id,
                    product_variant_id: item.product_variant_id ? Number(item.product_variant_id) : null,
                  },
                  orderBy: { quantity_available: 'desc' },
                  select: { id: true, location_id: true, quantity_available: true },
                });
                if (stockLevel) {
                  if (stockLevel.quantity_available < qty) {
                    throw new VendixHttpException(
                      ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
                      'Stock insuficiente para aplicar la propuesta en el producto ' + (item.product_name || prod.id),
                    );
                  }
                  const store = await tx.stores.findUnique({
                    where: { id: this.storeId },
                    select: { organization_id: true },
                  });
                  if (store?.organization_id) {
                    await tx.stock_reservations.create({
                      data: {
                        organization_id: store.organization_id,
                        product_id: prod.id,
                        product_variant_id: item.product_variant_id ? Number(item.product_variant_id) : null,
                        location_id: stockLevel.location_id,
                        quantity: qty,
                        reserved_for_type: 'order',
                        reserved_for_id: session.order_id!,
                        status: 'active',
                      },
                    });
                    await tx.stock_levels.update({
                      where: { id: stockLevel.id },
                      data: {
                        quantity_reserved: { increment: qty },
                        quantity_available: { decrement: qty },
                        updated_at: now,
                      },
                    });
                  }
                }
              }
            }
          }

          await tx.orders.update({
            where: { id: session.order_id! },
            data: {
              subtotal_amount: proposal.subtotal,
              tax_amount: proposal.tax,
              discount_amount: proposal.discount,
              grand_total: proposal.total,
              service_version: { increment: 1 },
              updated_at: now,
            },
          });
        }
        await tx.service_progress_events.create({
          data: {
            store_id: this.storeId,
            session_id: sessionToken.session_id,
            event_type: dto.decision === 'approved' ? 'proposal_approved' : 'proposal_rejected',
            public_text: dto.decision === 'approved'
              ? 'El cliente autorizó la propuesta; las líneas de trabajo adicional se aplicaron a la orden y el stock quedó reservado.'
              : 'El cliente rechazó la propuesta de trabajo adicional.',
            metadata: { proposal_id: proposal.id, proposal_version: proposal.version, snapshot_hash: proposal.snapshot_hash },
          },
        });
        const updatedProposal = await tx.service_change_proposals.findFirst({
          where: { id: proposal.id, store_id: this.storeId },
        });
        const decisionRecord = await tx.service_proposal_decisions.findFirst({
          where: { proposal_id: proposal.id, store_id: this.storeId },
        });
        return updatedProposal ? { ...updatedProposal, decision_record: decisionRecord } : null;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (outcome && 'stale' in outcome) throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_002, outcome.stale);
      if (outcome) {
        this.notifications.push(this.storeId, {
          id: ++this.eventId,
          type: 'service_session.progress',
          title: 'Propuesta decidida',
          body: dto.decision,
          data: {
            session_id: sessionToken.session_id,
            event_type: dto.decision === 'approved' ? 'proposal_approved' : 'proposal_rejected',
            status: 'open',
          },
          created_at: new Date().toISOString(),
        });
      }
      return outcome;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if ((error as { code?: string })?.code === 'P2002' || (error as { code?: string })?.code === 'P2034') {
        throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_002, 'La propuesta ya fue decidida.');
      }
      throw error;
    }
  }
}
