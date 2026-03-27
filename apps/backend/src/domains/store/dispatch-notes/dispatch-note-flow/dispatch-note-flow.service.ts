import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { dispatch_note_status_enum } from '@prisma/client';
import { DeliverDispatchNoteDto, VoidDispatchNoteDto } from '../dto';

type DispatchNoteStatus = dispatch_note_status_enum;

const VALID_TRANSITIONS: Record<DispatchNoteStatus, DispatchNoteStatus[]> = {
  draft: ['confirmed', 'voided'],
  confirmed: ['delivered', 'voided'],
  delivered: ['invoiced'],
  invoiced: [],
  voided: [],
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
  ): void {
    const valid_targets = VALID_TRANSITIONS[current_status];
    if (!valid_targets || !valid_targets.includes(target_status)) {
      throw new BadRequestException(
        `Transición de estado inválida: no se puede cambiar de '${current_status}' a '${target_status}'. ` +
          `Transiciones válidas desde '${current_status}': [${(valid_targets || []).join(', ') || 'ninguna'}]`,
      );
    }
  }

  async confirm(id: number) {
    const dispatch_note = await this.getDispatchNote(id);

    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'confirmed',
    );

    // Validate customer is active
    const customer = await this.prisma.users.findUnique({
      where: { id: dispatch_note.customer_id },
      select: { id: true, state: true },
    });

    if (!customer) {
      throw new BadRequestException('El cliente asociado no existe');
    }

    const user_id = RequestContextService.getUserId();

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
    });

    this.logger.log(`Dispatch note #${id} confirmed`);
    return updated;
  }

  async deliver(id: number, dto: DeliverDispatchNoteDto) {
    const dispatch_note = await this.getDispatchNote(id);

    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'delivered',
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
    });

    this.logger.log(`Dispatch note #${id} delivered`);
    return updated;
  }

  async void(id: number, dto: VoidDispatchNoteDto) {
    const dispatch_note = await this.getDispatchNote(id);

    this.validateTransition(
      dispatch_note.status as DispatchNoteStatus,
      'voided',
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
    });

    this.logger.log(`Dispatch note #${id} invoiced`);
    return updated;
  }
}
