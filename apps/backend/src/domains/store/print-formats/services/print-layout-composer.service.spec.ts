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

  it('tokenized conserva la conducta del editor: muestra las filas activas aunque sea gross', () => {
    const html = render(
      sectionNoFields,
      dataWith({ money_basis: 'gross', prints_vat_breakdown: true }),
      'tokenized',
    );
    expect(html).toContain('Subtotal:');
  });
});
