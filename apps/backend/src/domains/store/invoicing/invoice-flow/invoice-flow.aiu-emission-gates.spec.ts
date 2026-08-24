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
    );
  }

  const IVA = { tax_type: 'IVA', percent: '19.00', amount: '28500.00' };

  describe('coherencia entre lo que la línea declara y lo que lleva dentro', () => {
    function check(lines: any[], regime = 'et_462_1', source = 'snapshot') {
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

    it('el mensaje distingue si el régimen salió de la factura o del ajuste de la tienda', () => {
      // Sin esa distinción el operador no sabe si corregir la factura o la
      // configuración, y las dos acciones producen documentos distintos.
      expect(
        check(
          [
            {
              description: 'Administración',
              omit_tax_total: true,
              taxes: [IVA],
              tax_amount: '28500.00',
            },
          ],
          'decreto_1372_1992',
          'settings',
        ),
      ).toThrow(/del ajuste de la tienda por procedencia «settings»/);
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

  /**
   * De dónde sale el PORCENTAJE del piso, que es distinto de si el piso aplica.
   *
   * Las facturas 158 y 159 del entorno dev son la razón de este bloque: se
   * crearon con `aiu_regime = 'et_462_1'` y `aiu_minimum_percent` en NULL,
   * porque nacieron antes de que la columna se poblara bien. Si el NULL se
   * leyera como «sin piso», esas facturas emitirían SIN la comprobación que el
   * motor sí les aplicó al calcularlas — y el error sería invisible: un
   * documento que sale, que la DIAN acepta, y que declara menos IVA del debido.
   *
   * La ambigüedad del NULL se resuelve con la misma regla que usa el
   * calculador: bajo `et_462_1` el piso está ACTIVO salvo que alguien declare
   * `enforce_minimum_base: false` de forma explícita.
   */
  describe('procedencia del porcentaje del piso', () => {
    const OBJETO =
      'Construcción de la sede administrativa norte, etapa de acabados';

    async function resolve(
      invoice: Record<string, unknown>,
      settings: Record<string, unknown> = {},
    ) {
      const svc = service();
      svc.loadAiuSettings = jest.fn().mockResolvedValue(settings);
      const context = await svc.resolveAiuEmissionContext({
        id: 1,
        store_id: 3,
        operation_type: '09',
        aiu_contract_object: OBJETO,
        ...invoice,
      });
      return context?.minimum_percent === null
        ? null
        : context?.minimum_percent?.toFixed(2);
    }

    it('el snapshot del documento gana sobre el ajuste vivo', async () => {
      await expect(
        resolve(
          { aiu_regime: 'et_462_1', aiu_minimum_percent: new Prisma.Decimal(10) },
          { regime: 'et_462_1', minimum_base_percent: 15 },
        ),
      ).resolves.toBe('10.00');
    });

    it('apagar el piso DESPUÉS no lo desactiva en una factura que ya lo congeló', async () => {
      // El snapshot se consulta ANTES de la bandera a propósito. La factura
      // registró que el piso estaba activo y con qué porcentaje; que la tienda
      // lo apague después no puede cambiar retroactivamente la base gravable de
      // un documento cuyos importes ya se calcularon con él.
      await expect(
        resolve(
          { aiu_regime: 'et_462_1', aiu_minimum_percent: new Prisma.Decimal(10) },
          { regime: 'et_462_1', enforce_minimum_base: false },
        ),
      ).resolves.toBe('10.00');
    });

    it('sin snapshot toma el porcentaje del ajuste de la tienda', async () => {
      await expect(
        resolve(
          { aiu_regime: 'et_462_1', aiu_minimum_percent: null },
          { regime: 'et_462_1', minimum_base_percent: 15 },
        ),
      ).resolves.toBe('15.00');
    });

    it('sin snapshot y sin ajuste el piso está ACTIVO al 10% (las facturas 158 y 159)', async () => {
      // El caso que hace que el NULL no sea ambiguo. Leerlo como «sin piso»
      // dejaría emitir sin comprobar exactamente a las facturas cuyos importes
      // el motor SÍ calculó con el piso puesto.
      await expect(
        resolve({ aiu_regime: 'et_462_1', aiu_minimum_percent: null }, {}),
      ).resolves.toBe('10.00');
    });

    it('sólo un `enforce_minimum_base: false` explícito apaga el piso', async () => {
      await expect(
        resolve(
          { aiu_regime: 'et_462_1', aiu_minimum_percent: null },
          { regime: 'et_462_1', enforce_minimum_base: false },
        ),
      ).resolves.toBeNull();
    });

    it('bajo `decreto_1372_1992` no hay piso, ni siquiera con snapshot', async () => {
      // El Decreto 1372/1992 no fija ningún mínimo sobre la utilidad del
      // constructor: el régimen se evalúa PRIMERO, antes de mirar el snapshot.
      await expect(
        resolve(
          {
            aiu_regime: 'decreto_1372_1992',
            aiu_minimum_percent: new Prisma.Decimal(10),
          },
          { regime: 'et_462_1' },
        ),
      ).resolves.toBeNull();
    });
  });
});
