import { PrintLayoutComposerService } from './print-layout-composer.service';

/**
 * C.3 + C.4 — regla anti-huérfana (§5.3) y etiquetas desde la definición.
 * Prueba de regresión permanente: el compositor decide las filas fiscales
 * (no la configuración pura) y ningún rótulo sale literal pudiendo leerse.
 */
describe('PrintLayoutComposerService — renderTotalsSection (C.3/C.4)', () => {
  const service = new PrintLayoutComposerService({
    escapeHtml: (v: any) => String(v ?? ''),
  } as any);

  const sectionNoFields: any = { id: 'sec_totals' };

  function dataWith(over: any = {}): any {
    return {
      totals: {
        subtotal: 100000,
        discount_total: 0,
        tax_total: 19000,
        withholding_total: 0,
        tip_amount: 0,
        shipping_total: 0,
        grand_total: 119000,
        grand_total_in_words: 'ciento diecinueve mil pesos',
        amount_received: 119000,
        change_due: 0,
      },
      document: { payment_method: 'Efectivo' },
      ...over,
    };
  }

  function render(section: any, data: any, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    return (service as any).renderTotalsSection(section, data, mode);
  }

  it('paridad: payload viejo sin base fiscal y sin fields pinta como antes con impuesto en cero', () => {
    const html = render(sectionNoFields, dataWith({ totals: { ...dataWith().totals, tax_total: 0, grand_total: 100000 } }));
    expect(html).toContain('Subtotal:');
    expect(html).toContain('TOTAL:');
    expect(html).not.toContain('vat-included-note');
  });

  it('taxable_base con desglose e impuesto > 0 muestra Subtotal e Impuestos', () => {
    const html = render(
      sectionNoFields,
      dataWith({ money_basis: 'taxable_base', prints_vat_breakdown: true }),
    );
    expect(html).toContain('Subtotal:');
    expect(html).toContain('Impuestos (IVA):');
  });

  it('taxable_base sin desglose e impuesto > 0 no deja fila huerfana', () => {
    const html = render(sectionNoFields, dataWith({ money_basis: 'taxable_base' }));
    expect(html).not.toContain('Subtotal:');
    expect(html).not.toContain('Impuestos (IVA):');
    expect(html).toContain('TOTAL:');
  });

  it('gross con desglose e impuesto > 0 esconde Subtotal e impuesto y deja nota fuera de la tabla', () => {
    const html = render(
      sectionNoFields,
      dataWith({ money_basis: 'gross', prints_vat_breakdown: true }),
    );
    expect(html).not.toContain('Subtotal:');
    expect(html).not.toContain('Impuestos (IVA):');
    expect(html).toContain('IVA incluido:');
    expect(html.indexOf('IVA incluido:')).toBeGreaterThan(html.indexOf('</table>'));
  });

  it('custom_label de la definicion llega al papel (F-147)', () => {
    const section: any = {
      id: 'sec_totals',
      fields: [{ id: 'f_sub', key: 'order.subtotal_amount', custom_label: 'Base gravable' }],
    };
    const html = render(
      section,
      dataWith({ money_basis: 'taxable_base', prints_vat_breakdown: true }),
    );
    expect(html).toContain('Base gravable:');
  });

  it('label de la definicion vale cuando no hay custom_label (precedencia C.4)', () => {
    const section: any = {
      id: 'sec_totals',
      fields: [{ id: 'f_tot', key: 'order.grand_total', label: 'Total a pagar' }],
    };
    const html = render(section, dataWith({}));
    expect(html).toContain('Total a pagar:');
  });

  it('los once rotulos salen de la definicion, ninguno literal (C.4)', () => {
    const ids = ['f_sub', 'f_disc', 'f_ship', 'f_tax', 'f_reten', 'f_tip', 'f_tot', 'f_words', 'f_paym', 'f_recv', 'f_chg'];
    const section: any = {
      id: 'sec_totals',
      fields: ids.map((id, i) => ({ id, key: `k.${id}`, custom_label: `L${i}` })),
    };
    const html = render(
      section,
      dataWith({
        money_basis: 'taxable_base',
        prints_vat_breakdown: true,
        totals: {
          ...dataWith().totals,
          discount_total: 1,
          withholding_total: 1,
          tip_amount: 1,
          shipping_total: 1,
          amount_received: 1,
          change_due: 1,
          grand_total_in_words: 'x',
        },
        document: { payment_method: 'Efectivo', amount_received: 1, change_due: 1 },
      }),
    );
    for (let i = 0; i < ids.length; i++) {
      expect(html).toContain(`L${i}`);
    }
    for (const literal of ['Subtotal:', 'Descuento:', 'TOTAL:', 'Recibido:', 'Cambio:']) {
      expect(html).not.toContain(`>${literal}<`);
    }
  });

  it('taxable_base con desglose e impuesto = 0 muestra Subtotal sin fila de impuesto (combinacion §2.3 #2)', () => {
    const html = render(
      sectionNoFields,
      dataWith({
        money_basis: 'taxable_base',
        prints_vat_breakdown: true,
        totals: { ...dataWith().totals, tax_total: 0, grand_total: 100000 },
      }),
    );
    expect(html).toContain('Subtotal:');
    expect(html).not.toContain('Impuestos (IVA):');
    expect(html).not.toContain('IVA incluido:');
  });

  it('gross con desglose e impuesto = 0 no deja Subtotal ni nota (combinacion §2.3 #5)', () => {
    const html = render(
      sectionNoFields,
      dataWith({
        money_basis: 'gross',
        prints_vat_breakdown: true,
        totals: { ...dataWith().totals, tax_total: 0, grand_total: 100000 },
      }),
    );
    expect(html).not.toContain('Subtotal:');
    expect(html).not.toContain('Impuestos (IVA):');
    expect(html).not.toContain('IVA incluido:');
    expect(html).toContain('TOTAL:');
  });

  it('gross sin gate fiscal esconde Subtotal e Impuestos y NO agrega la nota (combinacion §2.3 #6)', () => {
    const html = render(
      sectionNoFields,
      dataWith({ money_basis: 'gross', prints_vat_breakdown: false }),
    );
    expect(html).not.toContain('Subtotal:');
    expect(html).not.toContain('Impuestos (IVA):');
    expect(html).not.toContain('IVA incluido:');
    expect(html).toContain('TOTAL:');
  });

  it('tokenized conserva la conducta del editor: muestra las filas activas aunque sea gross', () => {
    const html = render(
      sectionNoFields,
      dataWith({ money_basis: 'gross', prints_vat_breakdown: true }),
      'tokenized',
    );
    expect(html).toContain('Subtotal:');
  });
});

