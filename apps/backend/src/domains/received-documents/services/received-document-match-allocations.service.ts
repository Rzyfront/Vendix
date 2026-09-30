import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeNit } from '../../../common/utils/nit.util';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ReceivedDocumentsContext, ReceivedDocumentsService } from '../received-documents.service';

type Decimal = Prisma.Decimal;
type MatchAllocation = Prisma.received_document_match_allocationsGetPayload<{}>;

interface ConfirmMatchInput {
  expected_version: number;
  idempotency_key: string;
  document_item_id: number;
  purchase_order_id?: number;
  purchase_order_item_id?: number;
  reception_id?: number;
  reception_item_id?: number;
  expense_id?: number;
  expense_item_id?: number;
  source_quantity: string;
  target_quantity?: string;
  allocated_net_amount: string;
  target_unit_code?: string;
  manual_reason?: string;
}

interface ValidatedInput {
  expected_version: number;
  idempotency_key: string;
  document_item_id: number;
  purchase_order_id?: number;
  purchase_order_item_id?: number;
  reception_id?: number;
  reception_item_id?: number;
  expense_id?: number;
  expense_item_id?: number;
  source_quantity: Decimal;
  supplied_target_quantity?: Decimal;
  allocated_net_amount: Decimal;
  supplied_target_unit_code?: string;
  manual_reason?: string;
}

interface AllocationResult {
  allocation: MatchAllocation | Record<string, unknown>;
  document_version: number;
  matching_status: string;
  duplicate: boolean;
}

const TERMINAL_FISCAL_STATUSES = new Set(['recognized', 'accepted', 'posted']);
const ALLOCATION_EVENT_PREFIX = 'match-allocation';
const MONEY_SCALE = 2;
const QUANTITY_SCALE = 4;

/**
 * Confirms or revokes one commercial line allocation at a time. Matching is
 * reconciliation evidence only: this service never receives inventory, posts
 * accounting/AP/VAT, or performs DIAN acceptance.
 */
