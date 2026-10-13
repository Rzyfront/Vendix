import { PrintFormatDefinition } from '../../../../../../../core/models/print-formats.model';
import { catalogFieldsForSectionType, preparePosSaleTicketDraft } from '../section-field-catalog';

describe('POS print section field catalog', () => {
  const definition = (sections: PrintFormatDefinition['sections'], extra: Partial<PrintFormatDefinition> = {}): PrintFormatDefinition => ({
    paper: { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 },
    sections,
    styles: { font_family: 'Courier New', primary_color: '#123456' },
    columns: [{ id: 'col_desc', key: 'description', label: 'Detalle propio', enabled: true, width_percent: 100, align: 'left' }],
    ...extra,
  });

  it('exposes the disclaimer in the footer catalog', () => {
    expect(catalogFieldsForSectionType('footer')).toContain(jasmine.objectContaining({
      id: 'f_disclaimer', key: 'document.non_fiscal_disclaimer', label: 'Leyenda No Fiscal',
    }));
  });

  it('adds the enabled centered field to a cloned existing enabled footer and is idempotent', () => {
    const source = definition([{ id: 'sec_footer', type: 'footer', title: 'Pie custom', enabled: true, order: 7,
      custom_content: 'No cambiar', fields: [{ id: 'f_msg', key: 'receipts.receipt_footer', label: 'Mi mensaje', enabled: true, position: 'left' }] }]);
    const first = preparePosSaleTicketDraft(source);
    expect(first.repaired).toBe(true);
    expect(first.definition.sections[0].fields).toEqual([
      jasmine.objectContaining({ id: 'f_msg', label: 'Mi mensaje', position: 'left' }),
      jasmine.objectContaining({ id: 'f_disclaimer', key: 'document.non_fiscal_disclaimer', enabled: true, position: 'center' }),
    ]);
    expect(first.definition.sections[0].custom_content).toBe('No cambiar');
    expect(source.sections[0].fields).toHaveSize(1);
    expect(preparePosSaleTicketDraft(first.definition).repaired).toBe(false);
  });

  it('preserves explicit disabled footer/field and does not create a missing footer', () => {
    const disabledFooter = definition([{ id: 'sec_footer', type: 'footer', title: 'Pie', enabled: false, order: 7, fields: [] }]);
    const disabledField = definition([{ id: 'sec_footer', type: 'footer', title: 'Pie', enabled: true, order: 7,
      fields: [{ id: 'f_disclaimer', key: 'document.non_fiscal_disclaimer', label: 'Leyenda', enabled: false, position: 'right' }] }]);
    const noFooter = definition([{ id: 'sec_header', type: 'header', title: 'Cabecera', enabled: true, order: 1 }]);

    expect(preparePosSaleTicketDraft(disabledFooter).repaired).toBe(false);
    expect(preparePosSaleTicketDraft(disabledFooter).definition.sections[0].enabled).toBe(false);
    expect(preparePosSaleTicketDraft(disabledField).repaired).toBe(false);
    expect(preparePosSaleTicketDraft(disabledField).definition.sections[0].fields?.[0].enabled).toBe(false);
    expect(preparePosSaleTicketDraft(noFooter).repaired).toBe(false);
    expect(preparePosSaleTicketDraft(noFooter).definition.sections).toHaveSize(1);
  });

  it('does not modify non-empty custom templates and deep-clones the draft', () => {
    const source = definition([{ id: 'sec_footer', type: 'footer', title: 'Pie', enabled: true, order: 7, fields: [] }],
      { custom_template: '  <p>Mi diseño</p>  ' });
    const result = preparePosSaleTicketDraft(source);
    expect(result.repaired).toBe(false);
    expect(result.definition).not.toBe(source);
    expect(result.definition.styles).not.toBe(source.styles);
    expect(result.definition.custom_template).toBe(source.custom_template);
    expect(result.definition.sections[0].fields).toEqual([]);
  });
});