/**
 * F-102 — el editor (`tokenized`) no puede afirmar un tributo que no calculó
 * nadie. Antes del fix, sin tributos reales (`taxes: []` — el caso de
 * remisión/ticket de cocina/certificados de retención, que NUNCA los
 * declaran) el modo tokenized inyectaba `{ name: 'IVA', rate: 19,
 * base_amount: 100000, tax_amount: 19000 }` como si fuera dato real, en un
 * documento cuyo render real (`mode !== 'tokenized'`) descarta la sección
 * completa un renglón más abajo. El comerciante diseñaba el formato viendo
 * una tarifa que el papel jamás reproduce.
 */
describe('PrintLayoutComposerService — renderTaxBreakdownSection (F-102)', () => {
  const service = new PrintLayoutComposerService({
    escapeHtml: (v: any) => String(v ?? ''),
  } as any);

  function render(data: any, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    return (service as any).renderTaxBreakdownSection(data, mode);
  }

  it('render real sin tributos descarta la sección completa (remisión, ticket de cocina, etc.)', () => {
    const html = render({ taxes: [] });
    expect(html).toBe('');
  });

  it('render real CON tributos sí la pinta, con los valores reales', () => {
    const html = render({
      taxes: [
        {
          name: 'IVA',
          rate: 19,
          base_amount: 549000,
          tax_amount: 104310,
          base_formatted: '$549.000',
          tax_formatted: '$104.310',
        },
      ],
    });
    expect(html).toContain('DISCRIMINACIÓN DE IMPUESTOS');
    expect(html).toContain('IVA (19%)');
    expect(html).toContain('$104.310');
  });

  it('REGRESIÓN F-102: tokenized sin tributos ya NO fabrica un IVA del 19% que el papel nunca imprime', () => {
    const html = render({ taxes: [] }, 'tokenized');
    expect(html).not.toContain('19%');
    expect(html).not.toContain('100000');
    expect(html).not.toContain('19000');
  });

  it('tokenized sin tributos pinta una fila plantilla ligada a tokens, no un dato inventado', () => {
    const html = render({ taxes: [] }, 'tokenized');
    expect(html).toContain('DISCRIMINACIÓN DE IMPUESTOS');
    expect(html).toContain('data-token="tax.name"');
    expect(html).toContain('data-token="tax.rate"');
    expect(html).toContain('data-token="tax.base_amount"');
    expect(html).toContain('data-token="tax.tax_amount"');
  });

  it('tokenized con tributos reales (sample) también usa la fila plantilla, igual que la tabla de items', () => {
    // Paridad con `renderItemsTableSection`: en tokenized SIEMPRE es una
    // fila-plantilla con pills, sin importar cuántas filas reales existan.
    const html = render(
      { taxes: [{ name: 'IVA', rate: 19, base_amount: 549000, tax_amount: 104310 }] },
      'tokenized',
    );
    expect(html).toContain('data-token="tax.rate"');
    expect(html).not.toContain('104310');
  });
});
