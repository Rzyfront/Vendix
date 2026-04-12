import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CustomersService } from '../customers/customers.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateQueueEntryDto } from './dto/create-queue-entry.dto';
import { v4 as uuidv4 } from 'uuid';
import { QueueEntryEvent } from './interfaces/queue-events.interface';

@Injectable()
export class CustomerQueueService {
  private readonly logger = new Logger(CustomerQueueService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly customersService: CustomersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async checkEnabled(storeId: number): Promise<void> {
    const storeSettings = await this.prisma.store_settings.findFirst({
      where: { store_id: storeId },
    });
    const settings = (storeSettings?.settings as any) || {};
    if (!settings?.pos?.customer_queue?.enabled) {
      throw new BadRequestException('CUSTOMER_QUEUE_DISABLED');
    }
  }

  private async getQueueSettings(storeId: number) {
    const storeSettings = await this.prisma.store_settings.findFirst({
      where: { store_id: storeId },
    });
    const settings = (storeSettings?.settings as any) || {};
    return settings?.pos?.customer_queue || {};
  }

  async addToQueue(storeId: number, dto: CreateQueueEntryDto) {
    await this.checkEnabled(storeId);

    // Check for active duplicates
    const existingEntry = await this.prisma.customer_queue.findFirst({
      where: {
        store_id: storeId,
        document_number: dto.document_number,
        status: { in: ['waiting', 'selected'] },
      },
    });
    if (existingEntry) {
      throw new BadRequestException('CUSTOMER_ALREADY_IN_QUEUE');
    }

    // Get queue settings
    const queueSettings = await this.getQueueSettings(storeId);
    const maxSize = queueSettings.max_queue_size || 0;

    if (maxSize > 0) {
      const activeCount = await this.prisma.customer_queue.count({
        where: { store_id: storeId, status: 'waiting' },
      });
      if (activeCount >= maxSize) {
        throw new BadRequestException('QUEUE_FULL');
      }
    }

    // Calculate position (daily reset)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const lastEntry = await this.prisma.customer_queue.findFirst({
      where: {
        store_id: storeId,
        created_at: { gte: today },
      },
      orderBy: { position: 'desc' },
    });
    const position = (lastEntry?.position || 0) + 1;

    // Calculate expiry
    const expiryHours = queueSettings.queue_expiry_hours || 12;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiryHours);

    const entry = await this.prisma.customer_queue.create({
      data: {
        store_id: storeId,
        token: uuidv4(),
        first_name: dto.first_name,
        last_name: dto.last_name,
        document_type: dto.document_type,
        document_number: dto.document_number,
        email: dto.email,
        phone: dto.phone,
        status: 'waiting',
        position,
        expires_at: expiresAt,
      },
    });

    this.eventEmitter.emit('queue.entry_added', {
      store_id: storeId,
      entry_id: entry.id,
      token: entry.token,
      position: entry.position,
      first_name: entry.first_name,
      last_name: entry.last_name,
      document_number: entry.document_number,
      status: 'waiting',
    } as QueueEntryEvent);

    return entry;
  }

  async getWaitingEntries(storeId: number) {
    return this.prisma.customer_queue.findMany({
      where: {
        store_id: storeId,
        status: { in: ['waiting', 'selected'] },
        expires_at: { gt: new Date() },
      },
      orderBy: { position: 'asc' },
    });
  }

  async selectEntry(entryId: number, cashierUserId: number) {
    const entry = await this.prisma.$transaction(async (tx) => {
      const found = await tx.customer_queue.findFirst({
        where: { id: entryId, status: 'waiting' },
      });
      if (!found) throw new NotFoundException('QUEUE_ENTRY_NOT_FOUND');

      return tx.customer_queue.update({
        where: { id: entryId },
        data: {
          status: 'selected',
          selected_by: cashierUserId,
          updated_at: new Date(),
        },
      });
    });

    this.eventEmitter.emit('queue.entry_selected', {
      store_id: entry.store_id,
      entry_id: entry.id,
      token: entry.token,
      first_name: entry.first_name,
      last_name: entry.last_name,
      document_number: entry.document_number,
      status: 'selected',
    } as QueueEntryEvent);

    return entry;
  }

  async releaseEntry(entryId: number) {
    const entry = await this.prisma.customer_queue.findFirst({
      where: { id: entryId, status: 'selected' },
    });
    if (!entry) throw new NotFoundException('QUEUE_ENTRY_NOT_FOUND');

    const updated = await this.prisma.customer_queue.update({
      where: { id: entryId },
      data: {
        status: 'waiting',
        selected_by: null,
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('queue.entry_released', {
      store_id: updated.store_id,
      entry_id: updated.id,
      token: updated.token,
      first_name: updated.first_name,
      last_name: updated.last_name,
      document_number: updated.document_number,
      status: 'waiting',
    } as QueueEntryEvent);

    return updated;
  }

  async consumeEntry(entryId: number, orderId: number, storeId: number) {
    const entry = await this.prisma.customer_queue.findFirst({
      where: { id: entryId, status: 'selected' },
    });
    if (!entry) throw new NotFoundException('QUEUE_ENTRY_NOT_FOUND');

    // Create formal customer via CustomersService
    const customer = await this.customersService.create(storeId, {
      first_name: entry.first_name,
      last_name: entry.last_name,
      document_type: entry.document_type,
      document_number: entry.document_number,
      email: entry.email || `queue_${entry.token}@placeholder.vendix.com`,
      phone: entry.phone || undefined,
    });

    const updated = await this.prisma.customer_queue.update({
      where: { id: entryId },
      data: {
        status: 'consumed',
        consumed_at: new Date(),
        order_id: orderId,
        customer_id: customer.id,
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('queue.entry_consumed', {
      store_id: updated.store_id,
      entry_id: updated.id,
      token: updated.token,
      first_name: updated.first_name,
      last_name: updated.last_name,
      document_number: updated.document_number,
      status: 'consumed',
    } as QueueEntryEvent);

    return { entry: updated, customer };
  }

  async cancelEntry(entryId: number) {
    const entry = await this.prisma.customer_queue.findFirst({
      where: { id: entryId, status: { in: ['waiting', 'selected'] } },
    });
    if (!entry) throw new NotFoundException('QUEUE_ENTRY_NOT_FOUND');

    const updated = await this.prisma.customer_queue.update({
      where: { id: entryId },
      data: {
        status: 'cancelled',
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('queue.entry_cancelled', {
      store_id: updated.store_id,
      entry_id: updated.id,
      token: updated.token,
      first_name: updated.first_name,
      last_name: updated.last_name,
      document_number: updated.document_number,
      status: 'cancelled',
    } as QueueEntryEvent);

    return updated;
  }

  async getEntryByToken(token: string) {
    const entry = await this.prisma.customer_queue.findUnique({
      where: { token },
    });
    if (!entry) throw new NotFoundException('QUEUE_ENTRY_NOT_FOUND');

    // Calculate current position among waiting entries
    const currentPosition = await this.prisma.customer_queue.count({
      where: {
        store_id: entry.store_id,
        status: 'waiting',
        position: { lte: entry.position },
        expires_at: { gt: new Date() },
      },
    });

    return { ...entry, current_position: currentPosition };
  }
}
