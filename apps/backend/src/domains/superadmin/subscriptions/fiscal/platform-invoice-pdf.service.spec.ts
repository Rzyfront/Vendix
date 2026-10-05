import { inflateSync } from 'zlib';

import { PlatformInvoicePdfService } from './platform-invoice-pdf.service';
import { InvoicePdfBuilder } from '../../../store/invoicing/services/invoice-pdf.builder';

const sharp: typeof import('sharp').default = require('sharp'); // eslint-disable-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment

/** Extrae el texto de un PDF de pdfkit (streams Flate + cadenas hex de Helvetica). */
function extractPdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    const hexRe = /<([0-9a-fA-F]+)>/g;
    let h: RegExpExecArray | null;
    let line = '';
    // Cada operador Tj/TJ cierra un renglon.
    for (const op of content.split(/\bT[jJ]\b/)) {
      line = '';
      while ((h = hexRe.exec(op))) line += Buffer.from(h[1], 'hex').toString('latin1');
      hexRe.lastIndex = 0;
      if (line) out.push(line);
    }
  }
  return out.join('\n');
}

const ORG = {
  id: 1,
  name: 'Vendix Corp',
  legal_name: 'QUICKSS S.A.S.',
  tax_id: '902056589',
  phone: '3234668500',
  email: 'admin@vendix.com',
  logo_url: null as string | null,
  fiscal_scope: 'ORGANIZATION',
  document_type: '31',
  person_type: '1',
  fiscal_responsibilities: ['O-13', 'O-47'],
  addresses: [
    {
      address_line1: 'CALLE 14H 26 13',
      city: 'Riohacha',
      state_province: 'La Guajira',
      municipality_code: '44001',
      postal_code: null,
      phone_number: '3234668500',
    },
  ],
  organization_settings: {
    settings: {
      fiscal_data: {
        nit: '902056589',
        nit_dv: '9',
        country: 'CO',
        nit_type: 'NIT',
        department: 'La Guajira',
        city: 'Riohacha',
        legal_name: 'QUICKSS S.A.S.',
        tax_regime: 'COMUN',
        person_type: 'JURIDICA',
        fiscal_address: 'CALLE 14H 26 13',
        municipality_code: '44001',
        tax_responsibilities: ['O-13', 'O-47'],
      },
    },
  },
};

const SNAPSHOT = {
  kind: 'platform_invoice_snapshot',
  resolution_id: 16,
  issue_date: '2026-09-10',
  issue_time: '20:12:57',
  payment_form: '2',
  payment_means_code: '42',
  due_date: '2026-10-10',
  notes: 'NOTA-DE-PRUEBA-ABC',
  currency: 'USD',
  exchange_rate: 4000,
  items: [
    {
      position: 1,
      quantity: 3,
      unit_code: 'LUN',
      unit_price: 100,
      line_total: 280,
      description: 'Licencia SaaS mensual',
      discount_amount: 20,
      taxes: [{ rate: 0.19, tax_type: 'IVA', tax_amount: 53.2, taxable_amount: 280 }],
    },
    {
      position: 2,
      quantity: 1,
      unit_code: 'NIU',
      unit_price: 50,
      line_total: 50,
      description: 'Servicio de consumo',
      discount_amount: 0,
      taxes: [{ rate: 0.08, tax_type: 'INC', tax_amount: 4, taxable_amount: 50 }],
    },
  ],
  totals: { total: 387.2, subtotal: 330, tax_amount: 57.2 },
  tax_breakdown: [
    { tax_type: 'IVA', rate: 0.19, base: 280, amount: 53.2 },
    { tax_type: 'INC', rate: 0.08, base: 50, amount: 4 },
  ],
  withholdings: [{ role: 'sufrida', base_amount: 330, rate: 0.1, amount: 33 }],
  customer: {
    legal_name: 'CLIENTE SAS',
    tax_id: '900066371',
    tax_id_dv: '6',
    address_line: 'carrera 6 # 12-20',
  },
};

const RES16 = {
  resolution_number: '18764114165962',
  prefix: 'VNDS',
  range_from: 1,
  range_to: 5000,
  resolution_date: new Date('2026-08-18T00:00:00Z'),
  valid_from: new Date('2026-08-18T00:00:00Z'),
  valid_to: new Date('2028-08-18T00:00:00Z'),
};

