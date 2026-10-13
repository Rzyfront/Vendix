import { Prisma } from '@prisma/client';

import { InvoiceFlowService } from './invoice-flow.service';
import { ErrorCodes } from '../../../../common/errors/error-codes';

/**
 * Las dos últimas compuertas antes de firmar una factura AIU.
 *
 * Existen porque el documento se arma con DOS mitades que salen de fuentes
 * distintas y cada una es internamente coherente: la gravabilidad por línea la
 * decide el RÉGIMEN en el momento de emitir (`attachAiuLineExtras` →
 * `omit_tax_total`), y los IMPORTES salen de los tributos PERSISTIDOS al crear
 * el documento, que pueden ser de días antes. Ni el calculador ni el builder
 * ven que se contradicen entre sí, y el resultado es un XML que declara una
 * gravabilidad distinta de la de sus propios números: rechazo por FAU04 o por
 * FAX01, con el consecutivo ya gastado.
 *
 * Se ejercitan los métodos directamente porque la emisión real exige
 * habilitación DIAN de la tienda, que en dev no existe.
 */
describe('InvoiceFlowService · compuertas de emisión AIU', () => {
  function service(): any {
    return new InvoiceFlowService(
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
      {} as any,
      {
        assertNoteBeforeNumbering: jest.fn().mockResolvedValue(undefined),
        reserveValidation: jest.fn(async (id: number) => ({ id, status: 'validated' })),
        ensureForSend: jest.fn().mockResolvedValue(undefined),
        transition: jest.fn(async (id: number, data: Record<string, unknown>) => ({ id, ...data })),
      } as any,
    );
  }

  const IVA = { tax_type: 'IVA', percent: '19.00', amount: '28500.00' };

  describe('coherencia entre lo que la línea declara y lo que lleva dentro', () => {
    function check(lines: any[], regime = 'et_462_1', source: 'snapshot' = 'snapshot') {
      return () =>
        (service() as any).assertAiuLineTaxCoherence(
          { id: 77, invoice_number: 'QA-77' },
          lines,
          { regime, regime_source: source, minimum_percent: null, note: 'x' },
        );
    }

    it('la línea que CALLA su grupo pero trae impuesto persistido no se emite', () => {
      // El descuadre FAU04: el `cac:TaxTotal` de línea desaparece del XML
      // mientras el importe sigue dentro del total de cabecera y del
      // `cbc:PayableAmount`. La DIAN contrasta uno contra la suma del otro.
      expect(
        check([
          {
            description: 'Administración',
            omit_tax_total: true,
            taxes: [IVA],
            tax_amount: '28500.00',
          },
        ]),
      ).toThrow(
        expect.objectContaining({
          errorCode: ErrorCodes.INVOICING_AIU_005.code,
        }),
      );
    });

    it('el importe solo basta: no hace falta que el arreglo de tributos venga poblado', () => {
      // `tax_amount` y `taxes` son dos representaciones del mismo hecho y no
      // siempre viajan juntas. Mirar únicamente el arreglo dejaba pasar el
      // importe suelto, que es exactamente el que descuadra la cabecera.
      expect(
        check([
          {
            description: 'Imprevistos',
            omit_tax_total: true,
            taxes: [],
            tax_amount: '28500.00',
          },
        ]),
      ).toThrow(
        expect.objectContaining({
          errorCode: ErrorCodes.INVOICING_AIU_005.code,
        }),
      );
    });

    it('la línea gravable que no declara impuesto no se emite (el caso de la factura 83)', () => {
      // `INVOICING_AIU_004` ya corta esto al capturar, pero las facturas
      // creadas ANTES de ese bloqueo siguen en la base. Emitirlas ahora produce
      // un documento que la DIAN ACEPTA declarando menos IVA del debido, y el
      // faltante sólo se corrige después con nota crédito.
      expect(
        check([
          {
            description: 'Utilidad',
            omit_tax_total: false,
            taxes: [],
            tax_amount: '0.00',
          },
        ]),
      ).toThrow(
        expect.objectContaining({
          errorCode: ErrorCodes.INVOICING_AIU_004.code,
        }),
      );
    });

    it('el importe suelto basta para dejarla pasar (el caso de la factura 63)', () => {
      // `line.taxes` sólo se puebla cuando el documento trae DOS o más
      // tributos de cabecera: `attachPersistedLineTaxes` se rinde porque
      // ninguna fila de `invoice_taxes` guarda `invoice_item_id`, y
      // `attachReconstructedLineTaxes` corta en `candidates.length < 2`. Una
      // factura AIU con un solo IVA llega aquí con el arreglo vacío y el
      // importe correcto: mirar sólo el arreglo la rechazaba por FAU04
      // inventado. La hermana `INVOICING_AIU_005`, tres líneas más arriba,
      // siempre miró las dos representaciones.
      expect(
        check(
          [
            {
              description: 'instalacion de union de reparacion z 6"',
              omit_tax_total: false,
              taxes: [],
              tax_amount: '4856.40',
            },
          ],
          'decreto_1372_1992',
        ),
      ).not.toThrow();
    });

    it('tarifa 0 declarada NO es lo mismo que impuesto omitido', () => {
      // Un servicio exento declara su grupo con `cbc:Percent` en 0,00. Si la
      // compuerta dedujera la omisión de que el importe es cero rechazaría un
      // documento correcto, y la tienda no tendría forma de facturar exentos.
      expect(
        check([
          {
            description: 'Administración (exenta)',
            omit_tax_total: false,
            taxes: [{ tax_type: 'IVA', percent: '0.00', amount: '0.00' }],
            tax_amount: '0.00',
          },
        ]),
      ).not.toThrow();
    });

    it('el documento coherente pasa: grava lo que declara y calla lo que no', () => {
      // Bajo `decreto_1372_1992` la base es SÓLO la utilidad. Administración e
      // imprevistos callan su grupo y no traen importe; la utilidad declara los
      // dos. Y la línea de costo reembolsable —sin componente AIU— también
      // calla, porque `isAiuComponentTaxable(null, …)` es false.
      expect(
        check(
          [
            {
              description: 'Administración',
              omit_tax_total: true,
              taxes: [],
              tax_amount: '0.00',
            },
            {
              description: 'Imprevistos',
              omit_tax_total: true,
              taxes: [],
              tax_amount: '0.00',
            },
            {
              description: 'Utilidad',
              omit_tax_total: false,
              taxes: [IVA],
              tax_amount: '28500.00',
            },
            {
              description: 'Costo reembolsable',
              omit_tax_total: true,
              taxes: [],
              tax_amount: '0.00',
            },
          ],
          'decreto_1372_1992',
        ),
      ).not.toThrow();
    });

  });

  describe('piso legal del artículo 462-1 re-verificado contra el documento que se firma', () => {
    function check(
      lines: any[],
      components: Array<string | null>,
      percent: number | null = 10,
    ) {
      return () =>
        (service() as any).assertAiuMinimumBase(
          {
            id: 88,
            invoice_number: 'QA-88',
            invoice_items: components.map((aiu_component) => ({ aiu_component })),
          },
          lines,
          {
            regime: 'et_462_1',
            regime_source: 'snapshot',
            minimum_percent: percent === null ? null : new Prisma.Decimal(percent),
            note: 'x',
          },
        );
    }

    const line = (amount: number, discount = 0, price_unit_quantity?: number) => ({
      description: 'l',
      quantity: 1,
      unit_price: amount,
      discount_amount: discount,
      ...(price_unit_quantity ? { price_unit_quantity } : {}),
    });

    it('sin piso activo no mide nada, aunque el AIU sea del 1%', () => {
      // `minimum_percent` en null es `decreto_1372_1992` o el piso desactivado
      // a propósito. Medirlo igual bloquearía a quien legítimamente no lo tiene.
      expect(
        check([line(15_000), line(1_485_000)], ['utilidad', null], null),
      ).not.toThrow();
    });

    it('el AIU por debajo del 10% del valor del contrato no se emite', () => {
      // 100.000 de AIU sobre 1.500.000 de contrato = 6,67%. El piso son
      // 150.000. Rechaza en vez de inflar la base: el AIU es un valor PACTADO y
      // subirlo por cuenta propia cambia la cifra que el cliente firmó.
      expect(
        check([line(100_000), line(1_400_000)], ['administracion', null]),
      ).toThrow(
        expect.objectContaining({
          errorCode: ErrorCodes.INVOICING_AIU_001.code,
        }),
      );
    });

    it('el 10% exacto pasa: el piso es un mínimo, no un umbral estricto', () => {
      expect(
        check([line(150_000), line(1_350_000)], ['administracion', null]),
      ).not.toThrow();
    });

    it('agregar costo reembolsable después de crear la factura mueve el piso sin tocar el AIU', () => {
      // La razón de existir de esta compuerta. Al crear, 150.000 sobre
      // 1.500.000 cumplía. Añadir 500.000 de costo sube el contrato a 2.000.000
      // y el piso a 200.000, sin que ninguna línea de AIU cambie: la
      // comprobación de la creación no puede anticiparlo.
      expect(
        check(
          [line(150_000), line(1_350_000), line(500_000)],
          ['administracion', null, null],
        ),
      ).toThrow(
        expect.objectContaining({
          errorCode: ErrorCodes.INVOICING_AIU_001.code,
        }),
      );
    });

    it('mide el importe NETO de descuento, que es el que va al XML', () => {
      // Se mide con `dianLineExtension`, la misma función con la que el builder
      // escribe cada `cbc:LineExtensionAmount`. Un descuento de 10.000 sobre el
      // AIU deja 140.000 contra un contrato de 1.490.000, cuyo piso es 149.000.
      // Contra los importes persistidos —sin descuento— este documento habría
      // pasado y lo firmado habría sido otro.
      expect(
        check([line(150_000, 10_000), line(1_350_000)], ['administracion', null]),
      ).toThrow(
        expect.objectContaining({
          errorCode: ErrorCodes.INVOICING_AIU_001.code,
        }),
      );
    });

    it('respeta la price unit (QUI-648): no infla el contrato por un precio por N unidades', () => {
      // Una línea de costo cuyo precio se publica por 1.000 unidades de stock.
      // Sin el divisor, el contrato se mide en 1.350.000.000 y el piso en
      // 135.000.000: rechazaría un documento perfectamente válido.
      expect(
        check(
          [line(150_000), { ...line(1_350_000_000), quantity: 1, price_unit_quantity: 1_000 }],
          ['administracion', null],
        ),
      ).not.toThrow();
    });

    it('el detalle nombra las tres cifras que el operador necesita para decidir', () => {
      // Un error que sólo dice "por debajo del mínimo" no dice cuánto subir el
      // AIU ni sobre qué contrato se midió. Se asserta contra `getResponse()`
      // porque `VendixHttpException` publica `details` DENTRO del cuerpo de la
      // respuesta: es exactamente lo que recibe el cliente, no un campo interno.
      let error: any;
      try {
        check([line(100_000), line(1_400_000)], ['administracion', null])();
      } catch (e) {
        error = e;
      }
      expect(error?.getResponse?.()).toEqual(
        expect.objectContaining({
          error_code: ErrorCodes.INVOICING_AIU_001.code,
          details: expect.objectContaining({
            aiu_value: '100000.00',
            minimum_base: '150000.00',
            contract_value: '1500000.00',
            minimum_percent: '10.00',
            regime_source: 'snapshot',
          }),
        }),
      );
    });
  });

  describe('emisión basada únicamente en el snapshot fiscal AIU', () => {
    const OBJETO =
      'Construcción de la sede administrativa norte, etapa de acabados';

    function serviceWithSettingsSpy() {
      const svc = service();
      svc.prisma.store_settings = { findFirst: jest.fn() };
      return svc;
    }

    async function resolve(invoice: Record<string, unknown>) {
      const svc = serviceWithSettingsSpy();
      const context = await svc.resolveAiuEmissionContext({
        id: 1,
        operation_type: '09',
        aiu_contract_object: OBJETO,
        ...invoice,
      });
      expect(svc.prisma.store_settings.findFirst).not.toHaveBeenCalled();
      return context?.minimum_percent === null
        ? null
        : context?.minimum_percent?.toFixed(2);
    }

    it('usa el porcentaje AIU congelado en la factura', async () => {
      await expect(
        resolve({
          aiu_regime: 'et_462_1',
          aiu_minimum_percent: new Prisma.Decimal(12),
        }),
      ).resolves.toBe('12.00');
    });

    it('respeta el NULL de mínimo cuando la matriz congelada dice que estaba desactivado', async () => {
      await expect(
        resolve({
          aiu_regime: 'et_462_1',
          aiu_minimum_percent: null,
          aiu_taxable_matrix: { minimum: { enforced: false, percent: null } },
        }),
      ).resolves.toBeNull();
    });

    it('bajo Decreto 1372 no aplica piso aunque exista un snapshot porcentual', async () => {
      await expect(
        resolve({
          aiu_regime: 'decreto_1372_1992',
          aiu_minimum_percent: new Prisma.Decimal(10),
        }),
      ).resolves.toBeNull();
    });

    it('bloquea la factura histórica AIU si no trae objeto contractual congelado', async () => {
      const svc = serviceWithSettingsSpy();
      await expect(
        svc.resolveAiuEmissionContext({
          id: 2,
          operation_type: '09',
          aiu_regime: 'et_462_1',
          aiu_contract_object: null,
        }),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.INVOICING_AIU_002.code });
      expect(svc.prisma.store_settings.findFirst).not.toHaveBeenCalled();
    });

    it('bloquea la factura histórica AIU si no trae base gravable congelada', async () => {
      const svc = serviceWithSettingsSpy();
      await expect(
        svc.resolveAiuEmissionContext({
          id: 3,
          operation_type: '09',
          aiu_regime: null,
          aiu_contract_object: OBJETO,
        }),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.INVOICING_AIU_006.code });
      expect(svc.prisma.store_settings.findFirst).not.toHaveBeenCalled();
    });

    it('bloquea mínimo NULL histórico sin evidencia de si fue desactivado', async () => {
      const svc = serviceWithSettingsSpy();
      await expect(
        svc.resolveAiuEmissionContext({
          id: 5,
          operation_type: '09',
          aiu_regime: 'et_462_1',
          aiu_contract_object: OBJETO,
          aiu_minimum_percent: null,
        }),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.INVOICING_AIU_006.code });
      expect(svc.prisma.store_settings.findFirst).not.toHaveBeenCalled();
    });

    it('noAIU no lee settings ni exige campos del snapshot AIU', async () => {
      const svc = serviceWithSettingsSpy();
      await expect(
        svc.resolveAiuEmissionContext({ id: 4, operation_type: '10' }),
      ).resolves.toBeNull();
      expect(svc.prisma.store_settings.findFirst).not.toHaveBeenCalled();
    });
  });

});
