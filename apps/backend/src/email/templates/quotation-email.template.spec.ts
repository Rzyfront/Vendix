import { buildDefaultAiuProfileConfig } from '../../domains/store/invoicing/profiles/invoice-profile-config.contract';
import { buildQuotationContractEconomicSnapshot } from '../../domains/store/quotations/quotation-contract-economics';
import { buildQuotationContractPresentation } from '../../domains/store/quotations/quotation-contract-presentation';
import { generateQuotationEmailHtml } from './quotation-email.template';

describe('generateQuotationEmailHtml', () => {
  it('renders frozen contract costs, taxes, totals and terms with HTML escaping', () => {
    const config = buildDefaultAiuProfileConfig('Obra <script>alert(1)</script> & adecuación');
    config.aiu!.accounting_model = 'no_sumada';
    const economic = buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-10T12:00:00.000Z',
      invoice_profile: { profile_id: 5, version: 2, name: 'Perfil <AIU> & Obras', config },
      quotation_profile: null,
      contract_object: 'Obra <script>alert(1)</script> & adecuación',
      due_date: '2026-12-31',
      cost_lines: [{ description: 'Costo <directo>', quantity: '1', unit_price: '100.00', discount_amount: '10.00' }],
    });
    const presentation = buildQuotationContractPresentation(economic, {
      notes: 'Nota <frozen> & válida',
      terms_and_conditions: `Términos <largos> & ${'completos '.repeat(80)}`,
      quotation_items: [{
        product_name: 'Costo <directo>',
        quantity: 1,
        unit_price: '100.00',
        discount_amount: '10.00',
        total_price: '90.00',
      }],
    });
    const html = generateQuotationEmailHtml({
      quotation_number: 'QT<&-1',
      customer_name: 'Cliente <Uno> & Cía',
      valid_until: '31/12/2026',
      items: [],
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      store_name: 'Tienda <Test> & Co',
      contract_presentation: presentation!,
    });

    expect(html).toContain('Obra &lt;script&gt;alert(1)&lt;/script&gt; &amp; adecuación');
    expect(html).toContain('Perfil &lt;AIU&gt; &amp; Obras');
    expect(html).toContain('DIAN 01');
    expect(html).toContain('19%');
    expect(html).toContain('Subtotal bruto');
    expect(html).toContain('Descuento');
    expect(html).toContain('Total congelado');
    expect(html).toContain('Detalle de costos de origen');
    expect(html).toContain('no se suma de nuevo');
    expect(html).toContain('Términos &lt;largos&gt; &amp;');
    expect(html).toContain('Cliente &lt;Uno&gt; &amp; Cía');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('keeps sale email formatting unchanged and shows explicit legacy warning', () => {
    const sale = generateQuotationEmailHtml({
      quotation_number: 'QT-1',
      customer_name: 'Cliente',
      valid_until: null,
      items: [{ product_name: 'Servicio', quantity: 1, unit_price: 1000, total_price: 1000 }],
      subtotal: 1000,
      discount: 0,
      tax: 0,
      total: 1000,
      store_name: 'Vendix',
    });
    expect(sale).toContain('$1,000');
    expect(sale).not.toContain('Total congelado');

    const legacy = generateQuotationEmailHtml({
      quotation_number: 'CT-LEGACY',
      customer_name: 'Cliente',
      valid_until: null,
      items: [{ product_name: 'Costo histórico', quantity: 1, unit_price: 100, total_price: 100 }],
      subtotal: 100,
      discount: 0,
      tax: 0,
      total: 100,
      store_name: 'Vendix',
      presentation_warning: 'Sin economía congelada & no reinterpretada.',
    });
    expect(legacy).toContain('Sin economía congelada &amp; no reinterpretada.');
    expect(legacy).toContain('Costo histórico');
  });
});