function makeTx(over: Record<string, unknown> = {}) {
  return {
    id: 69,
    organization_id: 1,
    document_number: 'VNDS1',
    document_type: 'sales_invoice',
    source_type: 'platform_invoice',
    dian_status: 'accepted',
    transmission_status: 'accepted',
    pdf_url: null as string | null,
    cufe: 'abc123',
    qr_code: null,
    created_at: new Date('2026-09-12T01:12:57.673Z'),
    ...over,
  };
}

function setup(tx: any, snapshot: any = SNAPSHOT, logo: Buffer | null = null) {
  const db: any = {
    fiscal_transmissions: { findFirst: jest.fn().mockResolvedValue(tx), update: jest.fn() },
    organizations: {
      findFirst: jest.fn().mockResolvedValue({ ...ORG, logo_url: logo ? 'organizations/1/logo.webp' : null }),
    },
    invoice_profiles: { findFirst: jest.fn().mockResolvedValue(null) },
    invoice_profile_versions: { findFirst: jest.fn().mockResolvedValue(null) },
    fiscal_evidences: { findMany: jest.fn().mockResolvedValue([{ metadata: snapshot }]) },
    platform_settings: { findUnique: jest.fn().mockResolvedValue(null) },
    invoice_resolutions: {
      findUnique: jest.fn().mockResolvedValue(RES16),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const prisma: any = { withoutScope: () => db };
  const platformOrg: any = { requirePlatformContext: jest.fn().mockResolvedValue({ organization_id: 1 }) };
  const s3: any = {
    downloadImage: jest.fn().mockResolvedValue(logo),
    uploadFile: jest.fn().mockResolvedValue(undefined),
    getPresignedUrl: jest.fn().mockImplementation(async (k: string) => `https://signed/${k}`),
  };
  return { svc: new PlatformInvoicePdfService(prisma, platformOrg, s3), db, s3 };
}

describe('PlatformInvoicePdfService (graphic representation)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps the snapshot into builder data (date, unit, taxes, withholding, payment, notes, currency)', async () => {
    const gen = jest.spyOn(InvoicePdfBuilder, 'generate').mockResolvedValue(Buffer.from('%PDF'));
    const { svc, db } = setup(makeTx());
    await svc.previewPdf(69);
    const d: any = gen.mock.calls[0][0];

    expect(d.issue_date).toBe('10/09/2026');
    expect(d.issue_time).toBe('20:12:57');
    expect(d.due_date).toBe('10/10/2026');
    expect(d.payment_form).toBe('2');
    expect(d.payment_method).toBe('42');
    expect(d.notes).toBe('NOTA-DE-PRUEBA-ABC');
    expect(d.money_decimals).toBe(2);
    expect(d.currency).toBe('USD');
    expect(d.currency_note).toContain('USD');
    expect(d.currency_note).toContain('TRM');
    expect(d.items[0].unit_label).toBe('Mes');
    expect(d.items[1].unit_label).toBe('Unidad');
    expect(d.items[0].tax_label).toBe('IVA 19%');
    expect(d.items[1].tax_label).toBe('INC 8%');
    expect(d.tax_total_lines).toEqual([
      { label: 'IVA 19%', amount: 53.2 },
      { label: 'INC 8%', amount: 4 },
    ]);
    expect(d.taxes).toHaveLength(2);
    expect(d.tax_column_label).toBe('Imp.');
    expect(d.withholding_amount).toBe(33);
    expect(d.show_net_payable).toBe(true);
    // Resolucion: la del snapshot, no la clave tecnica
    expect(db.invoice_resolutions.findUnique.mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { id: 16 } }),
    );
    expect(d.resolution_number).toBe('18764114165962');
    expect(d.resolution_prefix).toBe('VNDS');
    // Responsabilidades legibles: codigo + nombre
    expect(d.company_tax_responsibility_labels.join(' ')).toContain('O-13 Gran contribuyente');
  });

  it('falls back for old snapshots (created_at date, taxes grouped from lines, COP)', async () => {
    const gen = jest.spyOn(InvoicePdfBuilder, 'generate').mockResolvedValue(Buffer.from('%PDF'));
    const old = {
      kind: 'platform_invoice_snapshot',
      items: [
        {
          quantity: 1,
          unit_price: 100,
          line_total: 100,
          description: 'x',
          taxes: [{ rate: 0.19, tax_type: 'IVA', tax_amount: 19, taxable_amount: 100 }],
        },
      ],
      totals: { total: 119, subtotal: 100, tax_amount: 19 },
    };
    const { svc, db } = setup(makeTx(), old);
    db.invoice_resolutions.findUnique.mockResolvedValue(null);
    db.invoice_resolutions.findFirst.mockResolvedValue(RES16);
    await svc.previewPdf(69);
    const d: any = gen.mock.calls[0][0];
    expect(d.issue_date).toBe('11/09/2026'); // created_at 2026-09-12T01:12Z -> 11/09 en Bogota
    expect(d.tax_total_lines).toEqual([{ label: 'IVA 19%', amount: 19 }]);
    expect(d.tax_column_label).toBe('IVA');
    expect(d.currency_note).toBeUndefined();
    expect(d.withholding_amount).toBe(0);
    expect(d.resolution_prefix).toBe('VNDS');
  });

  it('prints the expected text in the real PDF (2 decimals, dates, units, taxes, net payable)', async () => {
    const { svc } = setup(makeTx());
    const buf = await svc.previewPdf(69);
    const text = extractPdfText(buf);
    expect(text).toContain('10/09/2026');
    expect(text).toContain('Vencimiento: 10/10/2026');
    expect(text).toContain('Unidad: Mes');
    expect(text).toContain('IVA 19%');
    expect(text).toContain('INC 8%');
    expect(text).toContain('NETO A PAGAR');
    expect(text).toContain('354,20'); // 387,20 - 33,00
    expect(text).toContain('Credito');
    expect(text).toContain('Consignacion');
    expect(text).toContain('NOTA-DE-PRUEBA-ABC');
    expect(text).toContain('TRM');
    expect(text).toContain('Documento validado por la DIAN');
    expect(text).not.toContain('NO validado');
    expect(text).toContain('O-13 Gran contribuyente');
  });

  it('shows a clear NOT validated legend when the transmission is not accepted', async () => {
    const { svc } = setup(makeTx({ dian_status: 'rejected', transmission_status: 'rejected' }));
    const text = extractPdfText(await svc.previewPdf(69));
    expect(text).toContain('Documento NO validado por la DIAN');
    expect(text).toContain('rechazado');
    expect(text).not.toContain('Documento validado por la DIAN');
  });

  it('S3 key changes with the transmission status and with the snapshot, and cache hits only on same key', async () => {
    jest.spyOn(InvoicePdfBuilder, 'generate').mockResolvedValue(Buffer.from('%PDF'));
    const a = setup(makeTx({ dian_status: 'pending', transmission_status: 'submitted' }));
    const ra = await a.svc.generatePdf(69);
    const b = setup(makeTx());
    const rb = await b.svc.generatePdf(69);
    const c = setup(makeTx(), { ...SNAPSHOT, notes: 'otra' });
    const rc = await c.svc.generatePdf(69);

    expect(ra.key).toMatch(/^platform\/invoices\/69\/VNDS1-submitted-pending-[0-9a-f]{8}\.pdf$/);
    expect(rb.key).toMatch(/^platform\/invoices\/69\/VNDS1-accepted-accepted-[0-9a-f]{8}\.pdf$/);
    expect(ra.key).not.toBe(rb.key);
    expect(rc.key).not.toBe(rb.key);

    // Cache hit: pdf_url == key actual -> no regenera
    const hit = setup(makeTx({ pdf_url: rb.key }));
    await hit.svc.generatePdf(69);
    expect(hit.s3.uploadFile).not.toHaveBeenCalled();
    // pdf_url vieja (otro estado) -> regenera
    const miss = setup(makeTx({ pdf_url: ra.key }));
    await miss.svc.generatePdf(69);
    expect(miss.s3.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('converts a WebP logo to PNG before handing it to the builder', async () => {
    const gen = jest.spyOn(InvoicePdfBuilder, 'generate').mockResolvedValue(Buffer.from('%PDF'));
    const webp = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } },
    })
      .webp()
      .toBuffer();
    const { svc } = setup(makeTx(), SNAPSHOT, webp);
    await svc.previewPdf(69);
    const logo: Buffer = (gen.mock.calls[0][0] as any).company_logo_buffer;
    expect(logo.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
