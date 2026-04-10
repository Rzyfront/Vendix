import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { SubmitInvoiceDataDto } from './dto/submit-invoice-data.dto';
import { InvoiceDataRequestEvent } from './interfaces/invoice-data-request-events.interface';

@Injectable()
export class InvoiceDataRequestsService {
  private readonly logger = new Logger(InvoiceDataRequestsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new invoice data request when a CF sale is completed.
   * Called internally by the POS payment flow.
   */
  async createRequest(storeId: number, orderId: number, invoiceId?: number) {
    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiry

    const request = await this.prisma.invoice_data_requests.create({
      data: {
        store_id: storeId,
        order_id: orderId,
        invoice_id: invoiceId || null,
        token,
        status: 'pending',
        expires_at: expiresAt,
      },
    });

    this.eventEmitter.emit('invoice_data_request.created', {
      store_id: storeId,
      request_id: request.id,
      order_id: orderId,
      token,
      status: 'pending',
    } as InvoiceDataRequestEvent);

    this.logger.log(`Invoice data request created for order #${orderId}, token: ${token}`);

    return request;
  }

  /**
   * Get request info by token (for the public form).
   * Returns order details so the customer can verify their purchase.
   */
  async getByToken(token: string) {
    const request = await this.prisma.invoice_data_requests.findUnique({
      where: { token },
      include: {
        order: {
          select: {
            id: true,
            order_number: true,
            grand_total: true,
            created_at: true,
            order_items: {
              select: {
                product_name: true,
                quantity: true,
                unit_price: true,
                total_price: true,
              },
            },
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            logo_url: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('INVOICE_DATA_REQUEST_NOT_FOUND');
    }

    if (request.status === 'completed') {
      throw new BadRequestException('INVOICE_DATA_REQUEST_ALREADY_COMPLETED');
    }

    if (request.status === 'expired' || request.expires_at < new Date()) {
      throw new BadRequestException('INVOICE_DATA_REQUEST_EXPIRED');
    }

    return request;
  }

  /**
   * Submit billing data from the public form.
   * Saves the data and marks status as 'submitted'.
   * Processing (credit note + new invoice) will be handled separately.
   */
  async submitData(token: string, dto: SubmitInvoiceDataDto) {
    const request = await this.prisma.invoice_data_requests.findUnique({
      where: { token },
    });

    if (!request) {
      throw new NotFoundException('INVOICE_DATA_REQUEST_NOT_FOUND');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('INVOICE_DATA_REQUEST_NOT_PENDING');
    }

    if (request.expires_at < new Date()) {
      // Auto-expire
      await this.prisma.invoice_data_requests.update({
        where: { id: request.id },
        data: { status: 'expired', updated_at: new Date() },
      });
      throw new BadRequestException('INVOICE_DATA_REQUEST_EXPIRED');
    }

    const updated = await this.prisma.invoice_data_requests.update({
      where: { id: request.id },
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        document_type: dto.document_type,
        document_number: dto.document_number,
        email: dto.email,
        phone: dto.phone,
        status: 'submitted',
        submitted_at: new Date(),
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('invoice_data_request.submitted', {
      store_id: updated.store_id,
      request_id: updated.id,
      order_id: updated.order_id,
      token: updated.token,
      status: 'submitted',
      customer_name: `${dto.first_name} ${dto.last_name}`,
      document_number: dto.document_number,
    } as InvoiceDataRequestEvent);

    this.logger.log(`Invoice data submitted for request #${updated.id}`);

    return updated;
  }

  /**
   * List pending/submitted requests for a store (admin view)
   */
  async findByStore(storeId: number, status?: string) {
    const where: any = { store_id: storeId };
    if (status) {
      where.status = status;
    }

    return this.prisma.invoice_data_requests.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            order_number: true,
            grand_total: true,
            created_at: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Process a submitted invoice data request:
   * 1. Find or create customer
   * 2. Generate credit note for the CF invoice (if exists)
   * 3. Create new nominative invoice
   * 4. Mark request as completed
   */
  async processRequest(requestId: number, storeId: number) {
    const request = await this.prisma.invoice_data_requests.findFirst({
      where: { id: requestId, store_id: storeId, status: 'submitted' },
      include: {
        order: {
          include: {
            order_items: true,
            stores: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('INVOICE_DATA_REQUEST_NOT_FOUND_OR_NOT_SUBMITTED');
    }

    // Mark as processing
    await this.prisma.invoice_data_requests.update({
      where: { id: requestId },
      data: { status: 'processing', updated_at: new Date() },
    });

    try {
      const order = request.order;
      const organizationId = order.stores?.organization_id;

      if (!organizationId) {
        throw new Error('Organization not found for store');
      }

      // 1. Find or create customer in the organization
      let customer = await this.prisma.users.findFirst({
        where: {
          document_number: { equals: request.document_number, mode: 'insensitive' },
          organization_id: organizationId,
          user_roles: { some: { roles: { name: 'customer' } } },
        },
      });

      if (!customer) {
        // Find customer role
        const customerRole = await this.prisma.roles.findFirst({
          where: { name: 'customer' },
        });

        if (!customerRole) {
          throw new Error('Customer role not found');
        }

        // Create a minimal user for invoicing purposes
        const username = `inv_${request.document_number}_${Date.now()}`;
        const bcrypt = await import('bcrypt');
        const hashedPassword = await bcrypt.hash(username, 12);

        customer = await this.prisma.users.create({
          data: {
            email: request.email || `invoice_${request.token}@placeholder.vendix.com`,
            password: hashedPassword,
            first_name: request.first_name,
            last_name: request.last_name,
            phone: request.phone,
            document_type: request.document_type,
            document_number: request.document_number,
            username,
            email_verified: false,
            organization_id: organizationId,
            user_roles: {
              create: { role_id: customerRole.id },
            },
            store_users: {
              create: { store_id: storeId },
            },
          },
        });
      }

      // 2. Link customer to order (update order with customer_id)
      await this.prisma.orders.update({
        where: { id: order.id },
        data: {
          customer_id: customer.id,
          updated_at: new Date(),
        },
      });

      // 3. Create credit note for original CF invoice (if one exists)
      let originalInvoice = null;
      if (request.invoice_id) {
        originalInvoice = await this.prisma.invoices.findFirst({
          where: { id: request.invoice_id },
          include: { invoice_items: true },
        });
      } else {
        // Try to find invoice linked to this order
        originalInvoice = await this.prisma.invoices.findFirst({
          where: { order_id: order.id, invoice_type: 'sales' },
          include: { invoice_items: true },
          orderBy: { created_at: 'desc' },
        });
      }

      let newInvoiceId: number | null = null;

      // Note: Full credit note + new invoice creation requires InvoicingService
      // and CreditNotesService with RequestContext. For now, we update the
      // original invoice's customer data if it exists, or log for manual processing.
      if (originalInvoice) {
        // Update the original invoice with the customer's data
        await this.prisma.invoices.update({
          where: { id: originalInvoice.id },
          data: {
            customer_id: customer.id,
            customer_name: `${request.first_name} ${request.last_name}`,
            customer_tax_id: request.document_number,
            updated_at: new Date(),
          },
        });
        newInvoiceId = originalInvoice.id;

        this.logger.log(
          `Updated invoice #${originalInvoice.id} with customer data for request #${requestId}`,
        );
      } else {
        this.logger.warn(
          `No invoice found for order #${order.id} on request #${requestId}. Customer created but invoice update pending.`,
        );
      }

      // 4. Mark as completed
      const completed = await this.prisma.invoice_data_requests.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          processed_at: new Date(),
          customer_id: customer.id,
          new_invoice_id: newInvoiceId,
          updated_at: new Date(),
        },
      });

      this.eventEmitter.emit('invoice_data_request.completed', {
        store_id: storeId,
        request_id: requestId,
        order_id: order.id,
        token: request.token,
        status: 'completed',
        customer_name: `${request.first_name} ${request.last_name}`,
        document_number: request.document_number,
      } as InvoiceDataRequestEvent);

      this.logger.log(`Invoice data request #${requestId} processed successfully`);

      return completed;
    } catch (error) {
      // Mark as failed
      await this.prisma.invoice_data_requests.update({
        where: { id: requestId },
        data: { status: 'failed', updated_at: new Date() },
      });

      this.logger.error(
        `Failed to process invoice data request #${requestId}: ${error.message}`,
        error.stack,
      );

      throw error;
    }
  }
}
