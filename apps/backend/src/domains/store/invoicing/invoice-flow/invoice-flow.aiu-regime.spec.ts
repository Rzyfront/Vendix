import { InvoiceFlowService } from './invoice-flow.service';
import { ErrorCodes } from '../../../../common/errors/error-codes';

/**
 * El régimen de base gravable AIU decide, línea por línea, cuál emite
 * `cac:TaxTotal` y cuál no. Los IMPORTES, en cambio, salen de los tributos ya
 * persistidos. Si las dos mitades no vienen del mismo régimen, el XML declara
 * una gravabilidad que no corresponde a los números que lleva dentro: rechazo
 * por FAU04 o por FAX01, con el consecutivo ya gastado.
 *
 * Por eso el régimen se congela en `invoices.aiu_regime`, y por eso este spec
 * cubre las cuatro procedencias posibles. Se ejercita el resolutor directamente
 * porque la emisión real exige habilitación DIAN de la tienda, que en dev no
 * existe.
 */
describe('InvoiceFlowService · procedencia del régimen AIU en emisión', () => {
  function resolve(
    invoice: { id: number; aiu_regime?: string | null },
    settings: Record<string, unknown> = {},
  ) {
    const service = new InvoiceFlowService(
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return (service as any).resolveAiuRegimeForEmission(invoice, settings);
  }

  it('el snapshot del documento gana sobre el ajuste vivo de la tienda', () => {
    // El escenario que motivó la columna: la tienda cambió de régimen DESPUÉS
    // de que se calcularon los importes de esta factura.
    expect(
      resolve(
        { id: 1, aiu_regime: 'decreto_1372_1992' },
        { regime: 'et_462_1' },
      ),
    ).toEqual({ regime: 'decreto_1372_1992', regime_source: 'snapshot' });
  });

  it('sin snapshot cae al ajuste de la tienda y lo declara como tal', () => {
    // Las facturas anteriores a la columna. El fallback es correcto para ellas
    // y `regime_source` es lo que permite distinguirlas después.
    expect(resolve({ id: 2, aiu_regime: null }, { regime: 'decreto_1372_1992' }))
      .toEqual({ regime: 'decreto_1372_1992', regime_source: 'settings' });
  });

  it('sin snapshot ni configuración usa el mismo default que la creación', () => {
    // `et_462_1` grava el AIU completo, o sea declara MÁS IVA. Que las dos
    // puntas caigan al mismo valor es lo que mantiene coherente a la tienda que
    // nunca configuró AIU: de más es recuperable, de menos es sanción.
    expect(resolve({ id: 3 }, {})).toEqual({
      regime: 'et_462_1',
      regime_source: 'default',
    });
  });

  it('un régimen desconocido NO cae al default: rechaza', () => {
    // El único caso irresoluble. Adivinar entre dos bases incompatibles cambia
    // el IVA declarado sin dejar rastro de que se adivinó.
    expect(() => resolve({ id: 4, aiu_regime: 'et_462' })).toThrow(
      expect.objectContaining({
        errorCode: ErrorCodes.INVOICING_AIU_006.code,
      }),
    );
  });

  it('la cadena vacía y los espacios cuentan como ausencia, no como valor raro', () => {
    // Sin el `trim` una columna con `'   '` habría disparado el rechazo del
    // caso anterior en vez de caer al fallback, que es el comportamiento
    // correcto para un dato que en la práctica no está.
    expect(resolve({ id: 5, aiu_regime: '   ' }, { regime: 'et_462_1' })).toEqual(
      { regime: 'et_462_1', regime_source: 'settings' },
    );
  });
});
