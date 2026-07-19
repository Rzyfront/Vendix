import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  dispatch_note_status_enum,
  dispatch_note_direction_enum,
  serial_status_enum,
  sales_document_item_type_enum,
} from '@prisma/client';
import {
  ConfirmDispatchNoteDto,
  DeliverDispatchNoteDto,
  VoidDispatchNoteDto,
} from '../dto';
import { SerialNumberEnforcementService } from '../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../inventory/serial-numbers/inventory-serial-numbers.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

type DispatchNoteStatus = dispatch_note_status_enum;
type DispatchNoteDirection = dispatch_note_direction_enum;

/**
 * Valid state transitions per direction. Outbound follows the classic
 * draft→confirmed→delivered→invoiced cycle. Inbound follows
 * draft→confirmed→received (received is terminal for inbound — invoiced
 * does not apply).
 */
const VALID_TRANSITIONS_BY_DIRECTION: Record<
  DispatchNoteDirection,
  Record<DispatchNoteStatus, DispatchNoteStatus[]>
> = {
  outbound: {
    // delivered → voided is now VALID (Fase 2): voiding a delivered remisión
    // triggers the symmetric stock reversal in the listener. Once invoiced,
    // void is blocked (invoiced: []) — that requires a credit note.
    draft: ['confirmed', 'voided'],
    confirmed: ['delivered', 'voided'],
    delivered: ['invoiced', 'voided'],
    received: [],
    invoiced: [],
    voided: [],
  },
  inbound: {
    // received → voided is now VALID (Fase 2): voiding a received inbound
    // remisión reverses the stock-in via the listener (stock_out -qty).
    draft: ['confirmed', 'voided'],
    confirmed: ['received', 'voided'],
    delivered: [],
    received: ['voided'],
    invoiced: [],
    voided: [],
  },
};

const DISPATCH_NOTE_INCLUDE = {
  dispatch_note_items: {
    include: {
      product: true,
      product_variant: true,
      location: true,
    },
  },
  customer: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
    },
  },
  sales_order: {
    select: {
      id: true,
      order_number: true,
      status: true,
    },
  },
  dispatch_location: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  confirmed_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  delivered_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  voided_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

@Injectable()
export class DispatchNoteFlowService {
  private readonly logger = new Logger(DispatchNoteFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly serialEnforcement: SerialNumberEnforcementService,
    private readonly serials: InventorySerialNumbersService,
  ) {}

  private async getDispatchNote(id: number) {
    const dispatch_note = await this.prisma.dispatch_notes.findFirst({
      where: { id },
      include: DISPATCH_NOTE_INCLUDE,
    });

    if (!dispatch_note) {
      throw new NotFoundException(`Remisión #${id} no encontrada`);
    }

    return dispatch_note;
  }

  private validateTransition(
    current_status: DispatchNoteStatus,
    target_status: DispatchNoteStatus,
    direction: DispatchNoteDirection = dispatch_note_direction_enum.outbound,
  ): void {
    const transitions = VALID_TRANSITIONS_BY_DIRECTION[direction];
    const valid_targets = transitions?.[current_status];
    if (!valid_targets || !valid_targets.includes(target_status)) {
      throw new BadRequestException(
        `Transición de estado inválida: no se puede cambiar de '${current_status}' a '${target_status}' (direction: ${direction}). ` +
          `Transiciones válidas desde '${current_status}': [${(valid_targets || []).join(', ') || 'ninguna'}]`,
      );
    }
  }