@Injectable()
export class ReceivedDocumentMatchAllocationsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly documents: ReceivedDocumentsService,
  ) {}

  async confirm(
    context: ReceivedDocumentsContext,
    documentId: number,
    input: ConfirmMatchInput,
  ): Promise<AllocationResult> {
    this.assertPositiveId(documentId, 'document_id');
    const actorId = await this.assertWriteContext(context);
    const validated = this.validateInput(input);
    const storeFilter = context.store_id == null
      ? Prisma.empty
      : Prisma.sql`AND "store_id" = ${context.store_id}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "received_documents"
        WHERE "id" = ${documentId}
          AND "organization_id" = ${context.organization_id}
          AND "accounting_entity_id" = ${context.accounting_entity_id}
          ${storeFilter}
        FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Documento recibido no encontrado.');

      const sourceLocked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "received_document_items"
        WHERE "id" = ${validated.document_item_id} AND "document_id" = ${documentId}
        FOR UPDATE
      `);
      if (sourceLocked.length !== 1) throw new BadRequestException('La línea fuente no pertenece al documento indicado.');

      const document = await tx.received_documents.findFirst({
        where: this.documentWhere(context, documentId),
        select: {
          id: true,
          organization_id: true,
          accounting_entity_id: true,
          store_id: true,
          document_type: true,
          issuer_tax_id: true,
          currency: true,
          processing_status: true,
          validation_status: true,
          matching_status: true,
          fiscal_status: true,
          posting_status: true,
          accepted_at: true,
          version: true,
        },
      });
      if (!document) throw new NotFoundException('Documento recibido no encontrado.');

      const sourceLine = await tx.received_document_items.findFirst({
        where: { id: validated.document_item_id, document_id: documentId },
        select: { id: true, document_id: true, quantity: true, unit_code: true, net_amount: true },
      });
      if (!sourceLine) throw new BadRequestException('La línea fuente no pertenece al documento indicado.');

      const targetUnitForHash = validated.supplied_target_unit_code ?? null;
      const payloadHash = this.payloadHash(documentId, validated, targetUnitForHash);
      const replay = await tx.received_document_match_allocations.findFirst({
        where: { document_id: documentId, idempotency_key: validated.idempotency_key },
        include: { tax_allocations: true },
      });
      if (replay) {
        const replayEvidence = this.asObject(replay.evidence);
        if (replayEvidence['payload_sha256'] !== payloadHash) {
          throw new ConflictException('La clave idempotente ya se usó con otra asignación.');
        }
        return {
          allocation: replay,
          document_version: document.version,
          matching_status: document.matching_status,
          duplicate: true,
        };
      }

      this.assertDocumentAllowsMatching(document);
      this.assertVersion(document.version, validated.expected_version);
      this.assertSourceCapacity(sourceLine, validated.source_quantity, validated.allocated_net_amount);
      const activeSource = await tx.received_document_match_allocations.aggregate({
        where: { organization_id: document.organization_id, accounting_entity_id: document.accounting_entity_id, document_id: documentId, document_item_id: sourceLine.id, status: 'active' },
        _sum: { source_quantity: true, allocated_net_amount: true },
      });
      this.assertWithin(
        this.decimalOrZero(activeSource._sum.source_quantity),
        validated.source_quantity,
        new Prisma.Decimal(sourceLine.quantity),
        'La cantidad asignada supera la cantidad de la línea del proveedor.',
      );
      this.assertWithin(
        this.decimalOrZero(activeSource._sum.allocated_net_amount),
        validated.allocated_net_amount,
        new Prisma.Decimal(sourceLine.net_amount),
        'El monto asignado supera el neto de la línea del proveedor.',
      );

      const normalizedCurrency = String(document.currency ?? '').trim().toUpperCase();
      const sourceUnitCode = this.optionalCode(sourceLine.unit_code);
      const target = validated.purchase_order_id != null
        ? await this.validatePurchaseTarget(tx, context, document, validated, sourceUnitCode, normalizedCurrency)
        : await this.validateExpenseTarget(tx, context, document, validated, normalizedCurrency);
      const targetQuantity = target.target_quantity;
      const effectiveStoreId = context.store_id ?? document.store_id ?? target.target_store_id ?? null;
      const taxAllocations = await this.calculateTaxAllocations(
        tx,
        document,
        sourceLine,
        validated.allocated_net_amount,
        activeSource._sum.allocated_net_amount,
      );

      const now = new Date();
      const allocation = await tx.received_document_match_allocations.create({
        data: {
          organization_id: document.organization_id,
          accounting_entity_id: document.accounting_entity_id,
          store_id: effectiveStoreId,
          document_id: documentId,
          document_item_id: sourceLine.id,
          ...(validated.purchase_order_id != null ? {
            purchase_order_id: validated.purchase_order_id,
            purchase_order_item_id: validated.purchase_order_item_id,
            ...(validated.reception_id != null ? {
              reception_id: validated.reception_id,
              reception_item_id: validated.reception_item_id,
            } : {}),
          } : {
            expense_id: validated.expense_id,
            ...(validated.expense_item_id != null ? { expense_item_id: validated.expense_item_id } : {}),
          }),
          source_quantity: validated.source_quantity,
          target_quantity: targetQuantity,
          source_unit_code: sourceUnitCode,
          target_unit_code: target.target_unit_code,
          allocated_net_amount: validated.allocated_net_amount,
          currency: normalizedCurrency,
          idempotency_key: validated.idempotency_key,
          created_by: actorId,
          confirmed_at: now,
          evidence: {
            payload_sha256: payloadHash,
            ...(validated.manual_reason ? { manual_reason: validated.manual_reason } : {}),
            uom_resolution: target.uom_resolution,
          },
        },
      });

      if (taxAllocations.length > 0) {
        await tx.received_document_match_tax_allocations.createMany({
          data: taxAllocations.map((tax) => ({
            allocation_id: allocation.id,
            document_tax_id: tax.document_tax_id,
            allocated_amount: tax.allocated_amount,
          })),
        });
      }
      const allocationWithTaxes = await tx.received_document_match_allocations.findFirst({
        where: { id: allocation.id, document_id: documentId },
        include: { tax_allocations: true },
      });
      if (!allocationWithTaxes) throw new NotFoundException('Asignación de conciliación no encontrada.');

      const matchingStatus = await this.deriveMatchingStatus(tx, documentId);
      const nextVersion = document.version + 1;
      await this.updateDocumentMatchState(tx, context, document, nextVersion, matchingStatus);
      await this.recordInternalEvent(tx, documentId, actorId, 'MATCH_CONFIRMED', allocation.id, now, nextVersion);

      return {
        allocation: allocationWithTaxes,
        document_version: nextVersion,
        matching_status: matchingStatus,
        duplicate: false,
      };
    });
  }

  async revoke(
    context: ReceivedDocumentsContext,
    documentId: number,
    allocationId: number,
    input: { expected_version: number; reason: string },
  ): Promise<AllocationResult> {
    this.assertPositiveId(documentId, 'document_id');
    this.assertPositiveId(allocationId, 'allocation_id');
    const actorId = await this.assertWriteContext(context);
    const reason = this.reason(input?.reason, 'reason');
    this.assertPositiveId(input?.expected_version, 'expected_version');
    const storeFilter = context.store_id == null
      ? Prisma.empty
      : Prisma.sql`AND "store_id" = ${context.store_id}`;

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locked = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT "id"
        FROM "received_documents"
        WHERE "id" = ${documentId}
          AND "organization_id" = ${context.organization_id}
          AND "accounting_entity_id" = ${context.accounting_entity_id}
          ${storeFilter}
        FOR UPDATE
      `);
      if (locked.length !== 1) throw new NotFoundException('Documento recibido no encontrado.');

      const document = await tx.received_documents.findFirst({
        where: this.documentWhere(context, documentId),
        select: {
          id: true,
          organization_id: true,
          accounting_entity_id: true,
          store_id: true,
          processing_status: true,
          validation_status: true,
          matching_status: true,
          fiscal_status: true,
          posting_status: true,
          accepted_at: true,
          version: true,
        },
      });
      if (!document) throw new NotFoundException('Documento recibido no encontrado.');

      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "received_document_match_allocations"
        WHERE "id" = ${allocationId} AND "document_id" = ${documentId}
        FOR UPDATE
      `);
      const allocation = await tx.received_document_match_allocations.findFirst({
        where: {
          id: allocationId,
          document_id: documentId,
          organization_id: context.organization_id,
          accounting_entity_id: context.accounting_entity_id,
          ...(context.store_id == null ? {} : { store_id: context.store_id }),
        },
        include: { tax_allocations: true },
      });
      if (!allocation) throw new NotFoundException('Asignación de conciliación no encontrada.');
      if (allocation.status === 'revoked') {
        return {
          allocation,
          document_version: document.version,
          matching_status: document.matching_status,
          duplicate: true,
        };
      }

      this.assertDocumentAllowsMatching(document);
      this.assertVersion(document.version, input.expected_version);
      const now = new Date();
      const changed = await tx.received_document_match_allocations.updateMany({
        where: { id: allocationId, document_id: documentId, status: 'active' },
        data: {
          status: 'revoked',
          revoked_by: actorId,
          revoked_at: now,
          revocation_reason: reason,
        },
      });
      if (changed.count !== 1) throw new ConflictException('La asignación cambió; vuelva a cargarla.');

      const matchingStatus = await this.deriveMatchingStatus(tx, documentId);
      const nextVersion = document.version + 1;
      await this.updateDocumentMatchState(tx, context, document, nextVersion, matchingStatus);
      await this.recordInternalEvent(tx, documentId, actorId, 'MATCH_REVOKED', allocationId, now, nextVersion, reason);

      const revoked = await tx.received_document_match_allocations.findFirst({
        where: { id: allocationId, document_id: documentId },
        include: { tax_allocations: true },
      });
      if (!revoked) throw new NotFoundException('Asignación de conciliación no encontrada.');
      return {
        allocation: revoked,
        document_version: nextVersion,
        matching_status: matchingStatus,
        duplicate: false,
      };
    });
  }

  /** Read-only allocation history plus current remaining line/target balances. */
  async list(context: ReceivedDocumentsContext, documentId: number) {
    this.assertPositiveId(documentId, 'document_id');
    await this.documents.assertContext(context);
    const document = await this.prisma.received_documents.findFirst({
      where: this.documentWhere(context, documentId),
      select: {
        id: true,
        version: true,
        matching_status: true,
        items: { orderBy: { line_number: 'asc' }, select: { id: true, line_number: true, quantity: true, net_amount: true } },
      },
    });
    if (!document) throw new NotFoundException('Documento recibido no encontrado.');
    const allocations = await this.prisma.received_document_match_allocations.findMany({
      where: {
        document_id: documentId,
        organization_id: context.organization_id,
        accounting_entity_id: context.accounting_entity_id,
        ...(context.store_id == null ? {} : { store_id: context.store_id }),
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      include: {
        tax_allocations: true,
        purchase_order_item: { select: { id: true, quantity_ordered: true, quantity_received: true } },
        reception_item: { select: { id: true, reception_id: true, purchase_order_item_id: true, quantity_received: true, reception: { select: { received_at: true } } } },
        expense: { select: { id: true, amount: true, currency: true } },
        expense_item: { select: { id: true, quantity: true, amount: true } },
      },
    });

    const activeByLine = new Map<number, { quantity: Decimal; amount: Decimal }>();
    const targets = new Map<string, {
      target_type: 'purchase_order_item' | 'expense' | 'expense_item';
      target_id: number;
      allocated_quantity: Decimal;
      allocated_amount: Decimal;
      target_limit_quantity?: Decimal;
      target_limit_amount?: Decimal;
      quantity_received?: number;
      quantity_ordered?: number;
      receipt_state?: string;
    }>();
    for (const allocation of allocations) {
      if (allocation.status !== 'active') continue;
      const lineBalance = activeByLine.get(allocation.document_item_id) ?? { quantity: this.zero(), amount: this.zero() };
      lineBalance.quantity = lineBalance.quantity.plus(allocation.source_quantity);
      lineBalance.amount = lineBalance.amount.plus(allocation.allocated_net_amount);
      activeByLine.set(allocation.document_item_id, lineBalance);

      const isPo = allocation.purchase_order_item_id != null;
      const targetType = isPo ? 'purchase_order_item' : allocation.expense_item_id != null ? 'expense_item' : 'expense';
      const targetId = allocation.purchase_order_item_id ?? allocation.expense_item_id ?? allocation.expense_id!;
      const key = `${targetType}:${targetId}`;
      const target = targets.get(key) ?? {
        target_type: targetType,
        target_id: targetId,
        allocated_quantity: this.zero(),
        allocated_amount: this.zero(),
        ...(isPo ? {
          target_limit_quantity: new Prisma.Decimal(allocation.purchase_order_item?.quantity_ordered ?? 0),
          quantity_ordered: allocation.purchase_order_item?.quantity_ordered,
          quantity_received: allocation.purchase_order_item?.quantity_received,
          receipt_state: allocation.reception_item_id == null ? 'receipt_not_linked' : 'received',
        } : allocation.expense_item_id != null ? {
          target_limit_quantity: new Prisma.Decimal(allocation.expense_item?.quantity ?? 0),
          target_limit_amount: new Prisma.Decimal(allocation.expense_item?.amount ?? 0),
        } : {
          target_limit_amount: new Prisma.Decimal(allocation.expense?.amount ?? 0),
        }),
      };
      target.allocated_quantity = target.allocated_quantity.plus(allocation.target_quantity ?? allocation.source_quantity);
      target.allocated_amount = target.allocated_amount.plus(allocation.allocated_net_amount);
      if (isPo) {
        target.quantity_ordered = allocation.purchase_order_item?.quantity_ordered;
        target.quantity_received = allocation.purchase_order_item?.quantity_received;
        target.receipt_state = allocation.reception_item_id == null
          ? 'receipt_not_linked'
          : (allocation.reception_item?.quantity_received ?? 0) > 0 ? 'received' : 'receipt_pending';
      }
      targets.set(key, target);
    }

    const receiptTargetIds = [...new Set(allocations
      .filter((allocation) => allocation.status === 'active' && allocation.reception_item_id != null)
      .map((allocation) => allocation.reception_item_id!))];
    const receiptTargets = await Promise.all(receiptTargetIds.map(async (receiptItemId) => {
      const source = allocations.find((allocation) => allocation.reception_item_id === receiptItemId)?.reception_item;
      const usage = await this.prisma.received_document_match_allocations.aggregate({
        where: { organization_id: context.organization_id, status: 'active', reception_item_id: receiptItemId },
        _sum: { target_quantity: true },
      });
      const allocated = this.decimalOrZero(usage._sum.target_quantity);
      const received = new Prisma.Decimal(source?.quantity_received ?? 0);
      const currentDocumentAllocated = allocations
        .filter((allocation) => allocation.status === 'active' && allocation.reception_item_id === receiptItemId)
        .reduce((sum, allocation) => sum.plus(allocation.target_quantity ?? allocation.source_quantity), this.zero());
      return {
        reception_item_id: receiptItemId,
        reception_id: source?.reception_id,
        purchase_order_item_id: source?.purchase_order_item_id,
        quantity_received: received.toString(),
        allocated_quantity: allocated.toString(),
        current_document_allocated_quantity: currentDocumentAllocated.toString(),
        remaining_quantity: this.nonnegative(received.minus(allocated)).toString(),
        receipt_state: received.gt(0) ? 'received' : 'receipt_pending',
      };
    }));

    const lines = document.items.map((item) => {
      const used = activeByLine.get(item.id) ?? { quantity: this.zero(), amount: this.zero() };
      return {
        document_item_id: item.id,
        line_number: item.line_number,
        quantity: item.quantity.toString(),
        allocated_quantity: used.quantity.toString(),
        remaining_quantity: this.nonnegative(new Prisma.Decimal(item.quantity).minus(used.quantity)).toString(),
        net_amount: item.net_amount.toFixed(2),
        allocated_net_amount: used.amount.toFixed(2),
        remaining_net_amount: this.nonnegative(new Prisma.Decimal(item.net_amount).minus(used.amount)).toFixed(2),
      };
    });
    return {
      document_id: document.id,
      document_version: document.version,
      matching_status: document.matching_status,
      allocations: allocations.map((allocation) => ({
        ...allocation,
        receipt_state: allocation.purchase_order_item_id == null
          ? null
          : allocation.reception_item_id == null
            ? 'receipt_not_linked'
            : (allocation.reception_item?.quantity_received ?? 0) > 0 ? 'received' : 'receipt_pending',
      })),
      lines,
      receipt_targets: receiptTargets,
      targets: await Promise.all([...targets.values()].map(async (target) => {
        const aggregate = await this.aggregateTargetUsage(target, context);
        return {
          target_type: target.target_type,
          target_id: target.target_id,
          allocated_quantity: aggregate.quantity.toString(),
          current_document_allocated_quantity: target.allocated_quantity.toString(),
          ...(target.target_limit_quantity ? {
            target_quantity: target.target_limit_quantity.toString(),
            remaining_quantity: this.nonnegative(target.target_limit_quantity.minus(aggregate.quantity)).toString(),
          } : {}),
          allocated_net_amount: aggregate.amount.toFixed(2),
          current_document_allocated_net_amount: target.allocated_amount.toFixed(2),
          ...(target.target_limit_amount ? {
            target_net_amount: target.target_limit_amount.toFixed(2),
            remaining_net_amount: this.nonnegative(target.target_limit_amount.minus(aggregate.amount)).toFixed(2),
          } : {}),
          ...(target.quantity_ordered != null ? { quantity_ordered: target.quantity_ordered } : {}),
          ...(target.quantity_received != null ? { quantity_received: target.quantity_received } : {}),
          ...(target.receipt_state ? { receipt_state: target.receipt_state } : {}),
        };
      })),
    };
  }

  private async aggregateTargetUsage(
    target: { target_type: 'purchase_order_item' | 'expense' | 'expense_item'; target_id: number },
    context: ReceivedDocumentsContext,
  ): Promise<{ quantity: Decimal; amount: Decimal }> {
    const where = target.target_type === 'purchase_order_item'
      ? { organization_id: context.organization_id, status: 'active', purchase_order_item_id: target.target_id }
      : target.target_type === 'expense_item'
        ? { organization_id: context.organization_id, status: 'active', expense_item_id: target.target_id }
        : { organization_id: context.organization_id, status: 'active', expense_id: target.target_id };
    const usage = await this.prisma.received_document_match_allocations.aggregate({
      where,
      _sum: { target_quantity: true, allocated_net_amount: true },
    });
    return {
      quantity: this.decimalOrZero(usage._sum.target_quantity),
      amount: this.decimalOrZero(usage._sum.allocated_net_amount),
    };
  }

  private async validatePurchaseTarget(
    tx: Prisma.TransactionClient,
    context: ReceivedDocumentsContext,
    document: any,
    input: ValidatedInput,
    sourceUnitCode: string | undefined,
    currency: string,
  ): Promise<{ target_quantity: Decimal; target_unit_code: string; target_store_id: number | null; uom_resolution: string }> {
    const poId = input.purchase_order_id!;
    const poItemId = input.purchase_order_item_id!;
    if (currency !== 'COP') throw new ConflictException('Las órdenes de compra legacy se concilian únicamente en COP.');

    await this.lockPurchaseOrder(tx, poId, context.organization_id);
    const order = await tx.purchase_orders.findFirst({
      where: { id: poId, organization_id: context.organization_id },
      select: {
        id: true,
        organization_id: true,
        status: true,
        supplier_id: true,
        location: { select: { id: true, organization_id: true, store_id: true, is_central_warehouse: true } },
        suppliers: { select: { id: true, tax_id: true } },
      },
    });
    if (!order || order.organization_id !== document.organization_id) {
      throw new BadRequestException('La orden de compra no pertenece a esta organización.');
    }
    if (!['approved', 'partial', 'received'].includes(order.status)) {
      throw new ConflictException('La orden de compra debe estar aprobada para conciliarse.');
    }
    if (order.location && order.location.organization_id !== context.organization_id) {
      throw new BadRequestException('La ubicación de la orden no pertenece a esta organización.');
    }
    const issuer = normalizeNit(document.issuer_tax_id).number;
    const supplierNit = normalizeNit(order.suppliers?.tax_id).number;
    if (!issuer || !supplierNit || issuer !== supplierNit) {
      throw new ConflictException('El NIT del proveedor de la orden no coincide con el emisor del documento.');
    }
    const locationStoreId = order.location?.store_id ?? null;
    if (locationStoreId != null) {
      const locationStore = await tx.stores.findFirst({
        where: { id: locationStoreId, organization_id: context.organization_id },
        select: { id: true },
      });
      if (!locationStore) throw new BadRequestException('La tienda de la ubicación no pertenece a esta organización.');
    }
    this.assertTargetStore(context, document.store_id, locationStoreId, input.manual_reason, !!order.location?.is_central_warehouse);

    await this.lockPurchaseOrderItem(tx, poId, poItemId);
    const poItem = await tx.purchase_order_items.findFirst({
      where: { id: poItemId, purchase_order_id: poId },
      select: {
        id: true,
        purchase_order_id: true,
        quantity_ordered: true,
        purchase_uom_id: true,
        product_id: true,
        products: { select: { purchase_uom_id: true } },
      },
    });
    if (!poItem) throw new BadRequestException('La línea de compra no pertenece a la orden indicada.');

    if ((input.reception_id == null) !== (input.reception_item_id == null)) {
      throw new BadRequestException('La recepción y su línea deben indicarse juntas.');
    }
    if (input.reception_id != null) {
      await this.lockReception(tx, input.reception_id, poId);
      const reception = await tx.purchase_order_receptions.findFirst({
        where: { id: input.reception_id, purchase_order_id: poId },
        select: { id: true, purchase_order_id: true },
      });
      if (!reception) throw new BadRequestException('La recepción no pertenece a la orden indicada.');
      await this.lockReceptionItem(tx, input.reception_id, input.reception_item_id!);
      const receiptItem = await tx.purchase_order_reception_items.findFirst({
        where: { id: input.reception_item_id, reception_id: input.reception_id },
        select: { id: true, reception_id: true, purchase_order_item_id: true, quantity_received: true },
      });
      if (!receiptItem || receiptItem.purchase_order_item_id !== poItemId) {
        throw new BadRequestException('La línea de recepción no corresponde a la línea de compra indicada.');
      }
    }

    const uomId = poItem.purchase_uom_id ?? poItem.products?.purchase_uom_id ?? null;
    let knownTargetUnit: string | undefined;
    if (uomId != null) {
      const uom = await tx.units_of_measure.findUnique({ where: { id: uomId }, select: { code: true, is_active: true } });
      if (uom?.is_active) knownTargetUnit = this.optionalCode(uom.code);
    }
    const units = this.resolveUnits(input, sourceUnitCode, knownTargetUnit, locationStoreId);
    const activePo = await tx.received_document_match_allocations.aggregate({
      where: { organization_id: context.organization_id, purchase_order_item_id: poItemId, status: 'active' },
      _sum: { target_quantity: true },
    });
    this.assertWithin(
      this.decimalOrZero(activePo._sum.target_quantity),
      units.target_quantity,
      new Prisma.Decimal(poItem.quantity_ordered),
      'La cantidad asignada supera la cantidad ordenada para esta línea.',
    );
    if (input.reception_item_id != null) {
      const receiptItem = await tx.purchase_order_reception_items.findFirst({
        where: { id: input.reception_item_id, reception_id: input.reception_id, purchase_order_item_id: poItemId },
        select: { quantity_received: true },
      });
      if (!receiptItem) throw new BadRequestException('La línea de recepción no corresponde a la línea de compra indicada.');
      const activeReceipt = await tx.received_document_match_allocations.aggregate({
        where: { organization_id: context.organization_id, reception_item_id: input.reception_item_id, status: 'active' },
        _sum: { target_quantity: true },
      });
      this.assertWithin(
        this.decimalOrZero(activeReceipt._sum.target_quantity),
        units.target_quantity,
        new Prisma.Decimal(receiptItem.quantity_received),
        'La cantidad asignada supera la cantidad recibida en esta recepción.',
      );
    }
    return units;
  }

  private async validateExpenseTarget(
    tx: Prisma.TransactionClient,
    context: ReceivedDocumentsContext,
    document: any,
    input: ValidatedInput,
    currency: string,
  ): Promise<{ target_quantity: Decimal; target_unit_code: string; target_store_id: number | null; uom_resolution: string }> {
    const expenseId = input.expense_id!;
    await this.lockExpense(tx, expenseId, context.organization_id);
    const expense = await tx.expenses.findFirst({
      where: { id: expenseId, organization_id: context.organization_id },
      select: { id: true, organization_id: true, store_id: true, currency: true, amount: true, state: true },
    });
    if (!expense || expense.organization_id !== document.organization_id) {
      throw new BadRequestException('El gasto no pertenece a esta organización.');
    }
    if (['rejected', 'cancelled', 'refunded'].includes(expense.state)) {
      throw new ConflictException('El gasto está cerrado y no admite nuevas conciliaciones.');
    }
    const expenseStore = await tx.stores.findFirst({
      where: { id: expense.store_id, organization_id: context.organization_id },
      select: { id: true },
    });
    if (!expenseStore) throw new BadRequestException('La tienda del gasto no pertenece a esta organización.');
    const expenseCurrency = typeof expense.currency === 'string' ? expense.currency.trim().toUpperCase() : '';
    if (!expenseCurrency || expenseCurrency !== currency) {
      throw new ConflictException('La moneda del gasto debe coincidir exactamente con el documento recibido.');
    }
    this.assertTargetStore(context, document.store_id, expense.store_id, input.manual_reason, false);

    const activeExpense = await tx.received_document_match_allocations.aggregate({
      where: { organization_id: context.organization_id, expense_id: expense.id, status: 'active' },
      _sum: { allocated_net_amount: true },
    });
    this.assertWithin(
      this.decimalOrZero(activeExpense._sum.allocated_net_amount), input.allocated_net_amount,
      new Prisma.Decimal(expense.amount), 'El monto asignado supera el saldo del gasto.',
    );
    if (input.expense_item_id != null) {
      await this.lockExpenseItem(tx, expenseId, input.expense_item_id);
      const expenseItem = await tx.expense_items.findFirst({
        where: { id: input.expense_item_id, expense_id: expenseId },
        select: { id: true, expense_id: true, amount: true, quantity: true },
      });
      if (!expenseItem) throw new BadRequestException('La línea de gasto no pertenece al gasto indicado.');
      const activeItem = await tx.received_document_match_allocations.aggregate({
        where: { organization_id: context.organization_id, expense_item_id: expenseItem.id, status: 'active' },
        _sum: { target_quantity: true, allocated_net_amount: true },
      });
      const targetQty = input.supplied_target_quantity ?? input.source_quantity;
      this.assertWithin(
        this.decimalOrZero(activeItem._sum.target_quantity), targetQty,
        new Prisma.Decimal(expenseItem.quantity), 'La cantidad asignada supera la cantidad de la línea de gasto.',
      );
      this.assertWithin(
        this.decimalOrZero(activeItem._sum.allocated_net_amount), input.allocated_net_amount,
        new Prisma.Decimal(expenseItem.amount), 'El monto asignado supera el monto de la línea de gasto.',
      );
    }
    // expense_items has no UoM field. A user assertion is always explicit.
    if (!input.supplied_target_quantity || !input.supplied_target_unit_code || !input.manual_reason) {
      throw new BadRequestException('La unidad y cantidad destino del gasto requieren declaración manual y motivo.');
    }
    return {
      target_quantity: input.supplied_target_quantity,
      target_unit_code: input.supplied_target_unit_code,
      target_store_id: expense.store_id,
      uom_resolution: 'expense_manual_unit_assertion',
    };
  }

  private resolveUnits(
    input: ValidatedInput,
    sourceUnitCode: string | undefined,
    knownTargetUnit: string | undefined,
    targetStoreId: number | null,
  ): { target_quantity: Decimal; target_unit_code: string; target_store_id: number | null; uom_resolution: string } {
    const targetUnitCode = knownTargetUnit ?? input.supplied_target_unit_code;
    if (!targetUnitCode) {
      throw new BadRequestException('La unidad destino no está configurada; declare unidad, cantidad y motivo manualmente.');
    }
    if (knownTargetUnit && input.supplied_target_unit_code && input.supplied_target_unit_code !== knownTargetUnit) {
      throw new ConflictException('La unidad destino enviada no coincide con la unidad de compra configurada.');
    }
    if (!knownTargetUnit && !input.manual_reason) {
      throw new BadRequestException('La unidad destino no está configurada; requiere una afirmación manual con motivo.');
    }

    const sameUnit = sourceUnitCode != null && sourceUnitCode === targetUnitCode;
    if (sameUnit) {
      const targetQuantity = input.supplied_target_quantity ?? input.source_quantity;
      if (!targetQuantity.eq(input.source_quantity)) {
        throw new ConflictException('Una misma unidad debe conservar la cantidad fuente; no se infiere tolerancia ni conversión.');
      }
      return {
        target_quantity: targetQuantity,
        target_unit_code: targetUnitCode,
        target_store_id: targetStoreId,
        uom_resolution: 'same_unit',
      };
    }
    if (!input.supplied_target_quantity || !input.manual_reason) {
      throw new BadRequestException('La conversión de unidades no se infiere; indique cantidad destino y motivo manual.');
    }
    return {
      target_quantity: input.supplied_target_quantity,
      target_unit_code: targetUnitCode,
      target_store_id: targetStoreId,
      uom_resolution: knownTargetUnit ? 'manual_cross_unit_assertion' : 'manual_unknown_unit_assertion',
    };
  }

  private async calculateTaxAllocations(
    tx: Prisma.TransactionClient,
    document: { document_type: string },
    sourceLine: { id: number; document_id: number; net_amount: Prisma.Decimal },
    allocatedNet: Decimal,
    priorAllocatedNetValue: Prisma.Decimal | null,
  ): Promise<Array<{ document_tax_id: number; allocated_amount: Decimal }>> {
    // Only item-level tax rows participate; header rows cannot be attributed to
    // one matched line without inventing a distribution.
    const itemTaxes = await tx.received_document_taxes.findMany({
      where: { document_id: sourceLine.document_id, item_id: sourceLine.id },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true },
    });
    if (itemTaxes.length === 0) return [];
    const lineNet = new Prisma.Decimal(sourceLine.net_amount);
    if (lineNet.isZero() && itemTaxes.some((tax) => !new Prisma.Decimal(tax.amount).isZero())) {
      throw new ConflictException('La base neta cero no permite prorratear el impuesto de la línea.');
    }
    const lineNetAfter = this.decimalOrZero(priorAllocatedNetValue).plus(allocatedNet);
    const finalPortion = lineNetAfter.gte(lineNet);
    const sign = document.document_type === 'credit_note' ? -1 : 1;
    const result: Array<{ document_tax_id: number; allocated_amount: Decimal }> = [];
    for (const tax of itemTaxes) {
      const active = await tx.received_document_match_tax_allocations.aggregate({
        where: {
          document_tax_id: tax.id,
          allocation: { is: { status: 'active' } },
        },
        _sum: { allocated_amount: true },
      });
      const activeSigned = this.decimalOrZero(active._sum.allocated_amount);
      const totalSigned = new Prisma.Decimal(tax.amount).times(sign);
      const remaining = totalSigned.minus(activeSigned);
      let amount: Decimal;
      if (finalPortion) {
        amount = remaining;
      } else if (new Prisma.Decimal(tax.amount).isZero()) {
        amount = this.zero();
      } else {
        if (lineNet.isZero()) {
          throw new ConflictException('No se puede prorratear un impuesto de línea sin base neta positiva.');
        }
        amount = totalSigned.times(allocatedNet).div(lineNet)
          .toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_EVEN);
        if (totalSigned.gt(0) && amount.gt(remaining)) amount = remaining;
        if (totalSigned.lt(0) && amount.lt(remaining)) amount = remaining;
      }
      const after = activeSigned.plus(amount);
      if ((totalSigned.gte(0) && after.gt(totalSigned)) || (totalSigned.lt(0) && after.lt(totalSigned))) {
        throw new ConflictException('La suma del impuesto conciliado supera el impuesto de la línea fuente.');
      }
      result.push({ document_tax_id: tax.id, allocated_amount: amount });
    }
    return result;
  }

  private async deriveMatchingStatus(tx: Prisma.TransactionClient, documentId: number): Promise<string> {
    const [items, allocations] = await Promise.all([
      tx.received_document_items.findMany({
        where: { document_id: documentId },
        select: { id: true, quantity: true, net_amount: true },
      }),
      tx.received_document_match_allocations.findMany({
        where: { document_id: documentId, status: 'active' },
        select: { document_item_id: true, source_quantity: true, allocated_net_amount: true },
      }),
    ]);
    if (allocations.length === 0) return 'unlinked';
    const totals = new Map<number, { quantity: Decimal; amount: Decimal }>();
    for (const allocation of allocations) {
      const total = totals.get(allocation.document_item_id) ?? { quantity: this.zero(), amount: this.zero() };
      total.quantity = total.quantity.plus(allocation.source_quantity);
      total.amount = total.amount.plus(allocation.allocated_net_amount);
      totals.set(allocation.document_item_id, total);
    }
    const allComplete = items.every((item) => {
      const total = totals.get(item.id);
      return !!total && total.quantity.gte(item.quantity) && total.amount.gte(item.net_amount);
    });
    return allComplete ? 'linked' : 'partially_linked';
  }

  private async updateDocumentMatchState(
    tx: Prisma.TransactionClient,
    context: ReceivedDocumentsContext,
    document: { id: number; version: number; store_id: number | null },
    nextVersion: number,
    matchingStatus: string,
  ): Promise<void> {
    const changed = await tx.received_documents.updateMany({
      where: {
        ...this.documentWhere(context, document.id),
        version: document.version,
      },
      data: { matching_status: matchingStatus, version: { increment: 1 } },
    });
    if (changed.count !== 1 || nextVersion !== document.version + 1) {
      throw new ConflictException('El documento cambió durante la actualización de conciliación.');
    }
  }

  private async recordInternalEvent(
    tx: Prisma.TransactionClient,
    documentId: number,
    actorId: number,
    eventType: 'MATCH_CONFIRMED' | 'MATCH_REVOKED',
    allocationId: number,
    at: Date,
    documentVersion: number,
    reason?: string,
  ): Promise<void> {
    await tx.received_document_events.create({
      data: {
        document_id: documentId,
        event_type: eventType,
        idempotency_key: `${ALLOCATION_EVENT_PREFIX}:${eventType.toLowerCase()}:${allocationId}`,
        status: 'completed',
        actor_id: actorId,
        event_date: at,
        result: {
          allocation_id: allocationId,
          document_version: documentVersion,
          ...(reason ? { reason } : {}),
        },
      },
    });
  }

  private async lockPurchaseOrder(tx: Prisma.TransactionClient, id: number, organizationId: number): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT "id" FROM "purchase_orders"
      WHERE "id" = ${id} AND "organization_id" = ${organizationId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new BadRequestException('La orden de compra no es un destino válido.');
  }

  private async lockPurchaseOrderItem(tx: Prisma.TransactionClient, poId: number, itemId: number): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT "id" FROM "purchase_order_items"
      WHERE "id" = ${itemId} AND "purchase_order_id" = ${poId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new BadRequestException('La línea de compra no pertenece a la orden indicada.');
  }

  private async lockReception(tx: Prisma.TransactionClient, id: number, poId: number): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT "id" FROM "purchase_order_receptions"
      WHERE "id" = ${id} AND "purchase_order_id" = ${poId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new BadRequestException('La recepción no pertenece a la orden indicada.');
  }

  private async lockReceptionItem(tx: Prisma.TransactionClient, receptionId: number, itemId: number): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT "id" FROM "purchase_order_reception_items"
      WHERE "id" = ${itemId} AND "reception_id" = ${receptionId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new BadRequestException('La línea de recepción no pertenece a la recepción indicada.');
  }

  private async lockExpense(tx: Prisma.TransactionClient, id: number, organizationId: number): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT "id" FROM "expenses"
      WHERE "id" = ${id} AND "organization_id" = ${organizationId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new BadRequestException('El gasto no es un destino válido.');
  }

  private async lockExpenseItem(tx: Prisma.TransactionClient, expenseId: number, itemId: number): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT "id" FROM "expense_items"
      WHERE "id" = ${itemId} AND "expense_id" = ${expenseId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new BadRequestException('La línea no pertenece al gasto indicado.');
  }

  private async assertWriteContext(context: ReceivedDocumentsContext): Promise<number> {
    if (!context || typeof context.actor_id !== 'number' || !Number.isSafeInteger(context.actor_id) || context.actor_id <= 0) {
      throw new ForbiddenException('Se requiere un usuario autorizado para conciliar documentos.');
    }
    await this.documents.assertContext(context);
    return context.actor_id;
  }

  private documentWhere(context: ReceivedDocumentsContext, documentId: number) {
    return {
      id: documentId,
      organization_id: context.organization_id,
      accounting_entity_id: context.accounting_entity_id,
      ...(context.store_id == null ? {} : { store_id: context.store_id }),
    };
  }

  private assertDocumentAllowsMatching(document: {
    processing_status: string;
    accepted_at: Date | null;
    fiscal_status: string;
    posting_status: string;
    validation_status: string;
  }): void {
    if (document.processing_status !== 'ready' || document.validation_status !== 'valid' || document.accepted_at != null ||
        TERMINAL_FISCAL_STATUSES.has(document.fiscal_status) ||
        TERMINAL_FISCAL_STATUSES.has(document.posting_status)) {
      throw new ConflictException('El documento no está disponible para conciliación comercial.');
    }
  }

  private assertTargetStore(
    context: ReceivedDocumentsContext,
    documentStoreId: number | null,
    targetStoreId: number | null,
    manualReason: string | undefined,
    isCentral: boolean,
  ): void {
    if (targetStoreId == null) {
      if (!isCentral || !manualReason) {
        throw new ConflictException('El destino no tiene tienda operativa; la conciliación requiere revisión manual con motivo.');
      }
      return;
    }
    if ((context.store_id != null && context.store_id !== targetStoreId) ||
        (documentStoreId != null && documentStoreId !== targetStoreId)) {
      throw new BadRequestException('El destino pertenece a otra tienda operativa.');
    }
  }

  private assertWithin(
    prior: Decimal,
    addition: Decimal,
    limit: Decimal,
    message: string,
  ): void {
    if (prior.plus(addition).gt(limit)) throw new ConflictException(message);
  }

  private assertSourceCapacity(
    line: { quantity: Prisma.Decimal; net_amount: Prisma.Decimal },
    sourceQuantity: Decimal,
    amount: Decimal,
  ): void {
    if (sourceQuantity.gt(line.quantity) || amount.gt(line.net_amount)) {
      throw new ConflictException('La asignación supera las cantidades o el neto de la línea fuente.');
    }
  }

  private assertVersion(actual: number, expected: number): void {
    if (actual !== expected) throw new ConflictException('El documento cambió; vuelva a cargarlo antes de conciliar.');
  }

  private validateInput(input: ConfirmMatchInput): ValidatedInput {
    if (!input || !Number.isSafeInteger(input.expected_version) || input.expected_version <= 0) {
      throw new BadRequestException('expected_version debe ser un entero positivo.');
    }
    this.assertPositiveId(input.document_item_id, 'document_item_id');
    const hasPo = input.purchase_order_id != null || input.purchase_order_item_id != null;
    const hasExpense = input.expense_id != null || input.expense_item_id != null;
    if (hasPo === hasExpense) throw new BadRequestException('Seleccione una única rama de destino: orden de compra o gasto.');
    if (hasPo && (input.purchase_order_id == null || input.purchase_order_item_id == null)) {
      throw new BadRequestException('purchase_order_id y purchase_order_item_id deben enviarse juntos.');
    }
    if (hasExpense && input.expense_id == null) throw new BadRequestException('expense_id es obligatorio en la rama de gasto.');
    if ((input.reception_id == null) !== (input.reception_item_id == null)) {
      throw new BadRequestException('reception_id y reception_item_id deben enviarse juntos.');
    }
    if (!hasPo && (input.reception_id != null || input.reception_item_id != null)) {
      throw new BadRequestException('Una recepción sólo puede asociarse a una línea de orden de compra.');
    }
    for (const [field, value] of Object.entries({
      purchase_order_id: input.purchase_order_id,
      purchase_order_item_id: input.purchase_order_item_id,
      reception_id: input.reception_id,
      reception_item_id: input.reception_item_id,
      expense_id: input.expense_id,
      expense_item_id: input.expense_item_id,
    })) {
      if (value != null) this.assertPositiveId(value, field);
    }
    if (typeof input.idempotency_key !== 'string' || input.idempotency_key.trim().length < 1 ||
        input.idempotency_key.trim().length > 160 || /[\x00-\x1f\x7f]/.test(input.idempotency_key)) {
      throw new BadRequestException('idempotency_key debe tener entre 1 y 160 caracteres válidos.');
    }
    const sourceQuantity = this.parseDecimal(input.source_quantity, QUANTITY_SCALE, 'source_quantity');
    if (sourceQuantity.lte(0)) throw new BadRequestException('source_quantity debe ser mayor que cero.');
    const targetQuantity = input.target_quantity == null
      ? undefined
      : this.parseDecimal(input.target_quantity, QUANTITY_SCALE, 'target_quantity');
    if (targetQuantity != null && targetQuantity.lte(0)) throw new BadRequestException('target_quantity debe ser mayor que cero.');
    const amount = this.parseDecimal(input.allocated_net_amount, MONEY_SCALE, 'allocated_net_amount');
    if (amount.lt(0)) throw new BadRequestException('allocated_net_amount no puede ser negativo.');
    const targetUnitCode = this.optionalCode(input.target_unit_code);
    const manualReason = input.manual_reason == null ? undefined : this.reason(input.manual_reason, 'manual_reason');
    return {
      expected_version: input.expected_version,
      idempotency_key: input.idempotency_key.trim(),
      document_item_id: input.document_item_id,
      purchase_order_id: input.purchase_order_id,
      purchase_order_item_id: input.purchase_order_item_id,
      reception_id: input.reception_id,
      reception_item_id: input.reception_item_id,
      expense_id: input.expense_id,
      expense_item_id: input.expense_item_id,
      source_quantity: sourceQuantity,
      supplied_target_quantity: targetQuantity,
      allocated_net_amount: amount,
      supplied_target_unit_code: targetUnitCode,
      manual_reason: manualReason,
    };
  }

  private payloadHash(documentId: number, input: ValidatedInput, targetUnitCode: string | null): string {
    const canonical = {
      document_id: documentId,
      document_item_id: input.document_item_id,
      purchase_order_id: input.purchase_order_id ?? null,
      purchase_order_item_id: input.purchase_order_item_id ?? null,
      reception_id: input.reception_id ?? null,
      reception_item_id: input.reception_item_id ?? null,
      expense_id: input.expense_id ?? null,
      expense_item_id: input.expense_item_id ?? null,
      source_quantity: input.source_quantity.toFixed(QUANTITY_SCALE),
      target_quantity: input.supplied_target_quantity?.toFixed(QUANTITY_SCALE) ?? null,
      allocated_net_amount: input.allocated_net_amount.toFixed(MONEY_SCALE),
      target_unit_code: targetUnitCode,
      manual_reason: input.manual_reason ?? null,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private parseDecimal(value: unknown, scale: number, field: string): Decimal {
    if (typeof value !== 'string' || value.length > 40 || !/^\d+(?:\.\d+)?$/.test(value)) {
      throw new BadRequestException(`${field} debe ser un decimal en formato string.`);
    }
    let decimal: Decimal;
    try {
      decimal = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${field} no es válido.`);
    }
    if (!decimal.isFinite() || decimal.decimalPlaces() > scale) {
      throw new BadRequestException(`${field} supera la precisión permitida.`);
    }
    const maxIntegerDigits = 15 - scale;
    if (decimal.gte(new Prisma.Decimal(10).pow(maxIntegerDigits))) {
      throw new BadRequestException(`${field} supera el rango permitido.`);
    }
    return decimal.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_EVEN);
  }

  private optionalCode(value: unknown): string | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 30 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new BadRequestException('El código de unidad no es válido.');
    }
    return value.trim().toUpperCase();
  }

  private reason(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new BadRequestException(`${field} debe ser un texto obligatorio.`);
    const reason = value.trim();
    if (reason.length < 10 || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason)) {
      throw new BadRequestException(`${field} debe tener entre 10 y 500 caracteres sin controles.`);
    }
    return reason;
  }

  private assertPositiveId(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new BadRequestException(`${field} debe ser un entero positivo.`);
  }

  private decimalOrZero(value: Prisma.Decimal | null | undefined): Decimal {
    return value == null ? this.zero() : new Prisma.Decimal(value);
  }

  private nonnegative(value: Decimal): Decimal {
    return value.lt(0) ? this.zero() : value;
  }

  private zero(): Decimal {
    return new Prisma.Decimal(0);
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
