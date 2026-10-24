/**
 * Proveedor del reporte de cierre de caja (`cash_session_close`).
 *
 *  1. IDOR: una sesión de OTRA tienda → PRINT_DOCUMENT_NOT_FOUND_001 y
 *     `getCloseReport` ni se invoca.
 *  2. Id inválido / sesión inexistente → 404.
 *  3. Camino feliz: las cifras son las de `getCloseReport` (sin recalcular) y
 *     las fechas salen en la zona de la tienda.
 *  4. Composer: la sección `cash_session_report` pinta los bloques y respeta
 *     el ancho (tablas `csr-table`, monto `csr-amt`).
 */
import { CashSessionCloseDataProvider } from '../cash-session-close.provider';
import { PrintLayoutComposerService } from '../../services/print-layout-composer.service';
import { PrintTemplateCompilerService } from '../../services/print-template-compiler.service';

describe('CashSessionCloseDataProvider', () => {
  const build = (opts: { owned?: boolean; report?: any; notFound?: boolean } = {}) => {
    const sample = new CashSessionCloseDataProvider({} as any, {} as any);
    const getCloseReport = jest.fn();
    const prisma: any = {
      cash_register_sessions: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.owned === false ? null : { id: 55 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      stores: {
        findFirst: jest.fn().mockResolvedValue({
          name: 'Tienda Demo',
          legal_name: 'Demo SAS',
          logo_url: null,
          phone: '300',
          addresses: [{ address_line1: 'Calle 1', city: 'Cali' }],
          organizations: { tax_id: '900' },
        }),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {},
          stores: { timezone: 'America/Bogota' },
        }),
      },
    };
    const sessions = { getCloseReport };
    getCloseReport.mockImplementation(async () => {
      if (opts.notFound) {
        throw Object.assign(new Error('nf'), { status: 404 });
      }
      return opts.report;
    });
    const moduleRef: any = { get: jest.fn().mockReturnValue(sessions) };
    return {
      provider: new CashSessionCloseDataProvider(prisma, moduleRef),
      prisma,
      getCloseReport,
      sample,
    };
  };

  it('sesión de otra tienda → PRINT_DOCUMENT_NOT_FOUND_001 sin llamar a getCloseReport (IDOR)', async () => {
    const { provider, prisma, getCloseReport } = build({ owned: false });
    await expect(provider.fetchDocumentData(7, 55)).rejects.toMatchObject({
      errorCode: 'PRINT_DOCUMENT_NOT_FOUND_001',
    });
    expect(prisma.cash_register_sessions.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 55, store_id: 7 } }),
    );
    expect(getCloseReport).not.toHaveBeenCalled();
  });

  it('id inválido → PRINT_DOCUMENT_NOT_FOUND_001', async () => {
    const { provider } = build();
    await expect(provider.fetchDocumentData(7, 'abc')).rejects.toMatchObject({
      errorCode: 'PRINT_DOCUMENT_NOT_FOUND_001',
    });
  });

  it('getCloseReport 404 → PRINT_DOCUMENT_NOT_FOUND_001', async () => {
    const { provider } = build({ notFound: true });
    await expect(provider.fetchDocumentData(7, 55)).rejects.toMatchObject({
      errorCode: 'PRINT_DOCUMENT_NOT_FOUND_001',
    });
  });

  it('camino feliz: cifras de getCloseReport sin recalcular, fechas en zona de la tienda', async () => {
    const base = await build().sample.getSampleData();
    const report = {
      ...(base.custom_variables as any).cash_report,
    };
    // Quitar los campos añadidos por el mapeo para reconstruir un reporte crudo.
    report.session = {
      ...report.session,
      id: 55,
      opened_at: '2026-10-14T13:00:00.000Z',
      closed_at: '2026-10-14T23:30:00.000Z',
    };
    report.cash = { ...report.cash, expected: 123456, declared: 120000, difference: -3456 };
    const { provider, getCloseReport } = build({ report });
    const model = await provider.fetchDocumentData(7, 55);

    expect(getCloseReport).toHaveBeenCalledWith(55);
    const cr = (model.custom_variables as any).cash_report;
    expect(cr.cash.expected).toBe(123456);
    expect(cr.cash.difference).toBe(-3456);
    // 13:00Z = 08:00 en Bogotá (UTC-5)
    expect(cr.session.opened_at_formatted).toContain('14/10/2026');
    expect(cr.session.opened_at_formatted).toMatch(/08:00/);
    expect(model.store.name).toBe('Tienda Demo');
    expect(model.store.tax_id).toBe('900');
    expect(model.document.number).toBe('Sesión #55');
  });

  it('composer: la sección cash_session_report pinta el reporte dentro de tablas con monto nowrap', async () => {
    const { sample } = build();
    const data = await sample.getSampleData();
    const composer = new PrintLayoutComposerService(
      new PrintTemplateCompilerService(),
    );
    const html = composer.compose(
      {
        paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
        styles: { font_family: 'Arial', font_size_base_pt: 8.5, primary_color: '#000' },
        sections: [
          { id: 'sec_header', type: 'header', title: 'h', enabled: true, order: 1 },
          { id: 'sec_cash_report', type: 'cash_session_report', title: 'c', enabled: true, order: 2 },
          { id: 'sec_footer', type: 'footer', title: 'f', enabled: true, order: 3 },
        ],
        columns: [],
      } as any,
      data,
    );
    expect(html).toContain('CIERRE DE CAJA');
    expect(html).toContain('Lo que debe haber');
    expect(html).toContain('Cómo se llega al efectivo');
    expect(html).toContain('Salidas de la sesión');
    expect(html).toContain('Firma cajero');
    expect(html).toContain('csr-table');
    expect(html).toContain('csr-amt');
    expect(html).toContain('Faltante');
    expect(html).toContain('-$5.000');
  });

  it('composer: respaldo legacy sin consolidado ni desglose', async () => {
    const { sample } = build();
    const data: any = await sample.getSampleData();
    delete data.custom_variables.cash_report.consolidated;
    delete data.custom_variables.cash_report.cash_breakdown;
    const composer = new PrintLayoutComposerService(
      new PrintTemplateCompilerService(),
    );
    const html = composer.compose(
      {
        paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
        styles: { font_family: 'Arial', font_size_base_pt: 8.5, primary_color: '#000' },
        sections: [
          { id: 'sec_cash_report', type: 'cash_session_report', title: 'c', enabled: true, order: 1 },
        ],
        columns: [],
      } as any,
      data,
    );
    expect(html).toContain('Métodos de pago');
    expect(html).toContain('Efectivo');
    expect(html).toContain('Ventas cobradas');
    expect(html).not.toContain('Lo que debe haber');
  });

  describe('composer: entradas y detalle de salidas', () => {
    const render = async (patch: (cr: any) => void) => {
      const { provider, sample } = build();
      const data: any = await sample.getSampleData();
      patch(data.custom_variables.cash_report);
      void provider;
      const composer = new PrintLayoutComposerService(
        new PrintTemplateCompilerService(),
      );
      return composer.compose(
        {
          paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
          styles: { font_family: 'Arial', font_size_base_pt: 8.5, primary_color: '#000' },
          sections: [
            { id: 'sec_cash_report', type: 'cash_session_report', title: 'c', enabled: true, order: 1 },
          ],
          columns: [],
        } as any,
        data,
      );
    };

    it('pinta Entradas de la sesión con referencia y notas, y salida sin repetidos', async () => {
      const html = await render((cr) => {
        cr.inflows = [
          { id: 1, at: cr.session.closed_at, at_formatted: '14/10/2026 08:00', amount: 2000, reference: 'Cambio', notes: 'Billetes', user_name: null, payment_method: 'cash' },
        ];
        cr.outflows = [
          { ...cr.outflows[0], reason: 'X', reference: 'Taxi', notes: 'X', user_name: null },
        ];
      });
      expect(html).toContain('Entradas de la sesión');
      expect(html).toContain('Cambio · Billetes');
      expect(html).toContain('X · Taxi');
      expect(html).not.toContain('X · Taxi · X');
      expect(html).not.toContain('X · X');
    });

    it('Sin entradas cuando inflows está vacío', async () => {
      const html = await render((cr) => {
        cr.inflows = [];
      });
      expect(html).toContain('Entradas de la sesión');
      expect(html).toContain('Sin entradas');
    });

    it('escapa el HTML del detalle', async () => {
      const html = await render((cr) => {
        cr.inflows = [
          { id: 1, at: cr.session.closed_at, amount: 1, reference: '<b>x</b>', notes: null, user_name: null, payment_method: 'cash' },
        ];
      });
      expect(html).not.toContain('<b>x</b>');
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    });
  });

  it('fetchDocumentData calcula at_formatted también para inflows', async () => {
    const base = await build().sample.getSampleData();
    const report = { ...(base.custom_variables as any).cash_report };
    report.inflows = [
      { id: 1, at: '2026-10-14T13:00:00.000Z', amount: 5, reference: null, notes: null, user_name: null, payment_method: 'cash' },
    ];
    const { provider } = build({ report });
    const model = await provider.fetchDocumentData(7, 55);
    expect((model.custom_variables as any).cash_report.inflows[0].at_formatted).toMatch(/08:00/);
  });
});