  /**
   * Confirm a remisión (draft → confirmed).
   *
   * QUI-431 — Serial enforcement for B2B dispatch. For every dispatch line whose
   * product is serialized (`products.requires_serial_numbers = true`) the caller
   * MUST provide the concrete units being dispatched (as pool ids and/or free
   * text). The confirm step then, ATOMICALLY (one $transaction):
   *   1. Resolves free-text serials into real pool rows.
   *   2. Enforces that exactly `dispatched_quantity` valid in_stock/reserved
   *      serials were supplied (else SERIAL_REQUIRED_001 — the note STAYS draft).
   *   3. Transitions each serial `in_stock → reserved`.
   *   4. Links each serial to the dispatch line via `sales_document_serials`
   *      (document_item_type = 'dispatch_note_item'). The
   *      @@unique([document_item_type, serial_number_id]) constraint is the
   *      anti-double-dispatch guard (SERIAL_DUP_001 on a concurrent commit).
   *      Linking at CONFIRM (not deliver) makes the serial↔line binding durable
   *      so the async deliver/void listeners can find exactly which serials to
   *      transition without ambiguity.
   *   5. Writes a human-readable `lot_serial` CSV snapshot on the line (already
   *      printed on the remisión PDF) and flips status to `confirmed`.
   *
   * Non-serialized products ignore the serial fields completely (the
   * enforcement service no-ops). When NO line is serialized, the legacy single
   * `dispatch_notes.update` path is taken (no transaction overhead).
   */
  async confirm(id: number, dto?: ConfirmDispatchNoteDto) {
    const dispatch_note = await this.getDispatchNote(id);

    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'confirmed',
      dispatch_note.direction as DispatchNoteDirection,
    );

    // Validate customer is active — only for customer-linked notes. Inbound
    // purchase_receipt (supplier_id) and transfer_out/transfer_in (location)
    // carry no customer_id; guarding avoids a Prisma `id must not be null`
    // crash when confirming those bidirectional subtypes.
    if (dispatch_note.customer_id) {
      const customer = await this.prisma.users.findUnique({
        where: { id: dispatch_note.customer_id },
        select: { id: true, state: true },
      });

      if (!customer) {
        throw new BadRequestException('El cliente asociado no existe');
      }
    }

    const user_id = RequestContextService.getUserId();

    // Map per-item serial input by dispatch_note_item_id for O(1) lookup.
    const serialsByItem = new Map(
      (dto?.item_serials ?? []).map((s) => [s.dispatch_note_item_id, s]),
    );

    // Detect whether any line is serialized. If none are, keep the original
    // lightweight non-transactional update (behavior unchanged for the 99%
    // of remisiones that carry no serialized goods).
    let anySerialized = false;
    for (const item of dispatch_note.dispatch_note_items) {
      if (await this.serialEnforcement.isSerialized(item.product_id)) {
        anySerialized = true;
        break;
      }
    }

    if (!anySerialized) {
      const updated = await this.prisma.dispatch_notes.update({
        where: { id },
        data: {
          status: 'confirmed',
          confirmed_by_user_id: user_id,
          confirmed_at: new Date(),
          updated_at: new Date(),
        },
        include: DISPATCH_NOTE_INCLUDE,
      });

      this.eventEmitter.emit('dispatch_note.confirmed', {
        dispatch_note_id: id,
        dispatch_number: updated.dispatch_number,
        store_id: updated.store_id,
        sales_order_id: updated.sales_order_id,
        order_id: updated.order_id,
      });

      this.logger.log(`Dispatch note #${id} confirmed`);
      return updated;
    }

