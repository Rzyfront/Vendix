import type {
  PrintColumnDefinition,
  PrintFormatDefinition,
  PrintSectionDefinition,
} from '../../../../../../core/models/print-formats.model';
import { PrintAnnexValidatorService } from './print-annex-validator.service';

/**
 * C.10 CP-pos-exclusive-tax-double-charge — el validador de anexo vuelve a
 * fallar cuando debe: sin los escapes `|| columns.length > 0`, una plantilla
 * con columnas pero sin las columnas de línea exigidas reprueba las reglas
 * de línea, y una con sólo `totals` activa reprueba el desglose de IVA.
 * Cada mensaje nombra el token esperado y su ubicación, no un código a secas.
 */
describe('PrintAnnexValidatorService (C.10)', () => {
  const service = new PrintAnnexValidatorService();

  const col = (id: string, key: string): PrintColumnDefinition => ({
    id,
    key,
    label: id,
    enabled: true,
    width_percent: 25,
    align: 'left',
  });

  const sec = (id: string, type: string): PrintSectionDefinition => ({
    id,
    type,
    title: id,
    enabled: true,
    order: 0,
  });

  const base: PrintFormatDefinition = {
    paper: { format: 'a4', width_mm: 210, is_roll: false, copies: 1 },
    sections: [],
    columns: [],
  };

  it('reprueba las reglas de línea cuando hay columnas pero no las exigidas', () => {
    const summary = service.validate(
      { ...base, columns: [col('other', 'other_col')] },
      'pos_sale_ticket',
    );
    for (const id of ['line_description', 'line_quantity', 'line_unit_price', 'line_total']) {
      const rule = summary.rules.find((r) => r.id === id);
      expect(rule?.passed).toBe(false);
      expect(rule?.description).toContain('tabla de líneas');
    }
    expect(summary.isCompliant).toBe(false);
  });

  it('reprueba el desglose de IVA cuando sólo está activa la sección de totales', () => {
    const summary = service.validate(
      {
        ...base,
        columns: [col('col_desc', 'col_desc'), col('col_qty', 'col_qty'), col('col_price', 'col_price'), col('col_total', 'col_total')],
        sections: [sec('sec_totals', 'totals')],
      },
      'pos_sale_ticket',
    );
    const rule = summary.rules.find((r) => r.id === 'totals_taxes_breakdown');
    expect(rule?.passed).toBe(false);
    expect(rule?.description).toContain('sec_taxes');
  });

  it('acepta una plantilla correcta con columnas de línea y desglose de IVA', () => {
    const summary = service.validate(
      {
        ...base,
        columns: [col('col_desc', 'col_desc'), col('col_qty', 'col_qty'), col('col_price', 'col_price'), col('col_total', 'col_total')],
        sections: [
          sec('sec_header', 'header'),
          sec('sec_doc_info', 'doc_info'),
          sec('sec_taxes', 'taxes_breakdown'),
          sec('sec_totals', 'totals'),
        ],
      },
      'pos_sale_ticket',
    );
    for (const id of ['line_description', 'line_quantity', 'line_unit_price', 'line_total', 'totals_taxes_breakdown']) {
      expect(summary.rules.find((r) => r.id === id)?.passed).toBe(true);
    }
  });
});
