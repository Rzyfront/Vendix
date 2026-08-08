import {
  resolveInvoiceControl,
  InvoiceControlSource,
} from './invoice-control.helper';

// Zona del emisor colombiano: UTC-5. Es la que hace visible el desplazamiento de
// fecha civil, que es el motivo de que el resolvedor use `localDateString`.
const TZ = 'America/Bogota';

/** Resolución completa y vigente, con los valores reales de la plataforma. */
function makeResolution(
  overrides: Partial<InvoiceControlSource> = {},
): InvoiceControlSource {
  return {
    resolution_number: '18760000001',
    prefix: 'SETP',
    range_from: 990000000,
    range_to: 995000000,
    valid_from: new Date('2019-01-19T05:00:00.000Z'),
    valid_to: new Date('2030-01-19T05:00:00.000Z'),
    is_active: true,
    ...overrides,
  };
}

const NOW = new Date('2026-08-08T19:00:00.000Z');

describe('resolveInvoiceControl', () => {
  it('mapea los seis campos de sts:InvoiceControl desde la resolución', () => {
    const control = resolveInvoiceControl(makeResolution(), TZ, NOW);

    expect(control).toEqual({
      invoice_authorization: '18760000001',
      authorization_start_date: '2019-01-19',
      authorization_end_date: '2030-01-19',
      prefix: 'SETP',
      range_from: '990000000',
      range_to: '995000000',
    });
  });

  it('entrega el rango como cadena, no como número', () => {
    const control = resolveInvoiceControl(makeResolution(), TZ, NOW);

    // sts:From y sts:To son texto en el XML. Un número se serializaría igual hoy
    // y distinto el día que alguien formatee con separador de miles.
    expect(typeof control.range_from).toBe('string');
    expect(typeof control.range_to).toBe('string');
  });

  it('no desplaza un día las fechas civiles del período de autorización', () => {
    // El instante almacenado es medianoche local de Bogotá, o sea 05:00 UTC.
    // `toISOString().slice(0,10)` daría la fecha correcta aquí, pero para un
    // instante guardado antes del desplazamiento —23:00 UTC del día anterior—
    // daría el día equivocado. Se afirma el caso que rompe.
    const control = resolveInvoiceControl(
      makeResolution({
        valid_from: new Date('2019-01-19T03:00:00.000Z'), // 22:00 del 18 en Bogotá
        valid_to: new Date('2030-01-20T03:00:00.000Z'), // 22:00 del 19 en Bogotá
      }),
      TZ,
      NOW,
    );

    expect(control.authorization_start_date).toBe('2019-01-18');
    expect(control.authorization_end_date).toBe('2030-01-19');
  });

  it('recorta los espacios del número de autorización y del prefijo', () => {
    const control = resolveInvoiceControl(
      makeResolution({ resolution_number: '  18760000001 ', prefix: ' SETP ' }),
      TZ,
      NOW,
    );

    expect(control.invoice_authorization).toBe('18760000001');
    expect(control.prefix).toBe('SETP');
  });

  describe('lanza en vez de emitir un bloque vacío', () => {
    it('cuando no hay resolución', () => {
      expect(() => resolveInvoiceControl(null, TZ, NOW)).toThrow(
        /No hay resolución de numeración/,
      );
      expect(() => resolveInvoiceControl(undefined, TZ, NOW)).toThrow(
        /No hay resolución de numeración/,
      );
    });

    it('cuando la resolución está inactiva', () => {
      expect(() =>
        resolveInvoiceControl(makeResolution({ is_active: false }), TZ, NOW),
      ).toThrow(/inactiva/);
    });

    it('cuando falta el número de autorización', () => {
      expect(() =>
        resolveInvoiceControl(
          makeResolution({ resolution_number: null }),
          TZ,
          NOW,
        ),
      ).toThrow(/número de autorización/);
      expect(() =>
        resolveInvoiceControl(makeResolution({ resolution_number: '   ' }), TZ, NOW),
      ).toThrow(/número de autorización/);
    });

    it('cuando falta el prefijo — el caso que produce el racimo FAB10a', () => {
      expect(() =>
        resolveInvoiceControl(makeResolution({ prefix: null }), TZ, NOW),
      ).toThrow(/FAB10a/);
      expect(() =>
        resolveInvoiceControl(makeResolution({ prefix: '' }), TZ, NOW),
      ).toThrow(/prefijo/);
    });

    it('cuando el rango es inválido', () => {
      expect(() =>
        resolveInvoiceControl(makeResolution({ range_from: 0 }), TZ, NOW),
      ).toThrow(/rango autorizado/);
      expect(() =>
        resolveInvoiceControl(
          makeResolution({ range_from: 995000000, range_to: 990000000 }),
          TZ,
          NOW,
        ),
      ).toThrow(/rango autorizado/);
      expect(() =>
        resolveInvoiceControl(makeResolution({ range_to: 1.5 }), TZ, NOW),
      ).toThrow(/rango autorizado/);
    });

    it('cuando la resolución no está vigente en la fecha de emisión', () => {
      // Vencida: la DIAN rechazaría y el consecutivo ya estaría gastado.
      expect(() =>
        resolveInvoiceControl(
          makeResolution({ valid_to: new Date('2020-01-19T05:00:00.000Z') }),
          TZ,
          NOW,
        ),
      ).toThrow(/no está vigente/);

      // Todavía no vigente.
      expect(() =>
        resolveInvoiceControl(
          makeResolution({ valid_from: new Date('2027-01-19T05:00:00.000Z') }),
          TZ,
          NOW,
        ),
      ).toThrow(/no está vigente/);
    });

    it('nombra la resolución y el documento en el mensaje cuando se da contexto', () => {
      expect(() =>
        resolveInvoiceControl(makeResolution({ prefix: null }), TZ, NOW, {
          resolution_id: 10,
          document_type: 'sales_invoice',
        }),
      ).toThrow(/resolución 10, documento sales_invoice/);
    });
  });

  it('acepta los límites de la vigencia como vigentes', () => {
    const r = makeResolution();

    expect(() => resolveInvoiceControl(r, TZ, r.valid_from)).not.toThrow();
    expect(() => resolveInvoiceControl(r, TZ, r.valid_to)).not.toThrow();
  });
});
