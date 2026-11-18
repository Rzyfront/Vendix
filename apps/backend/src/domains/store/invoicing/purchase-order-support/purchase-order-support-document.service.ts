import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { resolveStoreTimezone } from '../../../../common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InvoicingService } from '../invoicing.service';
import { DianConfigService } from '../dian-config/dian-config.service';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { CreatePurchaseOrderSupportDocumentDto } from '../dto/create-purchase-order-support-document.dto';
import {
  buildSupportDraft,
  computeSupportGaps,
  pickSupplierAddress,
  summarizeSupplierInvoice,
} from './purchase-order-support-gaps';

/** Estados que dejan a un documento soporte fuera de «vigente». */
const INACTIVE_DOCUMENT_STATUSES = ['cancelled', 'voided'] as const;

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  tax_id: true,
  document_type: true,
  verification_digit: true,
  addresses: {
    select: {
      address_line1: true,
      city: true,
      municipality_code: true,
    },
  },
} as const;

/**
 * QUI-684 — documento soporte generado desde una orden de compra.
 *
 * Solo orquesta: la creación real es `InvoicingService.create` /
 * `createIdempotently` (mismos cálculos, numeración y validaciones que el
 * alta manual); aquí vive la lectura de la OC, los datos faltantes y la
 * unicidad «un documento soporte vigente por OC».
 */
