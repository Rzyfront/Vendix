import { InvoiceHolderLinkService } from './invoice-holder-link.service';
import { createHmac } from 'crypto';

describe('CF holder links: purpose, immutable lifetime and eligibility', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  let config: Record<string, string>,
    prisma: any,
    service: InvoiceHolderLinkService,
    gate: any;
  const invoice = () => ({
    id: 5,
    store_id: 2,
    organization_id: 1,
    accounting_entity_id: 3,
    order_id: 4,
    order: { id: 4, store_id: 2, active_financial_split_id: null },
    financial_account_id: null,
    invoice_type: 'sales_invoice',
    fiscal_document_type: 'sales_invoice',
    status: 'accepted',
    transmission_status: 'accepted',
    invoice_number: 'FE-5',
    dian_status: 'accepted',
    cufe: 'verified-cufe',
    accepted_at: now,
    customer_tax_id: '222222222222',
    created_at: new Date('2026-10-14T12:00:00Z'),
  });
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    config = {
      JWT_SECRET: 'a'.repeat(40),
      FRONTEND_URL: 'https://vendix.test',
      CF_HOLDER_CHANGE_ENABLED: 'true',
    };
    prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue(invoice()),
        findMany: jest.fn(),
      },
      dian_configurations: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue({ id: 7 }),
      },
      invoice_holder_changes: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      orders: { findFirst: jest.fn() },
    };
    gate = { isAreaEnabled: jest.fn().mockResolvedValue(true) };
    service = new InvoiceHolderLinkService(
      prisma,
      { get: (key: string) => config[key] } as any,
      gate,
    );
  });
  afterEach(() => jest.useRealTimers());
  it('reprints have identical token and expiry, canonical neutral host and zero writes', async () => {
    const a = await service.getLinkForInvoice(5, 2),
      b = await service.getLinkForInvoice(5, 2);
    expect(a).toEqual(b);
    expect(a!.url).toBe(`https://vendix.test/factura/${a!.token}`);
    expect(a!.expires_at).toEqual(new Date('2026-11-13T12:00:00Z'));
    expect(service.verify(a!.token)).toMatchObject({ s: 2, o: 4, i: 5 });
    expect(
      prisma.$queryRaw.mock.calls.every(([sql]: any[]) =>
        sql.strings.join('').includes('SELECT id'),
      ),
    ).toBe(true);
  });
  it('refuses invalid signature, oversized token, UUID guest, JWT and unknown key before lookup', () => {
    for (const token of [
      'cfh1.x.a.' + 'a'.repeat(43),
      'a'.repeat(513),
      '550e8400-e29b-41d4-a716-446655440000',
      'eyJ.a.b',
    ])
      expect(() => service.verify(token)).toThrow();
    expect(prisma.invoices.findFirst).not.toHaveBeenCalled();
  });
  it('expiry boundary is exclusive and reprint cannot renew it', async () => {
    const link = await service.getLinkForInvoice(5, 2);
    jest.setSystemTime(link!.expires_at);
    expect(() => service.verify(link!.token)).toThrow(
      expect.objectContaining({ errorCode: 'CF_HOLDER_TOKEN_EXPIRED' }),
    );
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
  });
  it('rotates keys, retaining only explicitly configured old keys', async () => {
    const old = (await service.getLinkForInvoice(5, 2))!.token;
    config.CF_HOLDER_TOKEN_KEY_ID = 'jwt-v2';
    config.CF_HOLDER_TOKEN_PREVIOUS_SECRETS = JSON.stringify({
      'jwt-v1': config.JWT_SECRET,
    });
    config.JWT_SECRET = 'b'.repeat(40);
    expect(service.verify(old).i).toBe(5);
    delete config.CF_HOLDER_TOKEN_PREVIOUS_SECRETS;
    expect(() => service.verify(old)).toThrow();
  });
  it('does not trust signed malformed payload shape, lifespan, or future origin', () => {
    const sign = (payload: object) => {
      const input = `cfh1.jwt-v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
      const key = createHmac('sha256', config.JWT_SECRET)
        .update('vendix:cf-holder-link:v1')
        .digest();
      return `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`;
    };
    const a = Math.floor(now.getTime() / 1000);
    for (const payload of [
      { s: 2, o: 4, i: 5, a, e: a + 1 },
      { s: 2, o: 4, i: 5, a: a + 100, e: a + 100 + 30 * 86400 },
      { s: 2, o: 4, i: 5, a, e: a + 30 * 86400, admin: true },
      { s: 2, o: 4, i: -1, a, e: a + 30 * 86400 },
    ])
      expect(() => service.verify(sign(payload))).toThrow();
  });
  it.each([
    { customer_tax_id: '900123456' },
    { financial_account_id: 10 },
    { status: 'draft' },
    { invoice_type: 'pos_equivalent_document' },
    { order: { id: 4, store_id: 2, active_financial_split_id: 1 } },
    { created_at: null },
  ])('fails closed for ineligible document %j', async (over) => {
    prisma.invoices.findFirst.mockResolvedValue({ ...invoice(), ...over });
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
  });
  it('requires consistent acceptance ledger, FE gate and no previous operation', async () => {
    prisma.fiscal_transmissions.findFirst.mockResolvedValue(null);
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
    prisma.fiscal_transmissions.findFirst.mockResolvedValue({ id: 7 });
    gate.isAreaEnabled.mockResolvedValue(false);
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
    gate.isAreaEnabled.mockResolvedValue(true);
    prisma.invoice_holder_changes.findFirst.mockResolvedValue({ id: 1 });
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
  });
  it('admission disabled or outside allowlist returns no printed link', async () => {
    config.CF_HOLDER_CHANGE_ENABLED = 'false';
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
    config.CF_HOLDER_CHANGE_ENABLED = 'true';
    config.CF_HOLDER_CHANGE_STORE_IDS = '3,7';
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
  });
  it('keeps operation status available after unlink and admission shutdown', async () => {
    const token = (await service.getLinkForInvoice(5, 2))!.token;
    prisma.invoices.findFirst.mockResolvedValue({
      ...invoice(),
      order_id: null,
      order: null,
    });
    prisma.invoice_holder_changes.findFirst.mockResolvedValue({ id: 8 });
    config.CF_HOLDER_CHANGE_ENABLED = 'false';
    expect(await service.resolveToken(token)).toMatchObject({
      invoice_id: 5,
      order_id: 4,
      store_id: 2,
    });
  });
  it('does not print a new QR for a legacy completed refactoring without a saga', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 44 }]);
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
  });
  it.each(['submitted', 'completed'])('legacy %s status survives shutdown without admitting a new change', async status => {
    const token = '550e8400-e29b-41d4-a716-446655440000';
    prisma.$queryRaw.mockResolvedValue([{ id: 44, store_id: 2, organization_id: 1,
      order_id: 4, invoice_id: 5, expires_at: new Date('2026-10-20'), status }]);
    prisma.invoices.findFirst.mockResolvedValue({ ...invoice(), order_id: null, customer_tax_id: '900123456' });
    config.CF_HOLDER_CHANGE_ENABLED = 'false';
    await expect(service.resolveToken(token, 'status')).resolves.toMatchObject({ legacy_request_id: 44, store_id: 2 });
    await expect(service.resolveToken(token)).rejects.toThrow();
    jest.setSystemTime(new Date('2026-10-21'));
    await expect(service.resolveToken(token, 'status')).rejects.toThrow();
  });
  it('missing secret or noncanonical origin hides link without affecting the sale', async () => {
    delete config.JWT_SECRET;
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
    config.JWT_SECRET = 'a'.repeat(40);
    config.FRONTEND_URL = 'https://vendix.test/evil';
    expect(await service.getLinkForInvoice(5, 2)).toBeNull();
  });
});
