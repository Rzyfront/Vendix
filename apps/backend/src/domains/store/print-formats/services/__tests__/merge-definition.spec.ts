import { Test, TestingModule } from '@nestjs/testing';
import { PrintGatewayService } from '../print-gateway.service';
import { FiscalInvoicePdfRenderService } from '../fiscal-invoice-pdf-render.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { DocumentDataProviderRegistry } from '../../providers/document-data-provider.registry';
import { PrintLayoutComposerService } from '../print-layout-composer.service';
import { PrintFiscalValidatorService } from '../print-fiscal-validator.service';
import {
  PrintFormatDefinition,
} from '../../interfaces/print-format.interface';

/**
 * [print-editor-dsk P1.4] — `mergeDefinition` ya hace deep merge por id.
 *
 * El comportamiento anterior era SHALLOW: si el Hub guardaba un override con
 * sólo `sections[0]`, el array COMPLETO se reemplazaba — el resto de las
 * secciones que la tienda nunca tocó desaparecían del render. Igual con
 * `columns` y `tokens`. Estos 6 casos fijan el contrato nuevo:
 *
 * 1. overrides vacío → base intacto.
 * 2. override de UNA sección → reemplaza esa entrada, conserva las demás.
 * 3. override de UNA columna → reemplaza esa entrada, conserva las demás;
 *    `width_percent` se mezcla campo a campo.
 * 4. sección NUEVA (id no estaba en base) → se añade al final.
 * 5. tokens por path → unión sin duplicados, override gana en conflicto.
 * 6. `logo` se sustituye entero cuando llega, base NO se preserva parcialmente.
 *
 * La función es `private`, así que se ejercita a través de `preview()` (camino
 * real del Hub cuando un merchant edita y previsualiza) y `resolveEffectiveConfig`
 * (camino del render). En ambos casos la cobertura es la misma.
 */
