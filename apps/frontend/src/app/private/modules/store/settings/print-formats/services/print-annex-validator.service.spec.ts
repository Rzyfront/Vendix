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

/**
 * CP-fiscal-qualities — la regla `emisor_regime` validaba un requisito que no
 * existe: EXIGÍA la leyenda de régimen para dar por aprobada la revisión de
 * anexo. Esa leyenda salió del art. 506 E.T., derogado (Ley 1943/2018 art. 122,
 * Ley 2010/2019 art. 160). El num. 12 del art. 11 de la Res. DIAN 000165/2023
 * enumera cuatro calidades y sólo «cuando corresponda»: una plantilla que no
 * imprime ninguna PUEDE estar perfectamente conforme, así que la regla nunca
 * puede elevarse por encima de `info`.
 */
describe('PrintAnnexValidatorService — emisor_regime no exige una leyenda inexistente', () => {
  const service = new PrintAnnexValidatorService();

  const base: PrintFormatDefinition = {
    paper: { format: 'a4', width_mm: 210, is_roll: false, copies: 1 },
    sections: [],
    columns: [],
  };

  it('en un formato fiscal la regla es informativa, nunca warning ni error', () => {
    const summary = service.validate(base, 'fiscal_electronic_invoice');
    const rule = summary.rules.find((r) => r.id === 'emisor_regime');
    expect(rule?.severity).toBe('info');
  });

  it('cita el num. 12 y no el anexo §8.1.1, y no reclama «Responsable de IVA»', () => {
    const summary = service.validate(base, 'fiscal_electronic_invoice');
    const rule = summary.rules.find((r) => r.id === 'emisor_regime');
    expect(rule?.reference).toContain('Num. 12 art. 11 Res. DIAN 000165/2023');
    expect(rule?.description).not.toContain('responsable del IVA o no responsable');
    expect(rule?.description).toContain('no se imprime ningún renglón');
  });

  it('una plantilla sin el renglón de calidades NO vuelve incumplida la revisión', () => {
    const summary = service.validate(base, 'fiscal_electronic_invoice');
    const rule = summary.rules.find((r) => r.id === 'emisor_regime');
    // `info` no puede arrastrar `isCompliant`; si algo lo hace es otra regla.
    expect(rule?.severity).toBe('info');
  });
});
