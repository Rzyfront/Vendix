import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';

/**
 * QUÉ FORMA TOMA `invoice_taxes` AL PERSISTIR.
 *
 * El emisor UBL escribe un `cac:TaxSubtotal` por cada tributo DE LA LÍNEA. Sin
 * `invoice_taxes.invoice_item_id` no tenía de dónde sacarlo y le heredaba a toda
 * línea el PRIMER tributo del documento: una cuenta mixta IVA + INC salía entera
 * como IVA 19 % o entera como INC 8 %.
 *
 * La decisión de modelado que este spec fija —y que no se puede romper sin
 * romper la DIAN— es que un documento usa UNA sola forma, nunca las dos:
 *
 *   · UN tributo  ⇒ fila agregada de cabecera, `invoice_item_id` NULL. El emisor
 *     ya produce el mismo XML heredándola.
 *   · ≥2 tributos ⇒ una fila por (línea × tributo) y NINGUNA agregada. Todo
 *     consumidor de esta tabla SUMA sin filtrar (`cac:TaxTotal` de cabecera,
 *     prevalidador, exógena, declaraciones), así que agregado + desglose juntos
 *     duplicarían el impuesto del documento y lo harían rechazar por FAS01b.
 */
describe('InvoicingService · desglose de tributos por línea', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = (item_ids: number[] = [11, 12]) => {
    const created: any[] = [];
    const created_taxes: any[][] = [];
    const prisma = {
      invoices: {
        create: jest.fn().mockImplementation(({ data }) => {
          created.push(data);
          return { id: 300, invoice_number: data.invoice_number };
        }),
        // Recarga posterior a la segunda escritura: el documento devuelto tiene
        // que incluir las filas de impuesto recién creadas.
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 300, invoice_number: 'FV1' }),
      },
      invoice_items: {
        findMany: jest
          .fn()
          .mockResolvedValue(item_ids.map((id) => ({ id }))),
      },
      invoice_taxes: {
        createMany: jest.fn().mockImplementation(({ data }) => {
          created_taxes.push(data);
          return { count: data.length };
        }),
      },
      fiscal_close_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      products: { findMany: jest.fn().mockResolvedValue([]) },
      withoutScope: () => ({
        dian_configurations: { findFirst: jest.fn().mockResolvedValue(null) },
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
      { resolveExchangeRate: jest.fn().mockResolvedValue(null) } as any,
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

    return { service, prisma, created, created_taxes };
  };

  const withContext = async <T>(run: () => Promise<T>): Promise<T> =>
    RequestContextService.run(requestContext as any, run);

  const baseDto = (items: any[]): CreateInvoiceDto =>
    ({
      invoice_type: 'sales_invoice',
      customer_name: 'Cliente',
      customer_tax_id: '900123456',
      issue_date: '2026-03-12',
      currency: 'COP',
      items,
    }) as CreateInvoiceDto;

  /** Plato de restaurante con UN tributo declarado. */
  const dish = (unit_price: number, tax_name: string, tax_rate: number, tax_type: string) => ({
    description: `Plato ${tax_name}`,
    quantity: 1,
    unit_price,
    tax_amount: 0,
    taxes: [
      {
        tax_name,
        tax_rate,
        tax_type,
        taxable_amount: 0,
        tax_amount: 0,
      },
    ],
  });

  it('conserva la fila agregada de cabecera cuando el documento lleva UN solo tributo', async () => {
    const { service, created, prisma } = createService();

    await withContext(() =>
      service.create(baseDto([dish(100000, 'IVA', 19, 'iva')])),
    );

    const data = created[0];
    expect(data.invoice_taxes.create).toHaveLength(1);
    expect(data.invoice_taxes.create[0].tax_type).toBe('iva');
    // Ni una fila por línea: partirla no cambiaría un byte del XML y sí
    // multiplicaría las filas que leen el PDF, el panel y los reportes.
    expect(prisma.invoice_taxes.createMany).not.toHaveBeenCalled();
  });

  it('escribe una fila POR LÍNEA en una cuenta mixta IVA + INC', async () => {
    const { service, created, created_taxes } = createService([11, 12]);

    await withContext(() =>
      service.create(
        baseDto([
          dish(100000, 'IVA', 19, 'iva'),
          dish(50000, 'INC', 8, 'inc'),
        ]),
      ),
    );

    // La cabecera NO se escribe en el create anidado: iría duplicada.
    expect(created[0].invoice_taxes).toBeUndefined();

    const rows = created_taxes[0];
    expect(rows).toHaveLength(2);
    expect(rows[0].invoice_item_id).toBe(11);
    expect(rows[0].tax_type).toBe('iva');
    expect(rows[0].tax_amount.toString()).toBe('19000');
    expect(rows[1].invoice_item_id).toBe(12);
    expect(rows[1].tax_type).toBe('inc');
    expect(rows[1].tax_amount.toString()).toBe('4000');

    // Y la Σ sigue siendo el impuesto del documento: es lo que la DIAN
    // contrasta contra el `cac:TaxTotal` de cabecera (FAS01b).
    const total = rows.reduce(
      (acc: number, row: any) => acc + Number(row.tax_amount),
      0,
    );
    expect(total).toBe(Number(created[0].tax_amount));
  });

  it('cae a la cabecera agregada si las líneas no se pueden alinear', async () => {
    // Un solo id devuelto para dos líneas: el alineamiento por posición sería
    // mentira. Antes que inventar un vínculo, se escribe el agregado — el
    // documento queda fiscalmente correcto aunque pierda el desglose.
    const { service, created_taxes } = createService([11]);

    await withContext(() =>
      service.create(
        baseDto([
          dish(100000, 'IVA', 19, 'iva'),
          dish(50000, 'INC', 8, 'inc'),
        ]),
      ),
    );

    const rows = created_taxes[0];
    expect(rows).toHaveLength(2);
    expect(rows.every((row: any) => row.invoice_item_id === undefined)).toBe(
      true,
    );
  });
  /**
   * EL PREDICADO, aislado. No es «cuántos tributos tiene el documento» sino
   * «¿alguna línea declara una base distinta de su importe?».
   *
   * El número de tributos es sólo la primera de las dos razones. La segunda la
   * trajo el Modelo 1 del AIU (`'no_sumada'`), donde la línea ES el contrato
   * entero y su base es una fracción: ahí el camino histórico del emisor —que
   * escribe `cbc:TaxableAmount = cbc:LineExtensionAmount`— declara varias veces
   * la base real, y la única estructura donde esa base cabe es la fila por línea.
   */
  describe('cuándo hay que partir los tributos por línea', () => {
    const predicate = (header_taxes: any[], lines: any[]): boolean =>
      (Object.create(InvoicingService.prototype) as any).needsPersistedLineTaxes(
        header_taxes,
        lines,
      );

    /** Línea normal: lo que grava es exactamente lo que vale. */
    const plain = (amount: string) => ({
      omit_tax_total: false,
      line_extension_amount: amount,
      taxable_amount: amount,
    });

    it('dos o más tributos: sigue siendo razón suficiente', () => {
      expect(predicate([{}, {}], [plain('100000.00')])).toBe(true);
    });

    it('un tributo y líneas normales: fila agregada de cabecera, como siempre', () => {
      expect(predicate([{}], [plain('100000.00'), plain('50000.00')])).toBe(
        false,
      );
    });

    it('un tributo pero la base de la línea NO es su importe: hay que partir', () => {
      // El contrato AIU del Modelo 1: $2.328.800 de importe, $69.864 de base.
      expect(
        predicate(
          [{}],
          [
            {
              omit_tax_total: false,
              line_extension_amount: '2328800.00',
              taxable_amount: '69864.00',
            },
          ],
        ),
      ).toBe(true);
    });

    it('la línea que calla su grupo no cuenta: no declara ninguna base', () => {
      // Administración e imprevistos bajo `'utilidad'` traen `'0.00'` de base y
      // `omit_tax_total`. Contarlas metería a TODO documento AIU del Modelo 2 en
      // el desglose por línea sin que nada lo necesite.
      expect(
        predicate(
          [{}],
          [
            {
              omit_tax_total: true,
              line_extension_amount: '6000000.00',
              taxable_amount: '0.00',
            },
            plain('3000000.00'),
          ],
        ),
      ).toBe(false);
    });
  });
});
