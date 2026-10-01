import { SaveRequirement } from '../../../../../shared/components/save-requirements-modal/save-requirements.interface';
import {
  EmitReadinessVerdict,
  InvoiceEmitReadinessFinding,
} from '../services/invoice-emit-readiness.service';
import {
  sortRequirements,
  toEmitRequirements,
} from './invoice-emit-requirements';

function finding(
  partial: Partial<InvoiceEmitReadinessFinding> & { field: string },
): InvoiceEmitReadinessFinding {
  return {
    code: 'X_001',
    severity: 'blocker',
    problem: 'Falta algo.',
    fix: 'Corrígelo.',
    ...partial,
  };
}

function verdict(
  blockers: InvoiceEmitReadinessFinding[],
): EmitReadinessVerdict {
  return {
    emittable: false,
    findings: blockers,
    blockers,
    warnings: [],
    has_items: true,
    identity: {
      emittable: false,
      mode: 'nominative',
      findings: blockers,
      blockers,
      warnings: [],
      normalized: null,
    },
    fiscal_document: null,
  };
}

describe('toEmitRequirements', () => {
  it('proyección fallida: blocker de raíz con línea -> 1 fila focus a items.2', () => {
    const f = finding({
      code: 'INVOICING_CALC_005',
      field: 'items[2].unit_price',
      problem: 'p',
      fix: 'f',
      target: 'form',
    });
    const rows = toEmitRequirements({
      emittable: false,
      blockers: [f],
      warnings: [],
      findings: [f],
      has_items: true,
      identity: {
        emittable: true,
        mode: 'final_consumer',
        findings: [],
        blockers: [],
        warnings: [],
        normalized: null,
      },
      fiscal_document: null,
    });
    expect(rows.length).toBe(1);
    expect(rows[0].severity).toBe('blocker');
    expect(rows[0].action?.kind).toBe('focus');
    expect(rows[0].action?.target).toBe('items.2.unit_price');
  });

  it('proyección fallida: blocker de raíz con campo mapeado de línea -> focus a items.2', () => {
    const f = finding({ code: 'INVOICING_CALC_005', field: 'items[2].quantity' });
    const rows = toEmitRequirements({ ...verdict([]), blockers: [f], findings: [f] });
    expect(rows.length).toBe(1);
    expect(rows[0].action?.kind).toBe('focus');
    expect(rows[0].action?.target).toBe('items.2.quantity');
  });

  it('blocker de raíz config + cta -> 1 fila navigate', () => {
    const rows = toEmitRequirements({
      ...verdict([]),
      blockers: [
        finding({
          code: 'DIAN_CERT_003',
          field: 'dian_config.certificate_expiry',
          target: 'config',
          cta: '/admin/invoicing/dian-config',
        }),
      ],
    });
    expect(rows.length).toBe(1);
    expect(rows[0].action).toEqual({
      label: 'Configurar DIAN',
      kind: 'navigate',
      target: '/admin/invoicing/dian-config',
    });
  });

  it('mismo hallazgo en identity y en la raíz -> 1 sola fila', () => {
    const f = finding({ code: 'ID_001', field: 'document_number' });
    const rows = toEmitRequirements(verdict([f]));
    expect(rows.length).toBe(1);
  });

  it('warning de raíz -> severity required', () => {
    const rows = toEmitRequirements({
      ...verdict([]),
      warnings: [finding({ code: 'W_1', field: 'email', severity: 'warning' as never })],
    });
    expect(rows.length).toBe(1);
    expect(rows[0].severity).toBe('required');
  });

  it('config + cta -> navigate con la ruta del backend y etiqueta por ruta', () => {
    const rows = toEmitRequirements(
      verdict([
        finding({
          field: 'resolution.prefix',
          target: 'config',
          cta: '/admin/invoicing/resolutions',
        }),
      ]),
    );
    expect(rows[0].action).toEqual({
      label: 'Ir a Resoluciones',
      kind: 'navigate',
      target: '/admin/invoicing/resolutions',
    });
  });

  it('config con ruta desconocida -> "Ir a configuración"', () => {
    const rows = toEmitRequirements(
      verdict([finding({ field: 'otro', target: 'config', cta: '/admin/x' })]),
    );
    expect(rows[0].action?.label).toBe('Ir a configuración');
    expect(rows[0].action?.kind).toBe('navigate');
  });

  it('form -> focus al control mapeado', () => {
    const rows = toEmitRequirements(
      verdict([finding({ field: 'document_number', target: 'form' })]),
    );
    expect(rows[0].action).toEqual({
      label: 'Ir al número de documento',
      kind: 'focus',
      target: 'customer_tax_id',
    });
  });

  it('sin target -> comportamiento actual (focus)', () => {
    const rows = toEmitRequirements(
      verdict([finding({ field: 'items[2].quantity' })]),
    );
    expect(rows[0].action?.kind).toBe('focus');
    expect(rows[0].action?.target).toBe('items.2.quantity');
  });

  it('issuer.* navega al wizard fiscal', () => {
    const rows = toEmitRequirements(verdict([finding({ field: 'issuer.nit' })]));
    expect(rows[0].action).toEqual({
      label: 'Completar datos fiscales',
      kind: 'navigate',
      target: '/admin/fiscal/wizard',
    });
  });
});

describe('sortRequirements', () => {
  const req = (
    id: string,
    kind?: 'focus' | 'navigate',
    target?: string,
  ): SaveRequirement => ({
    id,
    label: id,
    reason: '',
    severity: 'blocker',
    action: kind ? { label: id, kind, target } : undefined,
  });

  it('focus por sección, luego navigate, luego sin acción', () => {
    const sorted = sortRequirements([
      req('nav', 'navigate', '/admin/fiscal/wizard'),
      req('none'),
      req('divisa', 'focus', 'exchange_rate'),
      req('linea', 'focus', 'items.0.quantity'),
      req('cliente', 'focus', 'customer_tax_id'),
      req('doc', 'focus', 'issue_date'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual([
      'doc',
      'cliente',
      'linea',
      'divisa',
      'nav',
      'none',
    ]);
  });

  it('no muta la entrada', () => {
    const input = [req('b', 'navigate', '/x'), req('a', 'focus', 'issue_date')];
    sortRequirements(input);
    expect(input[0].id).toBe('b');
  });
});
