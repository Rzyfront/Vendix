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
import { CreateServiceProposalDto, DecideServiceProposalDto, SetServiceBudgetDto } from './dto';
import { buildProposalSnapshotHash } from './utils/service-proposal-snapshot.util';
import { lockOrderLifecycle } from '../orders/order-flow/order-lifecycle-lock.util';
import {
  FullTaxRow,
  resolveCatalogLine,
  resolveCatalogUnitPrice,
  resolveFullTaxRowsByProductId,
} from '../orders/utils/catalog-line-pricing.util';

/**
 * Regla de consentimiento: el staff no puede subir por su cuenta un límite que
 * el cliente aprobó; eso solo ocurre aprobando una propuesta (decideWithToken).
 * Devuelve true cuando el cambio pedido por el staff debe rechazarse.
 */
export function staffChangeNeedsCustomerProposal(
  current: { amount: Prisma.Decimal; approved_at: Date | null; is_system: boolean } | null,
  requested: Prisma.Decimal,
): boolean {
  // Sin límite previo, o uno que solo sigue el total (sistema) o que fijó el staff: no hay
  // consentimiento que proteger. Bajar o mantener un límite aprobado favorece al cliente.
  if (!current || current.is_system || current.approved_at == null) return false;
  return requested.greaterThan(current.amount);
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

  /**
   * Réplica del chequeo del POS (`PaymentsService.hasActivePermission` + `requireActivePermission`,
   * igual que `ServiceSessionsService.requirePosPriceOverridePermission`): el helper del POS
   * es privado, así que se lee del contexto, que ya trae solo permisos activos.
   */
  private requirePosPriceOverridePermission(): void {
    const ctx = RequestContextService.getContext();
    const roles = ctx?.roles || [];
    const allowed =
      ctx?.is_super_admin === true ||
      roles.includes('super_admin') ||
      roles.includes('SUPER_ADMIN') ||
      (ctx?.permissions || []).includes('store:pos:price_override');
    if (!allowed) {
      throw new VendixHttpException(
        ErrorCodes.AUTH_PERM_001,
        'No tienes permiso para realizar esta operación en POS.',
      );
    }
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
        if (staffChangeNeedsCustomerProposal(current, new Prisma.Decimal(dto.amount))) {
          throw new VendixHttpException(
            ErrorCodes.SERVICE_BUDGET_001,
            'El cliente aprobó este límite: para subirlo envíale una propuesta desde el enlace de seguimiento.',
            { session_id: sessionId },
          );
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

  /**
   * El staff propone trabajo adicional con un nuevo total para que el cliente
   * lo autorice desde el enlace de seguimiento. Los totales se calculan en el
   * servidor (regla documentada abajo) y el snapshot se firma igual que lo
   * verifica `verifyProposalSnapshot`: cualquier deriva lo vuelve invisible.
   */
  async createProposal(sessionId: number, dto: CreateServiceProposalDto) {
    const session = await this.requireSession(sessionId);
    if (session.status !== 'open' && session.status !== 'paused') {
      throw new VendixHttpException(
        ErrorCodes.STATION_006,
        'Solo se pueden crear propuestas en sesiones abiertas o pausadas.',
        { session_id: sessionId },
      );
    }
    if (!session.order_id) {
      throw new VendixHttpException(
        ErrorCodes.SERVICE_BUDGET_002,
        'La sesión no tiene una orden asociada para proponer cambios.',
        { session_id: sessionId },
      );
    }
    const now = new Date();
    const expiresAt = dto.expires_at ? new Date(dto.expires_at) : new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      throw new BadRequestException('expires_at debe ser una fecha futura');
    }
    if (expiresAt.getTime() - now.getTime() > 7 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('expires_at no puede superar 7 días');
    }
    if (dto.items.some((item) => item.product_variant_id != null && item.product_id == null)) {
      throw new BadRequestException('product_variant_id requiere product_id');
    }
    const productIds = [...new Set(dto.items.map((item) => item.product_id).filter((id): id is number => id != null))];
    const productById = new Map<number, {
      id: number;
      name: string;
      base_price: Prisma.Decimal | number | null;
      is_on_sale: boolean | null;
      sale_price: Prisma.Decimal | number | null;
      allow_pos_price_override: boolean | null;
    }>();
    const variantByKey = new Map<string, {
      price_override?: Prisma.Decimal | number | null;
      is_on_sale?: boolean | null;
      sale_price?: Prisma.Decimal | number | null;
    }>();
    let taxRowsByProduct = new Map<number, FullTaxRow[]>();
    if (productIds.length > 0) {
      const found = await this.prisma.products.findMany({
        where: { id: { in: productIds }, store_id: this.storeId },
        select: { id: true, name: true, base_price: true, is_on_sale: true, sale_price: true, allow_pos_price_override: true },
      });
      const missing = productIds.filter((id) => !found.some((row) => row.id === id));
      if (missing.length > 0) {
        throw new BadRequestException(`Productos no pertenecen a esta tienda: ${missing.join(', ')}`);
      }
      for (const row of found) productById.set(row.id, row);
      for (const item of dto.items) {
        if (item.product_id != null && item.product_variant_id != null) {
          const variant = await this.prisma.product_variants.findFirst({
            where: { id: item.product_variant_id, product_id: item.product_id },
            select: { id: true, price_override: true, is_on_sale: true, sale_price: true },
          });
          if (!variant) throw new BadRequestException('La variante no pertenece al producto indicado');
          variantByKey.set(`${item.product_id}:${item.product_variant_id}`, variant);
        }
      }
      taxRowsByProduct = await resolveFullTaxRowsByProductId(this.prisma, productIds);
    }
    // Totales del servidor: línea = cantidad × precio; impuesto = tax_amount_item
    // si viene, si no cantidad × precio × tasa; descuento global opcional.
    // Líneas con producto: el precio pasa la misma compuerta del POS que
    // addItems (precio de catálogo + allow_pos_price_override + permiso
    // store:pos:price_override) y el impuesto se resuelve en el servidor con
    // la configuración fiscal del producto: se ignora tax_rate/tax_amount_item
    // del DTO para que el cliente no pueda aprobar un precio o IVA arbitrario.
    const money = (value: Prisma.Decimal | number | string) =>
      new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const priced = dto.items.map((item) => {
      const quantity = Math.max(1, Math.floor(Number(item.quantity)));
      if (item.product_id != null) {
        const product = productById.get(item.product_id)!;
        const variant = item.product_variant_id != null
          ? (variantByKey.get(`${item.product_id}:${item.product_variant_id}`) ?? null)
          : null;
        const catalogPrice = resolveCatalogUnitPrice(product, variant);
        const published = Number(item.unit_price);
        // Misma compuerta que el POS/addItemTx: cambiar el precio publicado
        // exige que el producto lo permita y el permiso del usuario actual.
        const priceOverridden = Math.round(published * 100) !== Math.round(catalogPrice * 100);
        if (priceOverridden && !product.allow_pos_price_override) {
          throw new VendixHttpException(
            ErrorCodes.POS_PRICE_OVERRIDE_NOT_ALLOWED_001,
            `El producto "${product.name}" no permite editar el precio en POS.`,
          );
        }
        if (priceOverridden) this.requirePosPriceOverridePermission();
        const resolved = resolveCatalogLine({
          catalogUnitPrice: published,
          quantity,
          priceUnitQuantityRaw: null,
          rows: taxRowsByProduct.get(item.product_id) ?? [],
        });
        const lineSubtotal = money(resolved.totalPrice);
        const lineTax = money(resolved.taxRows.reduce((acc, row) => acc + row.tax_amount, 0));
        return {
          snapshot: {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            product_name: item.product_name ?? null,
            description: item.description ?? null,
            quantity,
            unit_price: Number(money(resolved.unitBase).toFixed(2)),
            tax_rate: resolved.taxRate,
            tax_amount_item: Number(money(resolved.taxAmountItem).toFixed(2)),
            // Base × unidades (sin impuesto), igual que addItemTx: así un
            // recálculo posterior de la orden no duplica el IVA de estas líneas.
            total_price: Number(lineSubtotal.toFixed(2)),
            item_type: item.item_type ?? 'physical',
            total: Number(lineSubtotal.plus(lineTax).toFixed(2)),
          },
          lineSubtotal,
          lineTax,
        };
      }
      const unitPrice = money(item.unit_price);
      const lineSubtotal = money(unitPrice.times(quantity));
      const lineTax = item.tax_amount_item != null
        ? money(item.tax_amount_item)
        : item.tax_rate != null
          ? money(lineSubtotal.times(item.tax_rate).dividedBy(100))
          : money(0);
      return {
        snapshot: {
          product_id: item.product_id ?? null,
          product_variant_id: item.product_variant_id ?? null,
          product_name: item.product_name ?? null,
          description: item.description ?? null,
          quantity,
          unit_price: Number(unitPrice.toFixed(2)),
          tax_rate: item.tax_rate ?? null,
          tax_amount_item: Number(lineTax.toFixed(2)),
          item_type: item.item_type ?? (item.product_id ? 'physical' : 'service'),
          total: Number(lineSubtotal.plus(lineTax).toFixed(2)),
        },
        lineSubtotal,
        lineTax,
      };
    });
    const items = priced.map((entry) => entry.snapshot);
    const subtotal = money(priced.reduce((acc, entry) => acc + Number(entry.lineSubtotal), 0));
    const tax = money(priced.reduce((acc, entry) => acc + Number(entry.lineTax), 0));
    const discount = money(dto.discount ?? 0);
    if (discount.greaterThan(subtotal.plus(tax))) {
      throw new BadRequestException('El descuento no puede superar el subtotal más impuestos');
    }
    const total = subtotal.plus(tax).minus(discount);

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const locked = await lockOrderLifecycle(tx, session.order_id!, this.storeId);
        if (locked.state !== 'draft') {
          throw new VendixHttpException(
            ErrorCodes.SERVICE_BUDGET_002,
            'La orden ya no admite propuestas.',
            { session_id: sessionId },
          );
        }
        const order = await tx.orders.findFirst({
          where: { id: session.order_id!, store_id: this.storeId },
          select: { service_version: true, currency: true },
        });
        if (!order) throw new NotFoundException('Orden de la sesión no encontrada');
        const currentBudget = await tx.service_budgets.findFirst({
          where: { store_id: this.storeId, session_id: sessionId },
          orderBy: { version: 'desc' },
          select: { version: true, amount: true, currency: true },
        });
        const pending = await tx.service_change_proposals.findFirst({
          where: { store_id: this.storeId, session_id: sessionId, status: 'pending', expires_at: { gt: now } },
          select: { id: true },
        });
        if (pending) {
          throw new VendixHttpException(
            ErrorCodes.SERVICE_BUDGET_002,
            'Ya existe una propuesta pendiente para esta sesión.',
            { session_id: sessionId },
          );
        }
        const last = await tx.service_change_proposals.findFirst({
          where: { store_id: this.storeId, session_id: sessionId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const budgetSnapshot = {
          version: currentBudget?.version ?? null,
          amount: currentBudget ? new Prisma.Decimal(currentBudget.amount).toFixed(2) : null,
          currency: currentBudget?.currency ?? order.currency,
        };
        const snapshotHash = buildProposalSnapshotHash({
          items,
          subtotal: subtotal.toFixed(2),
          tax: tax.toFixed(2),
          discount: discount.toFixed(2),
          currency: order.currency,
          total: total.toFixed(2),
          expires_at: expiresAt.toISOString(),
          budget_snapshot: budgetSnapshot,
        });
        const proposal = await tx.service_change_proposals.create({
          data: {
            store_id: this.storeId,
            session_id: sessionId,
            version: (last?.version ?? 0) + 1,
            order_version: order.service_version,
            snapshot_hash: snapshotHash,
            lines: { items, budget_snapshot: budgetSnapshot },
            subtotal,
            tax,
            discount,
            currency: order.currency,
            total,
            status: 'pending',
            expires_at: expiresAt,
          },
        });
        await tx.service_progress_events.create({
          data: {
            store_id: this.storeId,
            session_id: sessionId,
            event_type: 'proposal_submitted',
            public_text: `El taller envió una propuesta de trabajo adicional por ${total.toFixed(2)} ${order.currency} para tu autorización.`,
            metadata: { proposal_id: proposal.id, proposal_version: proposal.version, snapshot_hash: snapshotHash },
          },
        });
        return proposal;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      this.notifications.push(this.storeId, {
        id: ++this.eventId,
        type: 'service_session.progress',
        title: 'Propuesta enviada',
        body: 'proposal_submitted',
        data: { session_id: sessionId, event_type: 'proposal_submitted', status: session.status },
        created_at: new Date().toISOString(),
      });
      return outcome;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if ((error as { code?: string })?.code === 'P2002' || (error as { code?: string })?.code === 'P2034') {
        throw new VendixHttpException(ErrorCodes.SERVICE_BUDGET_002, 'La propuesta cambió en otra solicitud; reintenta.');
      }
      throw error;
    }
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
        // Con la orden bloqueada: una cuenta ya cobrada no recibe líneas ni cambia su total.
        const locked = await lockOrderLifecycle(tx, session.order_id!, this.storeId);
        const order = await tx.orders.findFirst({
          where: { id: session.order_id!, store_id: this.storeId },
          select: { service_version: true, currency: true },
        });
        if (!order || locked.state !== 'draft' || order.service_version !== proposal.order_version || order.currency !== proposal.currency) {
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
