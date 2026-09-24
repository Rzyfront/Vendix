import { PdfExportService } from './pdf-export.service';

describe('PdfExportService — parada sin ficha de cliente', () => {
  it('imprime nombre y dirección copiados en la remisión, no un guion', () => {
    const service = new PdfExportService();
    const text = jest.fn();
    const doc = new Proxy({ y: 0 }, {
      get(target, property) {
        if (property === 'y') return target.y;
        if (property === 'text') return (...args: unknown[]) => {
          text(...args);
          return doc;
        };
        return () => doc;
      },
    });
    const layout = (service as any).resolveLayout();

    (service as any).drawStopRow(
      doc,
      layout,
      {
        stop_sequence: 1,
        status: 'pending',
        result: null,
        is_prepaid: false,
        collected_amount: 0,
        dispatch_note: {
          dispatch_number: 'REM-900',
          customer_name: 'Portería Torre Norte',
          customer_address: { address_line1: 'Cra 7 # 1-3', city: 'Bogotá' },
          grand_total: 50000,
        },
      },
      false,
      20,
      30,
      [30, 70, 160, 80, 30, 30, 80],
      ['left', 'left', 'left', 'right', 'center', 'center', 'right'],
    );

    expect(text).toHaveBeenCalledWith('Portería Torre Norte', expect.any(Number), expect.any(Number), expect.any(Object));
    expect(text).toHaveBeenCalledWith('Cra 7 # 1-3, Bogotá', expect.any(Number), expect.any(Number), expect.any(Object));
  });
});
