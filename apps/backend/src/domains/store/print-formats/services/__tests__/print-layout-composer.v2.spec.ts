/**
 * [print-editor-dsk P1.3] — Unit tests for the v2 fields the composer must
 * consume after the PrintFormatDefinition interface migration:
 *
 *   1. paper.margin_mm (legacy, v1) — still honored when per-side absent
 *   2. paper.margin_top_mm / right / bottom / left (v2) — drive per-side
 *      body padding; @page margin uses the max
 *   3. paper.format === 'custom' — emits `${width_mm}mm ${height_mm}mm`
 *   4. definition.logo.url — fallback when data.store.logo_url is empty
 *   5. definition.company_block.fields — rendered ONLY for fiscal formats
 *      (inferred by the presence of `fiscal_*` sections)
 *   6. definition.company_block — NOT rendered for non-fiscal formats
 *
 * Skills: vendix-backend (NestJS testing), vendix-fiscal-scope (fiscal
 * inference via section types).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrintLayoutComposerService } from '../print-layout-composer.service';
import { PrintTemplateCompilerService } from '../print-template-compiler.service';
import { PrintFormatDefinition } from '../../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../../interfaces/standard-print-data.model';

describe('PrintLayoutComposerService — v2 fields (P1.3)', () => {
  let composer: PrintLayoutComposerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintLayoutComposerService, PrintTemplateCompilerService],
    }).compile();

    composer = module.get<PrintLayoutComposerService>(PrintLayoutComposerService);
  });

  const baseData: StandardPrintDataModel = {
    store: {
      name: 'Mi Tienda',
      legal_name: 'Mi Tienda S.A.S.',
      tax_id: '900123456',
      tax_regime: 'Común',
      address: 'Calle 1 # 2-3',
      city: 'Bogotá',
      phone: '+57 1 555 5555',
      email: 'info@mitienda.co',
    },
    document: {
      id: 1,
      number: '1234',
      date: '2026-08-27',
      date_formatted: '2026-08-27',
      time: '10:30',
      state: 'paid',
      state_label: 'Pagado',
    },
    items: [],
    taxes: [],
    totals: {
      subtotal: 100000,
      subtotal_formatted: '$100.000',
      discount_total: 0,
      discount_total_formatted: '$0',
      shipping_total: 0,
      shipping_total_formatted: '$0',
      tax_total: 0,
      tax_total_formatted: '$0',
      grand_total: 100000,
      grand_total_formatted: '$100.000',
    },
  };

  const v1Paper = {
    format: 'letter' as const,
    width_mm: 216,
    height_mm: 280,
    is_roll: false,
    margin_mm: 10,
    copies: 1,
  };

  it('1. v1 paper (only margin_mm) — output respects v1 margin', () => {
    const def: PrintFormatDefinition = {
      v: 1,
      paper: v1Paper,
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, baseData);
    // @page margin: max(top/right/bottom/left) = 10mm (todos heredan de margin_mm)
    expect(html).toMatch(/@page\s*\{[\s\S]*margin:\s*10mm/);
    // Body padding per-side: todos 10mm
    expect(html).toMatch(/padding:\s*10mm\s*10mm\s*10mm\s*10mm/);
  });

  it('2. v2 paper (per-side margins) — body padding uses all 4 sides', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: {
        ...v1Paper,
        margin_top_mm: 5,
        margin_right_mm: 12,
        margin_bottom_mm: 8,
        margin_left_mm: 20,
      },
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, baseData);
    // @page margin: max(5, 12, 8, 20) = 20mm
    expect(html).toMatch(/@page\s*\{[\s\S]*margin:\s*20mm/);
    // Body padding per-side respeta los 4 lados en orden CSS (T R B L)
    expect(html).toMatch(/padding:\s*5mm\s*12mm\s*8mm\s*20mm/);
  });

  it('3. custom paper format with width_mm/height_mm — @page size: 100mm 200mm', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: {
        format: 'custom',
        width_mm: 100,
        height_mm: 200,
        is_roll: false,
        margin_mm: 5,
        copies: 1,
      },
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const html = composer.compose(def, baseData);
    expect(html).toMatch(/@page\s*\{[\s\S]*size:\s*100mm\s*200mm/);
  });

  it('4. definition.logo.url set + empty data.store.logo_url — logo rendered from definition', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: v1Paper,
      logo: {
        url: 'https://example.com/logo.png',
        position: 'center',
        size_mm: 18,
        opacity: 80,
      },
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
      ],
    };
    const dataWithoutLogo: StandardPrintDataModel = {
      ...baseData,
      store: { ...baseData.store, logo_url: undefined } as any,
    };
    const html = composer.compose(def, dataWithoutLogo);
    // El logo de la definición se renderiza
    expect(html).toContain('https://example.com/logo.png');
    expect(html).toMatch(/class="store-logo"[^>]*text-align:\s*center/);
    // Y opacity se aplica como estilo inline (0.8 = 80/100)
    expect(html).toMatch(/opacity:\s*0\.8/);
  });

  it('5. definition.company_block.fields set for fiscal format — company block rendered', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: v1Paper,
      company_block: {
        fields: [
          { key: 'NIT', enabled: true },
          { key: 'address', enabled: true, custom_label: 'Dirección' },
          { key: 'phone', enabled: true },
          { key: 'email', enabled: false }, // disabled — must NOT appear
        ],
      },
      sections: [
        // Fiscal inference: presence of fiscal_* section types marks this
        // definition as fiscal (the composer has no formatType parameter).
        { id: 'h', type: 'fiscal_header', title: '', enabled: true, order: 1 },
        { id: 'q', type: 'fiscal_qr_section', title: '', enabled: true, order: 2 },
      ],
    };
    const html = composer.compose(def, baseData);
    // The company-block container is present
    expect(html).toContain('class="company-block"');
    // NIT default label + value
    expect(html).toContain('<span class="label">NIT:</span>');
    expect(html).toContain('<span class="value">900123456</span>');
    // Custom label overrides default
    expect(html).toContain('<span class="label">Dirección:</span>');
    expect(html).toContain('<span class="value">Calle 1 # 2-3</span>');
    // Phone field is enabled and should render
    expect(html).toContain('<span class="label">phone:</span>');
    // Disabled email field should NOT render
    expect(html).not.toContain('<span class="label">email:</span>');
  });

  it('6. definition.company_block set for non-fiscal format — NOT rendered', () => {
    const def: PrintFormatDefinition = {
      v: 2,
      paper: v1Paper,
      company_block: {
        fields: [
          { key: 'NIT', enabled: true },
          { key: 'address', enabled: true },
        ],
      },
      // Non-fiscal: sólo header (sin prefijo fiscal_*)
      sections: [
        { id: 'h', type: 'header', title: '', enabled: true, order: 1 },
        { id: 'i', type: 'items_table', title: '', enabled: true, order: 2 },
        { id: 't', type: 'totals_summary', title: '', enabled: true, order: 3 },
      ],
    };
    const html = composer.compose(def, baseData);
    // El bloque no se renderiza en formato no fiscal
    expect(html).not.toContain('class="company-block"');
    expect(html).toContain('class="store-name"');
    expect(html).toContain('Mi Tienda');
  });
});