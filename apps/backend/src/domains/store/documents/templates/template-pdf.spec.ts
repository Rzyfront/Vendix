import { BasePdfBody, BlocksBody } from './template-body';
import { renderBasePdf, renderBlocksPdf } from './template-pdf';
import { pdfText } from './pdf-text.testutil';
import type { SignatureStamp } from './issued-document-renderer';
import { TokenScope } from './template-tokens';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- sharp's CJS export is the function itself
const sharp: typeof import('sharp').default = require('sharp');

const scope = (values: Record<string, unknown>): TokenScope => ({
  values,
  timezone: 'America/Bogota',
  currency: 'COP',
});

const body: BlocksBody = {
  page: { size: 'A4' },
  header: { text: '{{ store.name }}' },
  footer: { page_numbers: true },
  signature_slots: [
    { key: 'empleador', role_label: 'Empleador' },
    { key: 'empleado', role_label: 'Empleado' },
  ],
  blocks: [
    { type: 'heading', text: 'Contrato laboral', level: 1 },
    { type: 'paragraph', text: "{{ fields.nombre }} gana {{ fields.salario | money }} ({{ fields.salario | words }}) el {{ now | date:'largo' }}" },
    { type: 'fields', rows: [{ label: 'Cédula', value: '{{ fields.cedula }}' }] },
    { type: 'table', source: 'fields.items', columns: [{ header: 'Ítem', value: '{{ row.name }}' }] },
    { type: 'signature', slot_key: 'empleador' },
    { type: 'signature', slot_key: 'empleado' },
  ],
};
const data = scope({
  'store.name': 'Tienda Demo',
  'fields.nombre': 'Ana Pérez',
  'fields.salario': 2500000,
  'fields.cedula': '123',
  'fields.items': [{ name: 'Tornillo' }, { name: 'Tuerca' }],
  now: '2026-11-07T15:00:00.000Z',
});

const png = () => sharp({ create: { width: 40, height: 20, channels: 3, background: '#000' } }).png().toBuffer();

describe('renderBlocksPdf', () => {
  it('renders a PDF with the resolved tokens, the table rows and the pending signature boxes', async () => {
    const pdf = await renderBlocksPdf(body, { scope: data });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    expect(text).toContain('Contrato laboral');
    expect(text).toContain('Ana Pérez gana $2.500.000 (dos millones quinientos mil) el 7 de noviembre de 2026');
    expect(text).toContain('Tienda Demo');
    expect(text).toContain('Tornillo');
    expect(text).toContain('Tuerca');
    expect(text).toContain('Pendiente de firma');
    expect(text).toContain('Empleador');
    expect(text).toContain('Empleado');
    expect(text).not.toContain('VISTA PREVIA');
    expect(text).not.toContain('{{');
  });

  it('marks the preview with the watermark', async () => {
    const text = pdfText(await renderBlocksPdf(body, { scope: data, preview: true }));
    expect(text).toContain('VISTA PREVIA');
  });

  it('draws the signer identity in the box of its slot and keeps the other box pending', async () => {
    const stamp: SignatureStamp = {
      slot_key: 'empleado',
      role_label: 'Empleado',
      name: 'Ana Pérez',
      document_number: '1020304050',
      image: await png(),
      signed_at: new Date('2026-11-07T15:30:00.000Z'),
    };
    const text = pdfText(await renderBlocksPdf(body, { scope: data, signatures: [stamp] }));
    expect(text).toContain('Doc. 1020304050 · 07/11/2026 10:30');
    expect(text.match(/Pendiente de firma/g)).toHaveLength(1);
  });

  it('fails instead of leaving a gap when a required value is missing', async () => {
    await expect(renderBlocksPdf(body, { scope: scope({}) })).rejects.toThrow(/Missing value/);
  });

  it('writes the appended pages after the document', async () => {
    const pdf = await renderBlocksPdf(body, {
      scope: data,
      appendPages: (doc) => {
        doc.addPage();
        doc.text('Hoja de evidencia');
      },
    });
    expect(pdfText(pdf)).toContain('Hoja de evidencia');
  });
});

describe('renderBasePdf', () => {
  const base: BasePdfBody = {
    fields: [
      { page: 1, x: 40, y: 60, width: 200, height: 16, value: 'NIT {{ fields.nit }}' },
      { page: 1, x: 40, y: 90, width: 200, height: 16, value: "{{ now | date }}" },
    ],
    signature_slots: [{ key: 'firma', role_label: 'Representante legal', page: 1, x: 40, y: 200, width: 200, height: 60 }],
  };

  // A blank raster stands in for the rasterized base page.
  const page = async () => ({
    image: await sharp({ create: { width: 300, height: 400, channels: 3, background: '#fff' } }).jpeg().toBuffer(),
    width_pt: 300,
    height_pt: 400,
  });

  it('draws the page as background and overlays the fields and the signature box', async () => {
    const pdf = await renderBasePdf(base, [await page()], { scope: scope({ 'fields.nit': '900.123', now: '2026-11-07T15:00:00.000Z' }) });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    expect(text).toContain('NIT 900.123');
    expect(text).toContain('07/11/2026');
    expect(text).toContain('Pendiente de firma');
    expect(text).toContain('Representante legal');
    // One page, sized like the base page.
    expect(Buffer.from(pdf).toString('latin1')).toMatch(/\/MediaBox \[0 0 300 400\]/);
  });

  it('marks the preview and keeps pages that have no fields', async () => {
    const pdf = await renderBasePdf(base, [await page(), await page()], { scope: scope({ 'fields.nit': '1', now: '2026-11-07' }), preview: true });
    expect(pdfText(pdf).match(/VISTA PREVI/g)).toHaveLength(2);
  });
});
