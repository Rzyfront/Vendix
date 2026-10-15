import { FiscalGateService } from '@common/services/fiscal-gate.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

export const DEFAULT_CF_HOLDER_LINK_TTL_DAYS = 30;
const TTL = DEFAULT_CF_HOLDER_LINK_TTL_DAYS * 86400;
const PREFIX = 'cfh1';
const KEY_CONTEXT = 'vendix:cf-holder-link:v1';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
interface Payload {
  s: number;
  o: number;
  i: number;
  a: number;
  e: number;
}
export interface HolderLinkBinding {
  store_id: number;
  organization_id: number;
  order_id: number;
  invoice_id: number;
  expires_at: Date;
  legacy_request_id?: number;
}
export interface InvoiceHolderLink {
  token: string;
  url: string;
  expires_at: Date;
}

@Injectable()
export class InvoiceHolderLinkService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
    private readonly fiscalGate: FiscalGateService,
  ) {}
  isAdmissionEnabled(storeId: number): boolean {
    if (
      String(this.config.get('CF_HOLDER_CHANGE_ENABLED') ?? 'false') !== 'true'
    )
      return false;
    const stores = String(
      this.config.get('CF_HOLDER_CHANGE_STORE_IDS') ?? '',
    ).trim();
    return (
      !stores ||
      stores
        .split(',')
        .some((id) => /^\d+$/.test(id.trim()) && Number(id.trim()) === storeId)
    );
  }
  private invalid(): never {
    throw new VendixHttpException(
      ErrorCodes.CF_HOLDER_TOKEN_INVALID,
      'El enlace no es válido.',
    );
  }
  private expired(): never {
    throw new VendixHttpException(
      ErrorCodes.CF_HOLDER_TOKEN_EXPIRED,
      'El enlace para cambiar el titular venció.',
    );
  }
  private key(kid: string): Buffer | null {
    const current = String(
      this.config.get('CF_HOLDER_TOKEN_KEY_ID') ?? 'jwt-v1',
    );
    let secret: unknown;
    if (kid === current) secret = this.config.get('JWT_SECRET');
    else {
      try {
        const previous = JSON.parse(
          this.config.get('CF_HOLDER_TOKEN_PREVIOUS_SECRETS') ?? '{}',
        );
        if (
          previous &&
          typeof previous === 'object' &&
          Object.prototype.hasOwnProperty.call(previous, kid)
        )
          secret = previous[kid];
      } catch {
        return null;
      }
    }
    if (typeof secret !== 'string' || secret.length < 32) return null;
    return createHmac('sha256', secret).update(KEY_CONTEXT).digest();
  }
  private origin(): string | null {
    try {
      const frontendUrl = this.config.get<string>('FRONTEND_URL');
      if (!frontendUrl) return null;
      const url = new URL(frontendUrl);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname !== '/' && url.pathname !== '')
      )
        return null;
      if (
        url.protocol !== 'https:' &&
        !(this.config.get('NODE_ENV') === 'test' && url.protocol === 'http:')
      )
        return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  /** Verify bytes, exact shape and lifetime before any identifier lookup. */
  verify(token: string, now = Math.floor(Date.now() / 1000)): Payload {
    if (typeof token !== 'string' || token.length > 512) return this.invalid();
    const parts = token.split('.');
    if (
      parts.length !== 4 ||
      parts[0] !== PREFIX ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(parts[1]) ||
      !/^[a-zA-Z0-9_-]+$/.test(parts[2]) ||
      !/^[a-zA-Z0-9_-]{43}$/.test(parts[3])
    )
      return this.invalid();
    const key = this.key(parts[1]);
    if (!key) return this.invalid();
    const signature = Buffer.from(parts[3], 'base64url');
    const expected = createHmac('sha256', key)
      .update(parts.slice(0, 3).join('.'))
      .digest();
    if (
      signature.length !== expected.length ||
      signature.toString('base64url') !== parts[3] ||
      !timingSafeEqual(signature, expected)
    )
      return this.invalid();
    let p: Payload;
    try {
      const bytes = Buffer.from(parts[2], 'base64url');
      if (bytes.toString('base64url') !== parts[2]) return this.invalid();
      p = JSON.parse(bytes.toString('utf8'));
    } catch {
      return this.invalid();
    }
    if (
      !p ||
      Object.keys(p).sort().join(',') !== 'a,e,i,o,s' ||
      ![p.s, p.o, p.i, p.a, p.e].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      p.e !== p.a + TTL ||
      p.a > now + 60
    )
      return this.invalid();
    if (now >= p.e) return this.expired();
    return p;
  }
  private async eligible(invoiceId: number, storeId?: number) {
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: invoiceId, ...(storeId ? { store_id: storeId } : {}) },
      include: {
        order: {
          select: { id: true, store_id: true, active_financial_split_id: true },
        },
      },
    });
    if (
      !invoice ||
      !this.isAdmissionEnabled(invoice.store_id) ||
      !invoice.order ||
      invoice.order.store_id !== invoice.store_id ||
      invoice.order.active_financial_split_id ||
      invoice.financial_account_id ||
      invoice.invoice_type !== 'sales_invoice' ||
      invoice.fiscal_document_type !== 'sales_invoice' ||
      invoice.status !== 'accepted' ||
      invoice.dian_status !== 'accepted' ||
      invoice.transmission_status !== 'accepted' ||
      !invoice.invoice_number ||
      !invoice.cufe ||
      !invoice.accepted_at ||
      invoice.customer_tax_id?.replace(/[^0-9]/g, '') !== '222222222222' ||
      !invoice.created_at
    )
      return null;
    const [
      configuration,
      transmission,
      operation,
      fiscalEnabled,
      legacyCompleted,
    ] = await Promise.all([
      this.prisma.dian_configurations.findFirst({
        where: {
          organization_id: invoice.organization_id,
          accounting_entity_id: invoice.accounting_entity_id,
          OR: [{ store_id: invoice.store_id }, { store_id: null }],
          configuration_type: 'invoicing',
          enablement_status: { in: ['testing', 'enabled'] },
        },
        select: { id: true },
      }),
      this.prisma.fiscal_transmissions.findFirst({
        where: {
          organization_id: invoice.organization_id,
          store_id: invoice.store_id,
          accounting_entity_id: invoice.accounting_entity_id,
          source_type: 'invoice',
          source_id: invoice.id,
          document_type: 'sales_invoice',
          document_number: invoice.invoice_number,
          transmission_status: 'accepted',
          dian_status: 'accepted',
          cufe: invoice.cufe,
          accepted_at: { not: null },
        },
        select: { id: true },
      }),
      this.prisma.invoice_holder_changes.findFirst({
        where: {
          store_id: invoice.store_id,
          organization_id: invoice.organization_id,
          original_invoice_id: invoice.id,
        },
        select: { id: true },
      }),
      this.fiscalGate.isAreaEnabled(
        invoice.organization_id,
        invoice.store_id,
        'invoicing',
      ),
      this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT id FROM invoice_data_requests
          WHERE store_id=${invoice.store_id} AND status='completed'
            AND new_invoice_id IS NOT NULL
            AND (invoice_id=${invoice.id} OR order_id=${invoice.order_id})
          LIMIT 1`),
    ]);
    return configuration &&
      transmission &&
      !operation &&
      fiscalEnabled &&
      legacyCompleted.length === 0
      ? invoice
      : null;
  }
  async getLinkForInvoice(
    invoiceId: number,
    storeId?: number,
  ): Promise<InvoiceHolderLink | null> {
    if (
      !Number.isSafeInteger(invoiceId) ||
      invoiceId <= 0 ||
      (storeId !== undefined &&
        (!Number.isSafeInteger(storeId) || storeId <= 0))
    )
      return null;
    const kid = String(this.config.get('CF_HOLDER_TOKEN_KEY_ID') ?? 'jwt-v1');
    const key = this.key(kid),
      origin = this.origin();
    if (!key || !origin || !/^[a-zA-Z0-9_-]{1,40}$/.test(kid)) return null;
    const invoice = await this.eligible(invoiceId, storeId);
    if (!invoice) return null;
    const a = Math.floor(invoice.created_at!.getTime() / 1000),
      e = a + TTL;
    if (
      !Number.isSafeInteger(a) ||
      a <= 0 ||
      !Number.isSafeInteger(e) ||
      Math.floor(Date.now() / 1000) >= e ||
      a > Math.floor(Date.now() / 1000) + 60
    )
      return null;
    const payload: Payload = {
      s: invoice.store_id,
      o: invoice.order_id!,
      i: invoice.id,
      a,
      e,
    };
    const input = `${PREFIX}.${kid}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    const token = `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`;
    return {
      token,
      url: `${origin}/factura/${encodeURIComponent(token)}`,
      expires_at: new Date(e * 1000),
    };
  }
  async resolveToken(token: string, mode: 'admission' | 'status' = 'admission'): Promise<HolderLinkBinding> {
    if (UUID.test(token)) return this.resolveLegacy(token, mode);
    const p = this.verify(token);
    const invoice = await this.prisma.invoices.findFirst({
      where: { id: p.i, store_id: p.s },
      select: { organization_id: true, created_at: true },
    });
    if (
      !invoice ||
      !invoice.created_at ||
      Math.floor(invoice.created_at.getTime() / 1000) !== p.a
    )
      return this.invalid();
    // Existing operation is checked before order linkage: unlink is a durable checkpoint.
    const operation = await this.prisma.invoice_holder_changes.findFirst({
      where: {
        organization_id: invoice.organization_id,
        store_id: p.s,
        original_invoice_id: p.i,
        original_order_id: p.o,
      },
      select: { id: true },
    });
    if (
      !operation &&
      (!(await this.eligible(p.i, p.s)) ||
        !(await this.prisma.invoices.findFirst({
          where: {
            id: p.i,
            store_id: p.s,
            organization_id: invoice.organization_id,
            order_id: p.o,
          },
          select: { id: true },
        })))
    )
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_INELIGIBLE,
        'Esta factura no permite cambiar su titular.',
      );
    return {
      store_id: p.s,
      organization_id: invoice.organization_id,
      order_id: p.o,
      invoice_id: p.i,
      expires_at: new Date(p.e * 1000),
    };
  }
  private async resolveLegacy(token: string, mode: 'admission' | 'status'): Promise<HolderLinkBinding> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        store_id: number;
        order_id: number;
        invoice_id: number | null;
        organization_id: number;
        expires_at: Date;
        status: string;
      }>
    >(Prisma.sql`
      SELECT r.id,r.store_id,r.order_id,r.invoice_id,r.expires_at,r.status,s.organization_id
      FROM invoice_data_requests r JOIN stores s ON s.id=r.store_id WHERE r.token=${token} LIMIT 1`);
    const r = rows[0];
    if (!r) return this.invalid();
    if (Date.now() >= r.expires_at.getTime()) return this.expired();
    const invoice = r.invoice_id
      ? await this.prisma.invoices.findFirst({
          where: {
            id: r.invoice_id,
            store_id: r.store_id,
            organization_id: r.organization_id,
          },
        })
      : null;
    const candidates = invoice
      ? [invoice]
      : await this.prisma.invoices.findMany({
          where: {
            order_id: r.order_id,
            store_id: r.store_id,
            organization_id: r.organization_id,
            invoice_type: 'sales_invoice',
            status: { notIn: ['cancelled', 'voided'] },
          },
          take: 2,
        });
    if (candidates.length !== 1)
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_INELIGIBLE,
        'La factura requiere revisión de la tienda.',
      );
    const original = candidates[0];
    const order = await this.prisma.orders.findFirst({
      where: { id: r.order_id, store_id: r.store_id },
      select: { active_financial_split_id: true },
    });
    const existing = await this.prisma.invoice_holder_changes.findFirst({
      where: {
        store_id: r.store_id,
        organization_id: r.organization_id,
        original_invoice_id: original.id,
        original_order_id: r.order_id,
      },
      select: { id: true },
    });
    if (
      !existing &&
      !(mode === 'status' && ['submitted', 'processing', 'completed', 'failed'].includes(r.status)) &&
      (!order ||
        order.active_financial_split_id ||
        original.invoice_type !== 'sales_invoice' ||
        original.fiscal_document_type !== 'sales_invoice' ||
        !this.isAdmissionEnabled(r.store_id) ||
        original.order_id !== r.order_id ||
        original.financial_account_id ||
        original.customer_tax_id?.replace(/[^0-9]/g, '') !== '222222222222' ||
        ![
          'draft',
          'validated',
          'sent',
          'accepted',
          'rejected',
          'voided',
          'cancelled',
        ].includes(original.status))
    )
      throw new VendixHttpException(
        ErrorCodes.CF_HOLDER_INELIGIBLE,
        'Esta factura no permite cambiar su titular.',
      );
    return {
      store_id: r.store_id,
      organization_id: r.organization_id,
      order_id: r.order_id,
      invoice_id: original.id,
      expires_at: r.expires_at,
      legacy_request_id: r.id,
    };
  }
}