    // ── Serialized path: enforce + reserve + link + snapshot, all-or-nothing.
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of dispatch_note.dispatch_note_items) {
        const isSerialized = await this.serialEnforcement.isSerialized(
          item.product_id,
          tx,
        );
        if (!isSerialized) continue;

        const location_id =
          item.location_id ?? dispatch_note.dispatch_location_id ?? null;
        if (!location_id) {
          // Serialized goods cannot be dispatched without a location: the pool
          // rows are scoped relationally by location, so we cannot resolve or
          // reserve serials. Reuse SERIAL_REQUIRED_001 with diagnostic context.
          throw new VendixHttpException(
            ErrorCodes.SERIAL_REQUIRED_001,
            'A dispatch location is required to dispatch serialized products',
            { dispatch_note_item_id: item.id, product_id: item.product_id },
          );
        }

        const input = serialsByItem.get(item.id);

        // Resolve free text into real pool rows (no-op for non-serialized; here
        // always serialized), then merge with any explicit ids.
        const freeTextIds =
          input?.serial_numbers && input.serial_numbers.length > 0
            ? await this.serialEnforcement.resolveOrCreateFromFreeText(
                item.product_id,
                location_id,
                input.serial_numbers,
                tx,
                item.product_variant_id ?? undefined,
              )
            : [];
        const serialIds = Array.from(
          new Set([...(input?.serial_ids ?? []), ...freeTextIds]),
        );

        // Strict: exactly dispatched_quantity valid in_stock/reserved serials.
        await this.serialEnforcement.requireConfirmedSerials(
          item.product_id,
          item.dispatched_quantity,
          serialIds,
          tx,
        );

        // Reserve each serial + bind it to this dispatch line. Collect the
        // human-readable serial_number for the CSV snapshot.
        const serialNumbers: string[] = [];
        for (const serial_id of serialIds) {
          const reserved = await this.serials.transition(
            serial_id,
            serial_status_enum.reserved,
            tx,
          );
          if (reserved?.serial_number) {
            serialNumbers.push(reserved.serial_number);
          }
          await this.serials.linkToDocument(
            serial_id,
            sales_document_item_type_enum.dispatch_note_item,
            item.id,
            tx,
          );
        }

        // Persist the readable snapshot on the line (printed on the PDF). Cap to
        // the lot_serial VarChar(100) budget so the write never truncates-fail.
        if (serialNumbers.length > 0) {
          await tx.dispatch_note_items.update({
            where: { id: item.id },
            data: { lot_serial: this.buildLotSerialCsv(serialNumbers) },
          });
        }
      }

      return tx.dispatch_notes.update({
        where: { id },
        data: {
          status: 'confirmed',
          confirmed_by_user_id: user_id,
          confirmed_at: new Date(),
          updated_at: new Date(),
        },
        include: DISPATCH_NOTE_INCLUDE,
      });
    });

    this.eventEmitter.emit('dispatch_note.confirmed', {
      dispatch_note_id: id,
      dispatch_number: updated.dispatch_number,
      store_id: updated.store_id,
      sales_order_id: updated.sales_order_id,
      order_id: updated.order_id,
    });

    this.logger.log(`Dispatch note #${id} confirmed (serials reserved)`);
    return updated;
  }

  /**
   * Join serial numbers into a CSV that fits the `dispatch_note_items.lot_serial`
   * VarChar(100) column. When the full list would overflow, keep as many whole
   * serials as fit and append a "+N" overflow marker. The strong link is the
   * `sales_document_serials` junction; this is only a printable snapshot.
   */
  private buildLotSerialCsv(serialNumbers: string[]): string {
    const MAX = 100;
    const full = serialNumbers.join(', ');
    if (full.length <= MAX) return full;

    const kept: string[] = [];
    let length = 0;
    for (let i = 0; i < serialNumbers.length; i++) {
      const piece = serialNumbers[i];
      const addition = (kept.length > 0 ? 2 : 0) + piece.length;
      const remaining = serialNumbers.length - (kept.length + 1);
      const marker = remaining > 0 ? ` +${remaining}` : '';
      if (length + addition + marker.length > MAX) break;
      kept.push(piece);
      length += addition;
    }
    const remaining = serialNumbers.length - kept.length;
    const base = kept.join(', ');
    return remaining > 0 ? `${base} +${remaining}` : base;
  }

  async deliver(id: number, dto: DeliverDispatchNoteDto) {
    const dispatch_note = await this.getDispatchNote(id);

    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'delivered',
      dispatch_note.direction as DispatchNoteDirection,
    );

    const user_id = RequestContextService.getUserId();

    const updated = await this.prisma.dispatch_notes.update({
      where: { id },
      data: {
        status: 'delivered',
        delivered_by_user_id: user_id,
        delivered_at: new Date(),
        actual_delivery_date: dto.actual_delivery_date
          ? new Date(dto.actual_delivery_date)
          : new Date(),
        ...(dto.notes && { notes: dto.notes }),
        updated_at: new Date(),
      },
      include: DISPATCH_NOTE_INCLUDE,
    });

    this.eventEmitter.emit('dispatch_note.delivered', {
      dispatch_note_id: id,
      dispatch_number: updated.dispatch_number,
      store_id: updated.store_id,
      sales_order_id: updated.sales_order_id,
      order_id: updated.order_id,
    });

    this.logger.log(`Dispatch note #${id} delivered`);
    return updated;
  }

  async void(id: number, dto: VoidDispatchNoteDto) {
    const dispatch_note = await this.getDispatchNote(id);

    // Fase 2: voiding a delivered (outbound) or received (inbound) remisión is
    // now allowed. The listener's `dispatch_note.voided` handler performs the
    // symmetric stock reversal (return/+qty for outbound, stock_out/-qty for
    // inbound), reverts serials, and releases order_items.inventory_committed.
    // Invoiced notes stay non-voidable (invoiced: [] in the transition map) —
    // those require a credit note via the return_orders flow.
    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'voided',
      dispatch_note.direction as DispatchNoteDirection,
    );

    const user_id = RequestContextService.getUserId();

    const updated = await this.prisma.dispatch_notes.update({
      where: { id },
      data: {
        status: 'voided',
        voided_by_user_id: user_id,
        voided_at: new Date(),
        void_reason: dto.void_reason,
        updated_at: new Date(),
      },
      include: DISPATCH_NOTE_INCLUDE,
    });

    this.eventEmitter.emit('dispatch_note.voided', {
      dispatch_note_id: id,
      dispatch_number: updated.dispatch_number,
      store_id: updated.store_id,
      sales_order_id: updated.sales_order_id,
      order_id: updated.order_id,
      void_reason: dto.void_reason,
    });

    this.logger.log(`Dispatch note #${id} voided: ${dto.void_reason}`);
    return updated;
  }

  async invoice(id: number) {
    const dispatch_note = await this.getDispatchNote(id);

    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'invoiced',
      dispatch_note.direction as DispatchNoteDirection,
    );

    const updated = await this.prisma.dispatch_notes.update({
      where: { id },
      data: {
        status: 'invoiced',
        updated_at: new Date(),
      },
      include: DISPATCH_NOTE_INCLUDE,
    });

    this.eventEmitter.emit('dispatch_note.invoiced', {
      dispatch_note_id: id,
      dispatch_number: updated.dispatch_number,
      store_id: updated.store_id,
      sales_order_id: updated.sales_order_id,
      order_id: updated.order_id,
    });

    this.logger.log(`Dispatch note #${id} invoiced`);
    return updated;
  }

  /**
   * Receive an inbound dispatch note (confirmed → received).
   *
   * This is the inbound equivalent of `deliver()` for outbound notes. It marks
   * the goods as physically received at the destination location and stamps
   * `actual_delivery_date` (reused as the reception timestamp — there is no
   * dedicated `received_at` column). Emits `dispatch_note.received` which the
   * listener uses to fire StockLevelManager.updateStock with the appropriate
   * movement_type per subtype (stock_in for purchase_receipt, transfer for
   * transfer_in, return for customer_return).
   */
  async receive(id: number) {
    const dispatch_note = await this.getDispatchNote(id);

    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'received',
      dispatch_note.direction as DispatchNoteDirection,
    );

    const user_id = RequestContextService.getUserId();

    const updated = await this.prisma.dispatch_notes.update({
      where: { id },
      data: {
        status: 'received',
        // Reuse actual_delivery_date as the reception timestamp (no dedicated
        // received_at column in the schema). delivered_by_user_id is also
        // reused for the receiving user audit trail.
        delivered_by_user_id: user_id,
        delivered_at: new Date(),
        actual_delivery_date: new Date(),
        updated_at: new Date(),
      },
      include: DISPATCH_NOTE_INCLUDE,
    });

    // emitAsync (not emit): await the `received` listener so the stock-in and,
    // for PO-linked purchase_receipts, the delegated `PurchaseOrdersService.receive()`
    // (which creates the purchase_order_reception) FINISH before this HTTP call
    // returns. Callers that chain a payment right after receive (e.g. the POP
    // "crear + recibir + pagar" flow) would otherwise race: the payment would
    // count 0 receptions and misclassify as a supplier advance (DR 133005)
    // instead of settling the payable (DR 2205). handleReceived owns its own
    // try/catch, so a listener fault surfaces here as a failed receive rather
    // than a silently-swallowed stock-in.
    await this.eventEmitter.emitAsync('dispatch_note.received', {
      dispatch_note_id: id,
      dispatch_number: updated.dispatch_number,
      store_id: updated.store_id,
      direction: updated.direction,
      subtype: updated.subtype,
      supplier_id: updated.supplier_id,
      related_dispatch_id: updated.related_dispatch_id,
      from_location_id: updated.from_location_id,
      to_location_id: updated.to_location_id,
    });

    this.logger.log(`Dispatch note #${id} received (inbound)`);
    return updated;
  }
}