describe('PrintGatewayService — mergeDefinition (P1.4 deep merge)', () => {
  /**
   * Definición base con el universo de campos que el composer / validator
   * tocan. Mantenerla realista: los ids son los mismos que la plantilla del
   * sistema de una factura electrónica usa en producción.
   */
  const baseDefinition = (): PrintFormatDefinition => ({
    v: 2,
    paper: {
      format: 'letter',
      width_mm: 216,
      height_mm: 280,
      is_roll: false,
      margin_mm: 10,
      margin_top_mm: 10,
      margin_right_mm: 10,
      margin_bottom_mm: 10,
      margin_left_mm: 10,
      copies: 1,
      orientation: 'portrait',
    },
    logo: { url: 'logos/base.png', position: 'left', size_mm: 20 },
    company_block: {
      fields: [
        { key: 'NIT', enabled: true },
        { key: 'address', enabled: true },
      ],
    },
    sections: [
      { id: 'header', type: 'header', title: 'Encabezado', enabled: true, order: 1 },
      { id: 'totals', type: 'totals_summary', title: 'Totales', enabled: true, order: 2 },
      { id: 'footer', type: 'footer', title: 'Pie', enabled: true, order: 3 },
    ],
    columns: [
      { id: 'sku', key: 'sku', label: 'SKU', enabled: true, width_percent: 20, align: 'left' },
      { id: 'name', key: 'name', label: 'Nombre', enabled: true, width_percent: 50, align: 'left' },
      { id: 'qty', key: 'qty', label: 'Cant.', enabled: true, width_percent: 15, align: 'right' },
      { id: 'total', key: 'total', label: 'Total', enabled: true, width_percent: 15, align: 'right' },
    ],
    styles: { font_family: 'Arial', font_size_base_pt: 9 },
    tokens: [
      { token: '{{nit}}', path: 'invoice.issuer.nit', description: 'NIT emisor', example: '900123456' },
      { token: '{{total}}', path: 'invoice.totals.total', description: 'Total', example: '$0' },
    ],
  });

  const buildPrisma = (definition: PrintFormatDefinition) => ({
    store_print_format_configs: {
      findFirst: jest.fn().mockResolvedValue({
        id: 1,
        is_active: true,
        gateway_enabled: true,
        overrides: null,
        template: { definition },
      }),
    },
    stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }) },
    print_templates: { findFirst: jest.fn().mockResolvedValue(null) },
    invoices: { findFirst: jest.fn().mockResolvedValue(null) },
  });

  async function build(prismaStub: unknown): Promise<PrintGatewayService> {
    const composeSpy = jest.fn().mockReturnValue('<html></html>');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintGatewayService,
        { provide: StorePrismaService, useValue: prismaStub },
        { provide: DocumentDataProviderRegistry, useValue: { getProvider: jest.fn().mockReturnValue({
          fetchDocumentData: jest.fn(),
          getSampleData: jest.fn().mockResolvedValue({}),
          getAvailableTokens: jest.fn().mockReturnValue([]),
        }) } },
        { provide: PrintLayoutComposerService, useValue: { compose: composeSpy } },
        { provide: PrintFiscalValidatorService, useValue: { assertFiscalCompliance: jest.fn() } },
        { provide: FiscalInvoicePdfRenderService, useValue: { renderBuffer: jest.fn() } },
      ],
    }).compile();
    return module.get(PrintGatewayService);
  }

  it('overrides vacío devuelve la base intacta', async () => {
    const base = baseDefinition();
    const service = await build(buildPrisma(base));

    const out = await service.preview(10, 'fiscal_electronic_invoice', {});

    expect(out.definition).toEqual(base);
    expect(out.definition.sections).toHaveLength(3);
    expect(out.definition.columns).toHaveLength(4);
    expect(out.definition.tokens).toHaveLength(2);
  });

  it('override de UNA sección reemplaza esa entrada; las demás secciones se conservan', async () => {
    const base = baseDefinition();
    const service = await build(buildPrisma(base));

    const out = await service.preview(10, 'fiscal_electronic_invoice', {
      sections: [
        // Mismo id `header` → se reemplaza
        { id: 'header', type: 'header', title: 'Encabezado personalizado', enabled: false, order: 1 },
      ],
    });

    expect(out.definition.sections).toHaveLength(3);
    const header = out.definition.sections!.find((s) => s.id === 'header')!;
    expect(header.title).toBe('Encabezado personalizado');
    expect(header.enabled).toBe(false);
    // Las otras dos secciones siguen presentes y sin tocar.
    expect(out.definition.sections!.map((s) => s.id).sort()).toEqual(['footer', 'header', 'totals']);
    const totals = out.definition.sections!.find((s) => s.id === 'totals')!;
    expect(totals.title).toBe('Totales');
  });

  it('override de UNA columna reemplaza esa entrada; las demás columnas se conservan con sus widths', async () => {
    const base = baseDefinition();
    const service = await build(buildPrisma(base));

    const out = await service.preview(10, 'fiscal_electronic_invoice', {
      columns: [
        // Mismo id `qty` → reemplazo total del objeto (no merge campo a campo de columnas,
        // el contrato es replace-by-id). Las demás columnas siguen intactas.
        { id: 'qty', key: 'qty', label: 'Cantidad', enabled: false, width_percent: 25, align: 'center' },
      ],
    });

    expect(out.definition.columns).toHaveLength(4);
    const qty = out.definition.columns!.find((c) => c.id === 'qty')!;
    expect(qty.width_percent).toBe(25);
    expect(qty.align).toBe('center');
    expect(qty.enabled).toBe(false);

    // sku / name / total siguen con sus widths originales.
    const sku = out.definition.columns!.find((c) => c.id === 'sku')!;
    expect(sku.width_percent).toBe(20);
    const name = out.definition.columns!.find((c) => c.id === 'name')!;
    expect(name.width_percent).toBe(50);
    const total = out.definition.columns!.find((c) => c.id === 'total')!;
    expect(total.width_percent).toBe(15);
  });

  it('sección NUEVA (id no estaba en base) se append al final; las existentes se conservan en su posición', async () => {
    const base = baseDefinition();
    const service = await build(buildPrisma(base));

    const out = await service.preview(10, 'fiscal_electronic_invoice', {
      sections: [
        { id: 'legal_disclaimer', type: 'legal', title: 'Pie legal', enabled: true, order: 99 },
      ],
    });

    expect(out.definition.sections).toHaveLength(4);
    expect(out.definition.sections!.map((s) => s.id)).toEqual([
      'header',
      'totals',
      'footer',
      'legal_disclaimer',
    ]);
  });

  it('tokens se unen por path: override gana en conflicto, paths nuevos se añaden, no hay duplicados', async () => {
    const base = baseDefinition();
    const service = await build(buildPrisma(base));

    const out = await service.preview(10, 'fiscal_electronic_invoice', {
      tokens: [
        // Mismo path → reemplaza el token existente
        { token: '{{nit}}', path: 'invoice.issuer.nit', description: 'NIT del emisor (sobrescrito)', example: '900123456-7' },
        // Path nuevo → append
        { token: '{{cufe}}', path: 'invoice.fiscal.cufe', description: 'CUFE', example: 'cufe-de-ejemplo' },
      ],
    });

    expect(out.definition.tokens).toHaveLength(3);
    const byPath = new Map(out.definition.tokens!.map((t) => [t.path, t]));
    expect(byPath.get('invoice.issuer.nit')?.description).toBe('NIT del emisor (sobrescrito)');
    expect(byPath.get('invoice.issuer.nit')?.example).toBe('900123456-7');
    expect(byPath.get('invoice.totals.total')?.description).toBe('Total');
    expect(byPath.get('invoice.fiscal.cufe')?.description).toBe('CUFE');

    // Cero duplicados por path.
    const paths = out.definition.tokens!.map((t) => t.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('override de `logo` REEMPLAZA entero; el logo de la base NO se preserva parcialmente', async () => {
    const base = baseDefinition();
    const service = await build(buildPrisma(base));

    const out = await service.preview(10, 'fiscal_electronic_invoice', {
      logo: { url: 'logos/custom.png', position: 'center', size_mm: 30 },
    });

    // El logo del override ganó en su totalidad — no hay mezcla entre el url
    // nuevo y el `size_mm` viejo, porque el contrato es REPLACE.
    expect(out.definition.logo).toEqual({
      url: 'logos/custom.png',
      position: 'center',
      size_mm: 30,
    });
    expect(out.definition.logo?.url).not.toBe(base.logo!.url);
  });
});