@Injectable()
export class PurchaseOrderSupportDocumentService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly invoicing: InvoicingService,
    private readonly dian_config: DianConfigService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    return { ...context, store_id: Number(context.store_id) };
  }

  /** La OC siempre se lee con el alcance de la tienda actual: otra tienda = 404. */
  private async loadPurchaseOrder(purchase_order_id: number) {
    const { store_id } = this.getContext();
    const po = await this.prisma.purchase_orders.findFirst({
      where: { id: purchase_order_id, location: { store_id } },
      include: {
        purchase_order_items: {
          orderBy: { id: 'asc' },
          include: {
            products: { select: { name: true } },
            product_variants: { select: { name: true } },
            purchase_order_item_taxes: { orderBy: { sequence: 'asc' } },
          },
        },
        suppliers: { select: SUPPLIER_SELECT },
        attachments: {
          select: { supplier_invoice_number: true, supplier_invoice_date: true },
          orderBy: { id: 'asc' },
        },
        payment_schedules: { select: { scheduled_date: true } },
      },
    });
    if (!po) throw new VendixHttpException(ErrorCodes.PO_FIND_001);
    return po;
  }

  private summarize(po: {
    id: number;
    order_number: string;
    status: string;
    supplier_id: number;
    total_amount: unknown;
    supplier_invoice_number?: string | null;
    supplier_invoice_date?: Date | null;
    attachments?: Array<{
      supplier_invoice_number?: string | null;
      supplier_invoice_date?: Date | null;
    }> | null;
  }) {
    return {
      id: po.id,
      order_number: po.order_number,
      status: po.status,
      supplier_id: po.supplier_id,
      total_amount: Number(po.total_amount),
      ...summarizeSupplierInvoice(po),
    };
  }

  private async findActiveDocument(purchase_order_id: number) {
    return this.prisma.invoices.findFirst({
      where: {
        purchase_order_id,
        invoice_type: 'support_document',
        status: { notIn: [...INACTIVE_DOCUMENT_STATUSES] },
      },
      select: {
        id: true,
        invoice_number: true,
        status: true,
        client_request_id: true,
      },
    });
  }

  /** Misma regla que el gate de la página de documentos soporte en el frontend. */
  private async isSupportDocumentEnabled(): Promise<boolean> {
    const configs = (await this.dian_config.getConfigs()) as Array<{
      is_default?: boolean | null;
      enablement_status?: string | null;
      certificate_expiry?: Date | string | null;
    }>;
    const def = configs.find((c) => c.is_default);
    if (!def || def.enablement_status !== 'enabled') return false;
    if (def.certificate_expiry) {
      const expiry = new Date(def.certificate_expiry);
      if (!isNaN(expiry.getTime()) && expiry <= new Date()) return false;
    }
    return true;
  }

  async getContextForPurchaseOrder(purchase_order_id: number) {
    const po = await this.loadPurchaseOrder(purchase_order_id);
    const [enabled, documents] = await Promise.all([
      this.isSupportDocumentEnabled(),
      this.prisma.invoices.findMany({
        where: { purchase_order_id, invoice_type: 'support_document' },
        select: {
          id: true,
          invoice_type: true,
          invoice_number: true,
          cufe: true,
          status: true,
          dian_status: true,
          transmission_status: true,
          issue_date: true,
          total_amount: true,
          accepted_at: true,
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const active = documents.find(
      (d) =>
        !(INACTIVE_DOCUMENT_STATUSES as readonly string[]).includes(
          String(d.status),
        ),
    );
    return {
      enabled,
      purchase_order: this.summarize(po),
      active_document_id: active?.id ?? null,
      documents: documents.map((d) => ({
        ...d,
        total_amount: Number(d.total_amount),
      })),
    };
  }

  async getDraft(purchase_order_id: number) {
    const { store_id } = this.getContext();
    const po = await this.loadPurchaseOrder(purchase_order_id);
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const draft = buildSupportDraft(po, timezone);
    const supplier = po.suppliers;
    const missing = computeSupportGaps({
      po_status: po.status,
      supplier,
      draft,
    });
    const active = await this.findActiveDocument(po.id);
    const address = pickSupplierAddress(supplier.addresses);
    return {
      purchase_order: this.summarize(po),
      active_document: active
        ? {
            id: active.id,
            invoice_number: active.invoice_number,
            status: active.status,
          }
        : null,
      supplier: {
        id: supplier.id,
        name: supplier.name,
        document_type: supplier.document_type,
        tax_id: supplier.tax_id,
        verification_digit: supplier.verification_digit,
        address_line1: address?.address_line1 ?? null,
        city: address?.city ?? null,
        municipality_code: address?.municipality_code ?? null,
      },
      draft: { supplier_id: po.supplier_id, ...draft },
      missing,
      can_emit: missing.length === 0 && !active,
    };
  }

  private conflict(active: {
    id: number;
    invoice_number: string | null;
    status: string;
  } | null): VendixHttpException {
    return new VendixHttpException(
      ErrorCodes.INVOICING_SUPPORT_PO_002,
      undefined,
      {
        active_document: active
          ? {
              id: active.id,
              invoice_number: active.invoice_number,
              status: active.status,
            }
          : null,
      },
    );
  }

  /**
   * El índice parcial `invoices_po_active_support_document_key` es la guarda
   * real ante el doble clic. No se lee `meta.target`: con el adaptador de
   * Prisma 7 puede no venir. Cualquier P2002 se resuelve re-consultando: si ya
   * hay un documento vigente para la OC, es este conflicto; si no, otro error.
   */
  private isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string } | null)?.code === 'P2002';
  }

  /**
   * Crea el documento soporte de la OC. `emit_immediately` NO se atiende aquí:
   * lo resuelve el controller con `ManualInvoiceEmissionService.emitCreated`,
   * igual que `POST /store/invoicing`.
   */
  async createFromPurchaseOrder(
    purchase_order_id: number,
    dto: CreatePurchaseOrderSupportDocumentDto,
  ) {
    const po = await this.loadPurchaseOrder(purchase_order_id);

    // El proveedor NO se corrige desde el cuerpo: se evalúa el vivo.
    const missing = computeSupportGaps({
      po_status: po.status,
      supplier: po.suppliers,
      draft: {
        issue_date: dto.issue_date,
        due_date: dto.due_date,
        payment_form: dto.payment_form,
        items: dto.items,
      },
    });
    if (missing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_SUPPORT_PO_001,
        undefined,
        { missing },
      );
    }

    // Reintento del mismo envío (misma clave): `createIdempotently` lo devuelve
    // como replay. Solo otra clave frente a un documento vigente es conflicto.
    const active = await this.findActiveDocument(po.id);
    // Misma normalización que `createIdempotently` (clave en minúsculas).
    const is_retry =
      active != null &&
      dto.client_request_id != null &&
      active.client_request_id === dto.client_request_id.toLowerCase();
    if (active && !is_retry) throw this.conflict(active);

    const invoice_dto = {
      invoice_type: 'support_document',
      supplier_id: po.supplier_id,
      issue_date: dto.issue_date,
      due_date: dto.due_date,
      payment_form: dto.payment_form,
      payment_means_code: dto.payment_means_code,
      notes: dto.notes,
      withholding_amount: dto.withholding_amount,
      withholdings: dto.withholdings,
      items: dto.items,
      client_request_id: dto.client_request_id,
    } as CreateInvoiceDto;
    const options = { purchase_order_id: po.id };

    try {
      return dto.client_request_id
        ? await this.invoicing.createIdempotently(invoice_dto, options)
        : {
            invoice: await this.invoicing.create(invoice_dto, options),
            replayed: false,
          };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const winner = await this.findActiveDocument(po.id);
        if (winner) throw this.conflict(winner);
      }
      throw error;
    }
  }
}
