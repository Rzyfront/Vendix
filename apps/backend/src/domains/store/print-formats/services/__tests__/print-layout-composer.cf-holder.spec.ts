import { PrintLayoutComposerService } from '../print-layout-composer.service';
import { PrintTemplateCompilerService } from '../print-template-compiler.service';
import { StandardPrintDataModel } from '../../interfaces/standard-print-data.model';
import { PrintFormatDefinition } from '../../interfaces/print-format.interface';
describe('holder QR additive representation', () => {
  const composer = new PrintLayoutComposerService(
    new PrintTemplateCompilerService(),
  );
  const holder = {
    url: 'https://example.test/factura/cfh1.fixture',
    expires_at: '2026-11-14T00:00:00.000Z',
    qr_png_base64: 'aG9sZGVy',
  };
  const data: StandardPrintDataModel = {
    store: { name: 'Tienda' },
    document: {
      id: 1,
      number: 'FE1',
      date: '2026-10-14',
      date_formatted: '14/10/2026',
      state: 'accepted',
      state_label: 'Aceptada',
    },
    items: [],
    taxes: [],
    totals: {
      subtotal: 0,
      subtotal_formatted: '$0',
      discount_total: 0,
      discount_total_formatted: '$0',
      shipping_total: 0,
      shipping_total_formatted: '$0',
      tax_total: 0,
      tax_total_formatted: '$0',
      grand_total: 0,
      grand_total_formatted: '$0',
    },
    fiscal: { qr_code_content: 'DIAN-PAYLOAD', cufe: 'original-cufe' },
    holder_change: holder,
  };
  function definition(type: string, custom?: string, enabled?: boolean): PrintFormatDefinition & { format_type: string } {
    return {
      paper: { format: 'thermal_58', width_mm: 58, is_roll: true, margin_mm: 5, copies: 1 },
      sections: [],
      format_type: type,
      show_holder_change_qr: enabled,
      custom_template: custom,
    };
  }
  it.each(['fiscal_electronic_invoice', 'pos_electronic_invoice'])(
    'renders one separate QR for %s',
    (type) => {
      const html = composer.compose(definition(type, undefined, true), data);
      expect(html.match(/data-vx-holder-change=/g) || []).toHaveLength(1);
      expect(html).toContain('¿Necesitas la factura a tu nombre?');
      expect(html).toContain('max-width:100%');
      expect(data.fiscal?.qr_code_content).toBe('DIAN-PAYLOAD');
    },
  );
  it('preserves custom DIAN markup and adds holder QR', () => {
    const html = composer.compose(
      definition(
        'fiscal_electronic_invoice',
        '<div id="dian">DIAN-PAYLOAD</div><footer>Pie</footer>',
      ),
      data,
    );
    expect(html).toContain('<div id="dian">DIAN-PAYLOAD</div>');
    expect(html).toContain('data-vx-holder-change');
  });
  it('does not add to nonfiscal or ineligible rendering', () => {
    expect(composer.compose(definition('pos_sale_ticket'), data)).not.toContain(
      'data-vx-holder-change',
    );
    expect(
      composer.compose(definition('pos_electronic_invoice'), {
        ...data,
        holder_change: undefined,
      }),
    ).not.toContain('data-vx-holder-change');
  });
  it('does not duplicate a marked custom block', () => {
    const html = composer.compose(
      definition(
        'pos_electronic_invoice',
        '<section data-vx-holder-change="cf-holder-v1">Exists</section>',
        true,
      ),
      data,
    );
    expect(html.match(/data-vx-holder-change=/g) || []).toHaveLength(1);
  });
  it.each([undefined, false])('POS absent/false opt-in (%s) suppresses automatic QR in custom without touching DIAN/manual markup', enabled => {
    const html = composer.compose(definition('pos_electronic_invoice', '<div id="dian">DIAN-PAYLOAD</div><section data-vx-holder-change="cf-holder-v1"><img src="stale-auto" /></section><div id="manual-qr">Manual content</div>', enabled), data);
    expect(html).not.toContain('data-vx-holder-change');
    expect(html).not.toContain('stale-auto');
    expect(html).toContain('<div id="dian">DIAN-PAYLOAD</div>');
    expect(html).toContain('<div id="manual-qr">Manual content</div>');
  });
  it('uses explicit gateway type even when the definition carries no format_type', () => {
    const def = definition('pos_electronic_invoice');
    delete (def as Partial<typeof def>).format_type;
    expect(composer.compose(def, data, 'dummy', undefined, 'pos_electronic_invoice')).not.toContain('data-vx-holder-change');
  });
  it('enabling POS still requires eligible holder data', () => {
    expect(composer.compose(definition('pos_electronic_invoice', undefined, true), {...data,holder_change:undefined})).not.toContain('data-vx-holder-change');
  });

});
