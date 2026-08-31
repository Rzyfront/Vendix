import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';

/**
 * EL CABLEADO, no la aritmética.
 *
 * `invoice-calculator.service.spec.ts` ya cubre el cálculo en sí. Lo que se
 * verifica acá es lo que se PERSISTE y en qué ORDEN, que es donde vivían los
 * defectos:
 *
 *   1. `invoices.subtotal_amount` guardaba `Σ quantity × unit_price`. En una
 *      línea con el impuesto incluido en el precio eso es el bruto CON el IVA
 *      dentro: la factura declaraba una base inflada.
 *   2. El impuesto de línea era el que mandara el cliente, y el formulario del
 *      panel manda `tax_amount: 0` esperando que el backend recalcule.
 *   3. El cálculo corría DESPUÉS de tomar el consecutivo, así que una factura
 *      que no cuadraba dejaba un hueco permanente en la numeración autorizada.
 *
 * Los tres son silenciosos: ninguno lanzaba nada al guardar.
 */
describe('InvoicingService · cableado del motor aritmético', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  /**
   * Catálogo `tax_rates` de la tienda del contexto, en el formato REAL de la
   * tabla: `rate` es una FRACCIÓN (`Decimal(6,5)`, cuyo máximo es 9,99999, así
   * que no podría siquiera contener un 19), y el tipo fiscal cuelga de la
   * categoría. La conversión ‰/porcentaje y la clasificación se comprueban
   * contra estas filas, no contra un formato inventado para el test.
   */
  const TAX_RATE_CATALOG = [
    {
      id: 1,
      store_id: 2,
      rate: '0.19',
      name: 'IVA General',
      is_inclusive: false,
      tax_categories: {
        organization_id: 1,
        store_id: 2,
        tax_type: 'iva',
        is_inclusive: false,
      },
    },
    {
      id: 2,
      store_id: 2,
      // Un impuesto que el comerciante creó y NO llamó «INC». Es el caso que
      // rompe cualquier clasificación por nombre.
      rate: '0.08',
      name: 'Tributo propio del comerciante',
      is_inclusive: false,
      tax_categories: {
        organization_id: 1,
        store_id: 2,
        tax_type: 'inc',
        is_inclusive: false,
      },
    },
  ];

  const createService = () => {
    const created: any[] = [];
    const tax_rates_find = jest
      .fn()
      .mockImplementation(({ where }: any) =>
        Promise.resolve(
          TAX_RATE_CATALOG.filter((row) => where.id.in.includes(row.id)),
        ),
      );
    const prisma = {
      invoices: {
        create: jest.fn().mockImplementation(({ data }) => {
          created.push(data);
          return { id: 300, invoice_number: data.invoice_number };
        }),
      },
      fiscal_close_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      // Sin producto en las líneas no se consulta el catálogo; se declara para
      // que un fallo de esa ruta sea visible en vez de un `undefined` mudo.
      products: { findMany: jest.fn().mockResolvedValue([]) },
      withoutScope: () => ({
        dian_configurations: { findFirst: jest.fn().mockResolvedValue(null) },
        // `resolveTenantTaxRateCatalog` sale por `withoutScope()` a propósito:
        // necesita VER la fila ajena para poder rechazarla con un mensaje que
        // la nombre, en vez de recibir un «no existe» del scoping.
        tax_rates: { findMany: tax_rates_find },
      }),
    };
    const generator = {
      generateNextNumber: jest.fn().mockResolvedValue({
        invoice_number: 'FV1',
        resolution_id: 88,
      }),
    };

    const service = new InvoicingService(
      prisma as any,
      generator as any,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {
        resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 77 }),
        requireFiscalScope: jest.fn().mockResolvedValue('STORE'),
        getFiscalScope: jest.fn().mockResolvedValue('STORE'),
      } as any,
      { getRetryStatusByInvoiceIds: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      // Compuerta de emisión extraída a `InvoiceEmissionGateService` en el
      // commit `9cb5aff05`: `InvoicingService` ya no lleva el predicado, lo
      // delega. Se pasa permisiva porque ninguno de estos casos prueba la
      // compuerta en sí — la prueban `invoice-emission-gate.service.spec.ts`
      // y sus propios casos. Omitirla no da un fallo de aserción, da un
      // `TS2554` que tumba la suite entera y no aparece en el conteo de
      // `Tests:`, que es como pasó desapercibida.
      {
        assertAreaActive: jest.fn().mockResolvedValue(undefined),
        assertElectronicEmissionLive: jest.fn().mockResolvedValue(undefined),
      } as any,
      {
        evaluate: jest.fn().mockResolvedValue({
          enforced: false,
          uvt_value: null,
          limit_cop: null,
          exceeds: false,
          year: 2026,
        }),
        assertInvoiceNotRequired: jest.fn(),
      } as any,
      new InvoiceCalculatorService(),
      // TRM: doble mudo. Estos casos facturan en pesos, así que la conversión
      // nunca se consulta; el doble sólo impide que un cambio futuro los ponga
      // a depender de datos.gov.co sin que nadie lo note.
      { resolveExchangeRate: jest.fn().mockResolvedValue(null) } as any,
      // Retenciones: tienda sin conceptos configurados ⇒ ninguna resuelta, y
      // `invoices.withholding_amount` conserva lo que declare el DTO.
      {
        resolveSuffered: jest.fn().mockResolvedValue({
          lines: [],
          uvt_value_used: 0,
          counterparty_type: null,
        }),
        resolveSelf: jest.fn().mockResolvedValue({
          lines: [],
          uvt_value_used: 0,
          counterparty_type: null,
        }),
      } as any,
    );

    return { service, prisma, generator, created };
  };

  const withContext = async <T>(run: () => Promise<T>): Promise<T> =>
    RequestContextService.run(requestContext as any, run);

  const baseDto = (
    items: CreateInvoiceDto['items'],
    extra: Partial<CreateInvoiceDto> = {},
  ): CreateInvoiceDto =>
    ({
      invoice_type: 'sales_invoice',
      customer_name: 'Cliente',
      customer_tax_id: '900123456',
      issue_date: '2026-03-12',
      currency: 'COP',
      items,
      ...extra,
    }) as CreateInvoiceDto;

  it('persiste la BASE GRAVABLE, no el bruto, cuando el precio lleva el IVA dentro', async () => {
    const { service, created } = createService();

    // $119.000 con IVA incluido al 19% ⇒ base 100.000, cuota 19.000.
    await withContext(() =>
      service.create(
        baseDto([
          {
            description: 'Servicio',
            quantity: 1,
            unit_price: 119000,
            is_inclusive: true,
            tax_amount: 0,
            taxes: [
              {
                tax_name: 'IVA',
                tax_rate: 19,
                taxable_amount: 0,
                tax_amount: 0,
                is_inclusive: true,
              },
            ],
          },
        ] as any),
      ),
    );

    const data = created[0];
    // Se compara el IMPORTE, no su serialización: `Prisma.Decimal` descarta los
    // ceros finales al imprimirse (`new Prisma.Decimal('100000.00').toString()`
    // es `'100000'`), así que fijar la cadena con dos decimales probaba el
    // formateo de la librería y no lo que se persiste.
    expect(Number(data.subtotal_amount)).toBe(100000);
    expect(Number(data.tax_amount)).toBe(19000);
    // `PayableAmount` = base + impuesto. Antes daba 119.000 + 19.000 porque el
    // bruto ya llevaba el impuesto dentro y se le volvía a sumar.
    expect(Number(data.total_amount)).toBe(119000);
  });

  it('recalcula el impuesto que el cliente mandó en cero', async () => {
    const { service, created } = createService();

    await withContext(() =>
      service.create(
        baseDto([
          {
            description: 'Producto',
            quantity: 2,
            unit_price: 50000,
            tax_amount: 0,
            taxes: [
              {
                tax_name: 'IVA',
                tax_rate: 19,
                taxable_amount: 0,
                tax_amount: 0,
              },
            ],
          },
        ] as any),
      ),
    );

    const data = created[0];
    expect(Number(data.subtotal_amount)).toBe(100000);
    expect(Number(data.tax_amount)).toBe(19000);
    // La línea también, no sólo la cabecera: el desglose por línea es lo que
    // alimenta los `cac:TaxSubtotal` del XML.
    expect(Number(data.invoice_items.create[0].tax_amount)).toBe(19000);
    // Y la fila de cabecera lleva su tipo fiscal: es la clave con la que el
    // CUFE arma ValImp1/2/3.
    expect(data.invoice_taxes.create[0].tax_type).toBe('iva');
  });

  /**
   * EL CATÁLOGO ES LA VERDAD DE LA TARIFA.
   *
   * Recalcular la cuota desde `tax_rate` cierra la mitad del hueco: si el
   * cuerpo miente sobre la TARIFA, la cuota recalculada es fiel a una mentira.
   * Medido con `curl` contra la tienda 3 antes de este cableado: un cuerpo con
   * `tax_rate_id: 1` (IVA General, 19 % en el catálogo) y `tax_rate: 0`
   * persistía la factura DEV11 con IVA cero y nada falló.
   */
  describe('El catálogo `tax_rates` manda sobre la tarifa declarada', () => {
    it('usa la tarifa del catálogo cuando el cuerpo declara otra', async () => {
      const { service, created } = createService();

      await withContext(() =>
        service.create(
          baseDto([
            {
              description: 'Producto',
              quantity: 1,
              unit_price: 100000,
              taxes: [
                {
                  tax_rate_id: 1,
                  tax_name: 'IVA General',
                  // La mentira: 0 % sobre una tarifa que el catálogo fija en 19.
                  tax_rate: 0,
                  tax_type: 'iva',
                  tax_amount: 0,
                },
              ],
            },
          ] as any),
        ),
      );

      const data = created[0];
      expect(Number(data.tax_amount)).toBe(19000);
      expect(Number(data.total_amount)).toBe(119000);
      // La fila persistida declara la tarifa del catálogo, no la del cuerpo: es
      // la que el XML emite como `cbc:Percent` y contra la que la DIAN aplica
      // `TaxAmount = TaxableAmount × Percent / 100`.
      expect(Number(data.invoice_taxes.create[0].tax_rate)).toBe(19);
    });

    it('clasifica por el `tax_type` del catálogo, no por el nombre ni por lo declarado', async () => {
      const { service, created } = createService();

      await withContext(() =>
        service.create(
          baseDto([
            {
              description: 'Producto',
              quantity: 1,
              unit_price: 100000,
              taxes: [
                {
                  tax_rate_id: 2,
                  tax_name: 'Tributo propio del comerciante',
                  tax_rate: 8,
                  // El cuerpo lo declara IVA; el catálogo dice que es INC. Sin
                  // la autoridad del catálogo este importe entraría a `ValImp1`
                  // en el hash del CUFE y a `ValImp2` en el XML: dos casillas
                  // distintas para el mismo peso, y rechazo por clave inválida.
                  tax_type: 'iva',
                  tax_amount: 0,
                },
              ],
            },
          ] as any),
        ),
      );

      const row = created[0].invoice_taxes.create[0];
      expect(row.tax_type).toBe('inc');
      expect(Number(row.tax_amount)).toBe(8000);
    });

    it('deja pasar el impuesto puntual que no referencia el catálogo', async () => {
      const { service, created } = createService();

      await withContext(() =>
        service.create(
          baseDto([
            {
              description: 'Producto',
              quantity: 1,
              unit_price: 100000,
              // Sin `tax_rate_id`: no hay nada que consultar y manda el cuerpo.
              // Es el camino del `curl`, la importación y las herramientas de
              // IA; exigir el catálogo obligaría a dar de alta cada tributo de
              // una sola vez.
              taxes: [
                { tax_name: 'INC Bolsas', tax_rate: 8, tax_type: 'inc' },
              ],
            },
          ] as any),
        ),
      );

      const row = created[0].invoice_taxes.create[0];
      expect(Number(row.tax_rate)).toBe(8);
      expect(Number(row.tax_amount)).toBe(8000);
    });

    it('rechaza una tarifa inexistente SIN gastar consecutivo', async () => {
      const { service, generator } = createService();

      await expect(
        withContext(() =>
          service.create(
            baseDto([
              {
                description: 'Producto',
                quantity: 1,
                unit_price: 100000,
                taxes: [
                  {
                    tax_rate_id: 999999,
                    tax_name: 'X',
                    tax_rate: 19,
                    tax_type: 'iva',
                  },
                ],
              },
            ] as any),
          ),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_002' });

      expect(generator.generateNextNumber).not.toHaveBeenCalled();
    });
  });

  it('rechaza un importe de impuesto sin tarifa SIN gastar consecutivo', async () => {
    const { service, generator } = createService();

    await expect(
      withContext(() =>
        service.create(
          baseDto([
            {
              description: 'Línea rota',
              quantity: 1,
              unit_price: 100000,
              // Importe sin ningún `taxes[]` del que derivarlo.
              tax_amount: 19000,
            },
          ] as any),
        ),
      ),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });

    // LO IMPORTANTE: el número autorizado no se tocó. Un consecutivo gastado no
    // se recupera ni se reutiliza.
    expect(generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('vence el mismo día cuando no es a crédito, y exige plazo cuando lo es', async () => {
    const { service, created } = createService();

    await withContext(() =>
      service.create(
        baseDto(
          [
            {
              description: 'Contado',
              quantity: 1,
              unit_price: 1000,
              tax_amount: 0,
            },
          ] as any,
          { payment_form: '1' },
        ),
      ),
    );
    expect(created[0].due_date).toEqual(created[0].issue_date);

    await expect(
      withContext(() =>
        service.create(
          baseDto(
            [
              {
                description: 'Crédito sin plazo',
                quantity: 1,
                unit_price: 1000,
                tax_amount: 0,
              },
            ] as any,
            { payment_form: '2' },
          ),
        ),
      ),
    ).rejects.toThrow(/crédito/i);
  });
});
