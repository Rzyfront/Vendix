import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import {
  buildContractAiuDraft,
  resolveContractAiuRatePercent,
} from './contract-invoice';
import { VendixHttpException } from 'src/common/errors';

/**
 * D.1 (DB-05, FB-08, ERR-07; ADR-03) — factura AIU precargada desde contrato.
 *
 * Dos niveles, como el resto del dominio: la precarga PURA
 * (`contract-invoice.ts`) se prueba sin base —es lo que la matriz declara,
 * asi que cada campo que entre o salga cambia el documento fiscal— y el
 * metodo `createInvoiceFromContract` se prueba con el prisma mockeado
 * (patron de `invoicing.service.spec.ts`: motor aritmetico REAL, red y base
 * dobladas).
 */
describe('D.1 · precarga contrato→factura AIU', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const snapshot = () => ({
    frozen_at: '2026-09-06T00:00:00.000Z',
    quotation: {
      id: 11,
      quotation_number: 'Q-20260906-0001',
      destination: 'contract',
      status: 'accepted',
      subtotal_amount: '1000000.00',
      discount_amount: '0.00',
      tax_amount: '38000.00',
      grand_total: '1038000.00',
      valid_until: null,
      notes: 'Construcción de bodega industrial norte',
      terms_and_conditions: null,
      accepted_at: null,
      items: [
        {
          product_id: null,
          product_variant_id: null,
          product_name: 'Mano de obra',
          variant_sku: null,
          quantity: 1,
          unit_price: '1000000.00',
          discount_amount: '0.00',
          tax_rate: '0.19',
          tax_amount_item: '38000.00',
          total_price: '1000000.00',
          notes: null,
          applied_price_tier_id: null,
          applied_price_tier_name_snapshot: null,
        },
      ],
    },
    profile: {
      profile_id: 3,
      version: 1,
      config: {
        admin_percent: 10,
        contingency_percent: 5,
        profit_percent: 5,
      },
    },
  });

  const contract = (overrides: any = {}) => ({
    id: 5,
    organization_id: 1,
    store_id: 2,
    quotation_id: 11,
    contract_number: 'CT-20260906-0001',
    customer_id: 50,
    status: 'active',
    subtotal_amount: '1000000.00',
    discount_amount: '0.00',
    tax_amount: '38000.00',
    grand_total: '1038000.00',
    snapshot: snapshot(),
    profile_id: 3,
    profile_version: 1,
    notes: 'Construcción de bodega industrial norte',
    created_by: 9,
    ...overrides,
  });

  describe('builder puro (sin base)', () => {
    it('parte el AIU en tres lineas Modelo 2 contra el subtotal', () => {
      const draft = buildContractAiuDraft(snapshot() as any, 'CT-1', 5);

      expect(draft.portions).toEqual({
        administracion: 100000,
        imprevistos: 50000,
        utilidad: 50000,
      });
      expect(draft.lines).toHaveLength(3);
      expect(draft.lines.map((line) => line.aiu_component)).toEqual([
        'administracion',
        'imprevistos',
        'utilidad',
      ]);
      expect(draft.lines[0]).toMatchObject({
        description: 'Administración AIU - CT-1',
        quantity: 1,
        unit_price: 100000,
        discount_amount: 0,
      });
    });

    it('hereda la tarifa de la cotizacion en las tres lineas', () => {
      const draft = buildContractAiuDraft(snapshot() as any, 'CT-1', 5);

      expect(draft.rate_percent).toBe(19);
      for (const line of draft.lines) {
        expect(line.taxes).toEqual([
          { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
        ]);
      }
    });

    it('omite porciones en cero en vez de facturar renglones de $0', () => {
      const snap = snapshot() as any;
      snap.profile.config = {
        admin_percent: 10,
        contingency_percent: 0,
        profit_percent: 5,
      };
      const draft = buildContractAiuDraft(snap, 'CT-1', 5);

      expect(draft.lines.map((line) => line.aiu_component)).toEqual([
        'administracion',
        'utilidad',
      ]);
    });

    it('la tarifa es la moda y el empate va a la mayor (conservadora)', () => {
      expect(
        resolveContractAiuRatePercent({
          quotation: {
            subtotal_amount: '100',
            notes: null,
            items: [
              { tax_rate: '0.19' },
              { tax_rate: 0.19 },
              { tax_rate: '0.05' },
            ],
          },
          profile: null,
        }),
      ).toBe(19);
      expect(
        resolveContractAiuRatePercent({
          quotation: {
            subtotal_amount: '100',
            notes: null,
            items: [{ tax_rate: '0.19' }, { tax_rate: '0.05' }],
          },
          profile: null,
        }),
      ).toBe(19);
      expect(
        resolveContractAiuRatePercent({
          quotation: {
            subtotal_amount: '100',
            notes: null,
            items: [
              { tax_rate: null },
              { tax_rate: 'abc' },
              { tax_rate: -1 },
              {},
            ],
          },
          profile: null,
        }),
      ).toBeNull();
    });

    it('el objeto sale de las notas; vacio delega al default de la tienda', () => {
      expect(
        buildContractAiuDraft(snapshot() as any, 'CT-1', 5).contract_object,
      ).toBe('Construcción de bodega industrial norte');

      const snap = snapshot() as any;
      snap.quotation.notes = '   ';
      expect(buildContractAiuDraft(snap, 'CT-1', 5).contract_object).toBeNull();
    });

    it('sin A/I/U definidos falla con CALC_001 (422), sin inventar dato', () => {
      const snap = snapshot() as any;
      snap.profile = null;
      const failing = () => buildContractAiuDraft(snap, 'CT-1', 5);

      expect(failing).toThrow(VendixHttpException);
      try {
        failing();
      } catch (error: any) {
        expect(error.errorCode).toBe('INVOICING_CALC_001');
        expect(error.getStatus()).toBe(422);
      }
    });

    it('sin tarifa en la cotizacion falla con CALC_001 (422)', () => {
      const snap = snapshot() as any;
      snap.quotation.items = [{ ...snap.quotation.items[0], tax_rate: null }];
      const failing = () => buildContractAiuDraft(snap, 'CT-1', 5);

      expect(failing).toThrow(VendixHttpException);
      try {
        failing();
      } catch (error: any) {
        expect(error.errorCode).toBe('INVOICING_CALC_001');
        expect(error.getStatus()).toBe(422);
      }
    });

    it('la matriz de la factura iguala al snapshot campo a campo', () => {
      const calculator = new InvoiceCalculatorService();
      const service = Object.create(InvoicingService.prototype) as any;
      const draft = buildContractAiuDraft(snapshot() as any, 'CT-1', 5);

      const calculation = calculator.calculate({
        aiu: { taxable_basis: 'aiu' },
        items: draft.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          discount_amount: line.discount_amount,
          aiu_component: line.aiu_component,
          taxes: line.taxes,
        })),
      } as any);
      const matrix = service.buildAiuTaxableMatrix(
        calculation.lines,
        { taxable_basis: 'aiu' },
        'invoice:create-from-contract',
      ) as any;

      expect(matrix.taxable_basis).toBe('aiu');
      expect(matrix.regime).toBe('et_462_1');
      expect(matrix.minimum).toEqual({ enforced: true, percent: '10.00' });
      expect(matrix.taxable_without_rate).toEqual([]);
      const by_component = new Map(
        matrix.components.map((entry: any) => [entry.component, entry]),
      );
      expect(by_component.get('administracion')).toMatchObject({
        taxable: true,
        lines: 1,
        taxable_amount: '100000.00',
        tax_amount: '19000.00',
      });
      expect(by_component.get('imprevistos')).toMatchObject({
        taxable: true,
        lines: 1,
        taxable_amount: '50000.00',
        tax_amount: '9500.00',
      });
      expect(by_component.get('utilidad')).toMatchObject({
        taxable: true,
        lines: 1,
        taxable_amount: '50000.00',
        tax_amount: '9500.00',
      });
      // Piso: el AIU es el 100 % de sus propias lineas, siempre >= 10 %.
      expect(calculation.divergences ?? []).toEqual([]);
    });
  });

  describe('metodo (prisma mockeado, motor real)', () => {
    const customer = {
      id: 50,
      first_name: 'Obra',
      last_name: 'Norte',
      legal_name: 'Constructora Norte S.A.S.',
      document_type: '31',
      document_number: '900123456',
    };

    const createService = (overrides: any = {}) => {
      const tx = {
        contracts: {
          findFirst: jest.fn(),
          updateMany: jest.fn(),
        },
        invoices: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
        ...overrides.tx,
      };
      const prisma: any = {
        contracts: {
          findFirst: jest.fn(),
          ...overrides.scopedContracts,
        },
        invoices: {
          findFirst: jest.fn(),
          ...overrides.scopedInvoices,
        },
        users: {
          findFirst: jest.fn().mockResolvedValue(customer),
          ...overrides.users,
        },
        store_settings: {
          findUnique: jest.fn().mockResolvedValue(null),
          ...overrides.storeSettings,
        },
        withoutScope: jest.fn().mockReturnValue({
          $transaction: (fn: any) => fn(tx),
        }),
        ...overrides.prisma,
      };
      const generator = {
        generateNextNumber: jest
          .fn()
          .mockResolvedValue({ invoice_number: 'FV-1', resolution_id: 7 }),
        ...overrides.generator,
      };
      const eventEmitter = { emit: jest.fn() } as any;
      const service = new InvoicingService(
        prisma,
        generator as any,
        eventEmitter,
        {
          resolveAccountingEntityForFiscal: jest
            .fn()
            .mockResolvedValue({ id: 77 }),
        } as any,
        {} as any,
        {} as any,
        { assertAreaActive: jest.fn().mockResolvedValue(undefined) } as any,
        {} as any,
        new InvoiceCalculatorService(),
        {} as any,
        {} as any,
      );
      return { service, prisma, tx, generator, eventEmitter };
    };

    const happyMocks = (contractRow: any) => ({
      scopedContracts: {
        findFirst: jest.fn().mockResolvedValue(contractRow),
      },
      scopedInvoices: { findFirst: jest.fn().mockResolvedValue(null) },
      tx: {
        contracts: {
          findFirst: jest.fn().mockResolvedValue(contractRow),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        invoices: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }: any) => ({
            id: 100,
            invoice_number: data.invoice_number,
            status: 'draft',
            contract_id: data.contract_id,
            operation_type: data.operation_type,
          })),
        },
      },
    });

    it('crea el borrador AIU y pasa el contrato a invoiced en un solo commit', async () => {
      const row = contract();
      const { service, tx, generator, eventEmitter } = createService(
        happyMocks(row),
      );

      const result: any = await RequestContextService.run(
        requestContext,
        () => service.createInvoiceFromContract(5),
      );

      const created = tx.invoices.create.mock.calls[0][0];
      expect(created.data.contract_id).toBe(5);
      expect(created.data.operation_type).toBe('09');
      expect(created.data.status).toBe('draft');
      expect(created.data.invoice_type).toBe('sales_invoice');
      expect(created.data.invoice_number).toBe('FV-1');
      expect(created.data.resolution_id).toBe(7);
      expect(created.data.customer_id).toBe(50);
      expect(created.data.customer_name).toBe('Constructora Norte S.A.S.');
      expect(created.data.customer_tax_id).toBe('900123456');
      // Snapshots AIU congelados con lo validado.
      expect(created.data.aiu_contract_object).toBe(
        'Construcción de bodega industrial norte',
      );
      expect(created.data.aiu_regime).toBe('et_462_1');
      expect(Number(created.data.aiu_minimum_percent)).toBe(10);
      expect(created.data.aiu_taxable_matrix.taxable_basis).toBe('aiu');
      // Tres lineas A/I/U con el IVA heredado (100000/50000/50000 + 19 %).
      expect(created.data.invoice_items.create).toHaveLength(3);
      expect(
        created.data.invoice_items.create.map((item: any) => item.aiu_component),
      ).toEqual(['administracion', 'imprevistos', 'utilidad']);
      expect(Number(created.data.subtotal_amount)).toBe(200000);
      expect(Number(created.data.tax_amount)).toBe(38000);
      expect(Number(created.data.total_amount)).toBe(238000);
      expect(created.data.invoice_taxes.create).toHaveLength(1);
      // Transicion atomica del contrato dentro del mismo commit.
      expect(tx.contracts.updateMany).toHaveBeenCalledWith({
        where: { id: 5, store_id: 2, status: 'active' },
        data: { status: 'invoiced', updated_at: expect.any(Date) },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith('invoice.created', {
        invoice_id: 100,
        invoice_number: 'FV-1',
        invoice_type: 'sales_invoice',
        source: 'contract',
        contract_id: 5,
      });
      expect(result.contract_id).toBe(5);
      expect(generator.generateNextNumber).toHaveBeenCalledTimes(1);
    });

    it('doble generacion: 409 CONTRACT_INVOICE_001 sin crear ni numerar', async () => {
      const { service, prisma, tx, generator } = createService({
        scopedContracts: {
          findFirst: jest.fn().mockResolvedValue(contract()),
        },
        scopedInvoices: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 100, invoice_number: 'FV-1' }),
        },
      });

      const failing = () =>
        RequestContextService.run(requestContext, () =>
          service.createInvoiceFromContract(5),
        );
      await expect(failing()).rejects.toMatchObject({
        errorCode: 'CONTRACT_INVOICE_001',
      });
      try {
        await failing();
      } catch (error: any) {
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse().details).toMatchObject({
          contract_id: 5,
          invoice_id: 100,
        });
      }
      expect(generator.generateNextNumber).not.toHaveBeenCalled();
      expect(prisma.withoutScope).not.toHaveBeenCalled();
      expect(tx.invoices.create).not.toHaveBeenCalled();
    });

    it('contrato no vigente: 422 CONTRACT_STATUS_001 sin numerar', async () => {
      const { service, generator } = createService({
        scopedContracts: {
          findFirst: jest.fn().mockResolvedValue(contract({ status: 'draft' })),
        },
        scopedInvoices: { findFirst: jest.fn().mockResolvedValue(null) },
      });

      const failing = () =>
        RequestContextService.run(requestContext, () =>
          service.createInvoiceFromContract(5),
        );
      await expect(failing()).rejects.toMatchObject({
        errorCode: 'CONTRACT_STATUS_001',
      });
      try {
        await failing();
      } catch (error: any) {
        expect(error.getStatus()).toBe(422);
        expect(error.getResponse().details).toMatchObject({
          contract_id: 5,
          current_status: 'draft',
          required_status: 'active',
        });
      }
      expect(generator.generateNextNumber).not.toHaveBeenCalled();
    });

    it('contrato inexistente: 404 sin numerar', async () => {
      const { service, generator } = createService({
        scopedContracts: { findFirst: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        RequestContextService.run(requestContext, () =>
          service.createInvoiceFromContract(999),
        ),
      ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
      expect(generator.generateNextNumber).not.toHaveBeenCalled();
    });

    it('contrato sin A/I/U: 422 antes de numerar (nada que precargar)', async () => {
      const row = contract();
      (row.snapshot as any).profile = null;
      const { service, generator } = createService(happyMocks(row));

      await expect(
        RequestContextService.run(requestContext, () =>
          service.createInvoiceFromContract(5),
        ),
      ).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
      expect(generator.generateNextNumber).not.toHaveBeenCalled();
    });

    it('carrera en-tx (P2002 del UNIQUE parcial): 409 con la ganadora', async () => {
      const row = contract();
      const winner = { id: 100, invoice_number: 'FV-1' };
      const scopedFind = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(winner);
      const { service } = createService({
        scopedContracts: {
          findFirst: jest.fn().mockResolvedValue(row),
        },
        scopedInvoices: { findFirst: scopedFind },
        tx: {
          contracts: {
            findFirst: jest.fn().mockResolvedValue(row),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          invoices: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockRejectedValue({ code: 'P2002' }),
          },
        },
      });

      const failing = () =>
        RequestContextService.run(requestContext, () =>
          service.createInvoiceFromContract(5),
        );
      await expect(failing()).rejects.toMatchObject({
        errorCode: 'CONTRACT_INVOICE_001',
      });
      try {
        await failing();
      } catch (error: any) {
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse().details.invoice_id).toBe(100);
      }
    });
  });
});
