import { VendixHttpException } from 'src/common/errors';
import { FiscalCreditNoteDataProvider } from './fiscal-credit-note.provider';
import { CreditNoteDataProvider } from './credit-note.provider';
import { KitchenTicketDataProvider } from './kitchen-ticket.provider';
import { TransferNoteDataProvider } from './transfer-note.provider';
import { PosSaleTicketDataProvider } from './pos-sale-ticket.provider';
import { DispatchRouteDataProvider } from './dispatch-route.provider';
import {
  WithholdingPracticedDataProvider,
} from './withholding-practiced.provider';
import {
  WithholdingSufferedDataProvider,
} from './withholding-suffered.provider';
import {
  WithholdingEmployeeCertificateDataProvider,
} from './withholding-employee.provider';
import { mapFiscalDocumentToPrintData } from './fiscal-document-print.mapper';
import { PrintLayoutComposerService } from '../services/print-layout-composer.service';
import { PrintTemplateCompilerService } from '../services/print-template-compiler.service';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';

/**
 * El carril REAL de impresión no puede devolver una muestra.
 *
 * `print-gateway.service.ts:174` llama `fetchDocumentData(storeId, documentId)`
 * para imprimir de verdad; `:280` lo llama para previsualizar, y ahí sí envuelve
 * la llamada en un `try/catch` que cae a `getSampleData`. Cuatro proveedores
 * hacían `return this.getSampleData(storeId)` en el primero, o sea que imprimir
 * entregaba un documento con datos de un tercero y formato impecable. Estas
 * pruebas fijan la separación: el carril real lee o falla, nunca fabrica.
 */

const prismaQueVacia = () => ({
  invoices: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
});

const qrFalso = () => ({
  generateBuffer: jest.fn().mockResolvedValue(Buffer.from('x')),
});

describe('carril real de impresión: leer o fallar, nunca fabricar', () => {
  it('la nota de crédito fiscal LANZA con un id que no existe, en vez de devolver la muestra', async () => {
    const prisma = prismaQueVacia();
    const p = new FiscalCreditNoteDataProvider(prisma as any, qrFalso() as any);

    await expect(p.fetchDocumentData(10, 999999)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    // La prueba fuerte no es que lance: es que consultó. Un `return sample`
    // habría resuelto sin tocar la base.
    expect(prisma.invoices.findFirst).toHaveBeenCalledTimes(1);
  });

  it('la nota de crédito fiscal filtra por invoice_type: un id de factura de venta no se imprime como nota', async () => {
    const prisma = prismaQueVacia();
    const p = new FiscalCreditNoteDataProvider(prisma as any, qrFalso() as any);

    await expect(p.fetchDocumentData(10, 12)).rejects.toThrow();

    const where = prisma.invoices.findFirst.mock.calls[0][0].where;
    expect(where.store_id).toBe(10);
    expect(where.id).toBe(12);
    expect(where.invoice_type).toEqual({ in: ['credit_note'] });
  });

  it('la nota de crédito NO fiscal también lee, y también filtra por tipo', async () => {
    const prisma = prismaQueVacia();
    const p = new CreditNoteDataProvider(prisma as any);

    await expect(p.fetchDocumentData(10, 12)).rejects.toThrow();

    const where = prisma.invoices.findFirst.mock.calls[0][0].where;
    expect(where.invoice_type).toBe('credit_note');
  });

  it('un id no numérico se rechaza antes de consultar', async () => {
    const prisma = prismaQueVacia();
    const p = new FiscalCreditNoteDataProvider(prisma as any, qrFalso() as any);

    await expect(p.fetchDocumentData(10, 'abc')).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(prisma.invoices.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['kitchen_ticket', () => new KitchenTicketDataProvider({
      kitchen_tickets: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any)],
    ['transfer_note', () => new TransferNoteDataProvider({
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7, name: 'Tienda Test' }) },
      stock_transfers: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any)],
    ['dispatch_route', () => new DispatchRouteDataProvider({
      dispatch_routes: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any)],
    ['withholding_practiced', () => new WithholdingPracticedDataProvider({
      withholding_calculations: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any)],
    ['withholding_suffered', () => new WithholdingSufferedDataProvider({
      withholding_calculations: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any)],
    ['withholding_employee_certificate', () => new WithholdingEmployeeCertificateDataProvider({
      withholding_calculations: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any)],
  ])(
    '%s: id inexistente → 404 (PRINT_DOCUMENT_NOT_FOUND_001) — ya no fabrica',
    async (_nombre, construir) => {
      const p: any = construir();

      await expect(p.fetchDocumentData(10, 999999)).rejects.toMatchObject({
        errorCode: 'PRINT_DOCUMENT_NOT_FOUND_001',
      });

      // 404 (no 501): el lector EXISTE, lo que pasa es que la fila no.
      try {
        await p.fetchDocumentData(10, 999999);
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
      }
    },
  );

  it('los cuatro conservan su getSampleData: la previsualización sigue teniendo con qué pintar', async () => {
    const cuatro: any[] = [
      new FiscalCreditNoteDataProvider({} as any, qrFalso() as any),
      new CreditNoteDataProvider({} as any),
      new KitchenTicketDataProvider({} as any),
      new TransferNoteDataProvider({} as any),
    ];

    for (const p of cuatro) {
      const muestra = await p.getSampleData(10);
      expect(muestra.document.number).toBeTruthy();
      expect(muestra.store.name).toBeTruthy();
    }
  });

  /**
   * [print-editor-dsk P8] — Camino feliz del lector de `transfer_note`.
   * Antes del 2026-08-27 este proveedor rechazaba todo id con un 501. Hoy
   * lee `stock_transfers` filtrado por `organization_id` (derivado de la
   * tienda, porque la transferencia es a nivel de organización, no de tienda).
   */
  it('transfer_note: lee la fila real y arma el modelo de impresión', async () => {
    const findFirstStore = jest
      .fn()
      .mockResolvedValue({ organization_id: 7, name: 'Tienda Test' });
    const findFirstTransfer = jest.fn().mockResolvedValue({
      id: 88,
      transfer_number: 'TRAS-2026-00088',
      transfer_date: new Date('2026-08-20T15:00:00.000Z'),
      status: 'completed',
      notes: 'Reposición fin de semana',
      from_location: { id: 1, name: 'Bodega Central', code: 'BOD-01' },
      to_location: { id: 2, name: 'Tienda Unicentro', code: 'TIEN-02' },
      stock_transfer_items: [
        {
          id: 1,
          quantity: 25,
          notes: null,
          products: { id: 10, name: 'Pantalón Jean Slim', sku: 'JEA-SLIM', unit: 'unit' },
          product_variants: { id: 100, sku: 'JEA-SLIM-AZU-32', name: 'Azul 32' },
        },
      ],
    });
    const prisma = {
      stores: { findFirst: findFirstStore },
      stock_transfers: { findFirst: findFirstTransfer },
    } as any;
    const p = new TransferNoteDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 88);

    // Filtro de organización (no `store_id`), derivado del `stores.findFirst`.
    expect(findFirstStore).toHaveBeenCalledTimes(1);
    expect(findFirstTransfer.mock.calls[0][0].where).toEqual({
      id: 88,
      organization_id: 7,
    });
    expect(data.document.number).toBe('TRAS-2026-00088');
    expect(data.document.origin_location).toBe('Bodega Central');
    expect(data.document.destination_location).toBe('Tienda Unicentro');
    expect(data.items).toHaveLength(1);
    expect(data.items[0].product_name).toBe('Pantalón Jean Slim');
    expect(data.items[0].variant_sku).toBe('JEA-SLIM-AZU-32');
    expect(data.items[0].quantity).toBe(25);
  });

  /**
   * [print-editor-dsk P8] — Camino feliz del lector de `kitchen_ticket`.
   * La mesa y el mesero vienen del grafo `orders → table_sessions →
   * tables/opener` (la tabla `orders` no carga `table_id` directo).
   */
  it('kitchen_ticket: lee la fila real y deriva mesa + mesero del grafo de la orden', async () => {
    const findFirstTicket = jest.fn().mockResolvedValue({
      id: 42,
      fired_at: new Date('2026-08-22T14:25:00.000Z'),
      status: 'fired',
      daily_number: 7,
      business_date: new Date('2026-08-22'),
      ready_at: null,
      kds: { id: 1, name: 'Cocina Caliente', code: 'kitchen' },
      items: [
        {
          id: 1,
          quantity: 2,
          notes: 'Término 3/4',
          product: { id: 10, name: 'Hamburguesa Doble', sku: 'HAM-DOB' },
          exclusions: [],
        },
      ],
      order: { id: 100, order_number: 'ORD-2026-0012' },
    });
    const findFirstSession = jest.fn().mockResolvedValue({
      id: 5,
      guest_count: 3,
      table: { id: 4, name: '04', zone: 'Salón principal' },
      opener: { first_name: 'Mateo', last_name: 'Sánchez' },
    });
    const prisma = {
      kitchen_tickets: { findFirst: findFirstTicket },
      table_sessions: { findFirst: findFirstSession },
    } as any;
    const p = new KitchenTicketDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 42);

    expect(findFirstTicket.mock.calls[0][0].where).toEqual({ id: 42, store_id: 10 });
    expect(data.document.number).toBe('KITCHEN-42');
    expect(data.document.table_number).toBe('Mesa 04');
    expect(data.document.waiter_name).toBe('Mateo Sánchez');
    expect(data.document.time).toMatch(/^\d{2}:\d{2}/);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].product_name).toBe('Hamburguesa Doble');
    expect(data.items[0].quantity).toBe(2);
    expect(data.custom_variables?.kds_name).toBe('Cocina Caliente');
    expect(data.custom_variables?.order_number).toBe('ORD-2026-0012');

    // A.5 / CP-POLLO-ARABE-727 A.7 — la sesión ABIERTA (closed_at IS NULL) y la
    // más reciente se resuelve con un `findFirst` top-level sobre `table_sessions`
    // (que sí pasa por el scoping), no con un include anidado.
    expect(findFirstSession).toHaveBeenCalledTimes(1);
    expect(findFirstSession.mock.calls[0][0].where).toEqual({
      order_id: 100,
      closed_at: null,
    });
    expect(findFirstSession.mock.calls[0][0].orderBy).toEqual({
      opened_at: 'desc',
    });
    expect(findFirstSession.mock.calls[0][0].take).toBe(1);
  });

  it('kitchen_ticket: el mesero asignado (table_waiters) manda sobre el opener', async () => {
    const findFirstTicket = jest.fn().mockResolvedValue({
      id: 43,
      fired_at: new Date('2026-08-22T15:00:00.000Z'),
      status: 'fired',
      daily_number: 8,
      business_date: new Date('2026-08-22'),
      ready_at: null,
      kds: { id: 1, name: 'Cocina Caliente', code: 'kitchen' },
      items: [
        {
          id: 2,
          quantity: 1,
          notes: null,
          product: { id: 11, name: 'Pollo Asado', sku: 'POL-AS' },
          exclusions: [],
        },
      ],
      order: { id: 101, order_number: 'ORD-2026-0013' },
    });
    const findFirstSession = jest.fn().mockResolvedValue({
      id: 6,
      guest_count: 2,
      table: {
        id: 5,
        name: '05',
        zone: 'Salón principal',
        table_waiters: [{ user: { first_name: 'Lucía', last_name: 'Ramírez' } }],
      },
      opener: { first_name: 'Mateo', last_name: 'Sánchez' },
    });
    const prisma = {
      kitchen_tickets: { findFirst: findFirstTicket },
      table_sessions: { findFirst: findFirstSession },
    } as any;
    const p = new KitchenTicketDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 43);

    // C.3 — el mesero asignado (table_waiters) gana al opener.
    expect(data.document.waiter_name).toBe('Lucía Ramírez');
    expect(data.document.table_number).toBe('Mesa 05');
  });

  it('kitchen_ticket: orden sin mesa (sin sesión abierta) → sin mesa ni mesero, no rompe', async () => {
    const findFirstTicket = jest.fn().mockResolvedValue({
      id: 44,
      fired_at: new Date('2026-08-22T16:00:00.000Z'),
      status: 'fired',
      daily_number: 9,
      business_date: new Date('2026-08-22'),
      ready_at: null,
      kds: { id: 1, name: 'Cocina Caliente', code: 'kitchen' },
      items: [
        {
          id: 3,
          quantity: 1,
          notes: null,
          product: { id: 12, name: 'Malta', sku: 'MAL' },
          exclusions: [],
        },
      ],
      order: { id: 102, order_number: 'ORD-2026-0014' },
    });
    const findFirstSession = jest.fn().mockResolvedValue(null);
    const prisma = {
      kitchen_tickets: { findFirst: findFirstTicket },
      table_sessions: { findFirst: findFirstSession },
    } as any;
    const p = new KitchenTicketDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 44);

    // Regresión (A.5/C.3/CP-POLLO-ARABE-727 A.7): un ticket sin mesa no debe
    // romper ni inventar datos.
    expect(data.document.table_number).toBe('');
    expect(data.document.waiter_name).toBe('');
    expect(data.items).toHaveLength(1);
  });

  /**
   * [QUI-727 F.1 — cierre, Step 8] — Un spec que afirma sobre el modelo de
   * datos (`data.document.table_number`, como los dos tests de arriba) puede
   * quedar en verde mientras el papel sale vacío: exactamente el defecto que
   * la oleada 5 encontró en la sección `table_info`. Antes de C.3, la
   * sección `table_info` de la plantilla sembrada NO declaraba `fields`, y
   * el compositor no tenía `case 'table_info'` en el switch de
   * `renderSection` — caía al `default: renderGenericFieldsSection(...)`,
   * cuya primera instrucción es `if (fields.length === 0) return '';`.
   * Resultado: sección habilitada, con título, que emitía cadena vacía.
   *
   * Este test grepea el HTML devuelto por `compose()` (el método real,
   * ejercitando el switch completo), no el objeto `StandardPrintDataModel`.
   * Reproduce a propósito la plantilla sembrada sin `fields` en la sección
   * `table_info` — si el `case 'table_info'` se revierte, este caso debe
   * fallar aunque los dos tests de arriba (que solo miran el modelo) sigan
   * en verde.
   */
  it('compose(): el tiquete de cocina renderiza mesa y mesero en el HTML, no solo en el modelo de datos', () => {
    const composer = new PrintLayoutComposerService(
      new PrintTemplateCompilerService(),
    );

    const data: StandardPrintDataModel = {
      store: { name: 'Restaurante Test' },
      document: {
        id: 42,
        number: 'KITCHEN-42',
        date: '2026-08-22',
        date_formatted: '2026-08-22',
        time: '14:25',
        state: 'fired',
        state_label: 'Disparado',
        table_number: 'Mesa 7',
        waiter_name: 'Ana Mesera',
      },
      items: [
        {
          index: 1,
          product_name: 'Hamburguesa Doble',
          quantity: 2,
          unit_price: 0,
          total_price: 0,
        },
      ],
      taxes: [],
      totals: {
        subtotal: 0,
        subtotal_formatted: '$0',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 0,
        grand_total_formatted: '$0',
      },
    };

    // Plantilla sembrada real: la sección `table_info` habilitada, SIN
    // `fields` (así se siembra hoy — ver comentario en
    // `print-layout-composer.service.ts` junto al `case 'table_info'`).
    const definition: PrintFormatDefinition = {
      v: 1,
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        margin_mm: 5,
        copies: 1,
      },
      sections: [
        {
          id: 'mesa-mesero',
          type: 'table_info',
          title: 'Mesa, Mesero y Turno',
          enabled: true,
          order: 1,
        },
      ],
    };

    const html = composer.compose(definition, data);

    expect(html).toContain('Mesa 7');
    expect(html).toContain('Ana Mesera');
  });

  it('pos_sale_ticket: venta en mesa — incluye la sesión ABIERTA y mapea mesa + mesero', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 7,
      order_number: 'POS-0007',
      created_at: new Date('2026-08-27T09:15:00.000Z'),
      state: 'finished',
      subtotal_amount: 100000,
      discount_amount: 0,
      tax_amount: 19000,
      grand_total: 119000,
      // QUI-751 — antes mockeaba `order_taxes: []`, una relación que NO existe
      // en `schema.prisma`. Eso era la razón por la que el bug del include
      // (también inexistente en `pos-sale-ticket.provider.ts`) pasaba este
      // spec en verde: el mock satisfacía la consulta sin que Prisma
      // validara nada. Ahora el fixture refleja la forma REAL: líneas con su
      // `order_item_taxes[]`. Sin líneas, la agregación devuelve [].
      // ESTE TEST NO CUBRE: que la agregación de `aggregateTaxes` sume
      // `tax_amount` por `(tax_name, tax_rate)` ni que derive la base como
      // `tax_amount / tax_rate` — probar eso requiere un mock con varias
      // líneas y tasas distintas. Lo dejo declarado, no disfrazado de verde.
      order_items: [],
      users: null,
      stores: {
        name: 'Tienda Test',
        organizations: { tax_id: '900.000.000-1' },
        addresses: [],
      },
      table_sessions: [
        {
          id: 9,
          guest_count: 3,
          table: {
            id: 7,
            name: '07',
            zone: 'Terraza',
            table_waiters: [{ user: { first_name: 'Lucía', last_name: 'Ramírez' } }],
          },
          opener: { first_name: 'Mateo', last_name: 'Sánchez' },
        },
      ],
    });
    const prisma = { orders: { findFirst } } as any;
    const p = new PosSaleTicketDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 7);

    // C.3 — la consulta pide la sesión ABIERTA (closed_at IS NULL) y la más
    // reciente; el recibo mapea mesa + mesero (asignado, prioridad sobre opener).
    const tableSessions = findFirst.mock.calls[0][0].include.table_sessions;
    expect(tableSessions.where).toEqual({ closed_at: null });
    expect(tableSessions.orderBy).toEqual({ opened_at: 'desc' });
    expect(data.document.table_number).toBe('Mesa 07');
    expect(data.document.waiter_name).toBe('Lucía Ramírez');
  });

  /**
   * [print-editor-dsk P8] — Camino feliz del lector de `dispatch_route`.
   * La planilla DSD es OPERATIVA, no transaccional: el documento arma
   * vehículo + conductor + transportista externo (si lo hay) + la secuencia
   * de paradas con su cliente y dirección. No usa `items[]` — usa
   * `custom_variables.stops[]`.
   */
  it('dispatch_route: lee la ruta real y arma vehículo + paradas en custom_variables', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 5,
      route_number: 'PLANILLA-2026-0005',
      planned_date: new Date('2026-08-25T08:00:00.000Z'),
      created_at: new Date('2026-08-25T07:30:00.000Z'),
      status: 'dispatched',
      notes: null,
      total_to_collect: 1250000,
      total_collected: 0,
      vehicles: { plate: 'WXB-987', brand: 'Chevrolet', model_name: 'NPR', type: 'truck' },
      driver_user: { first_name: 'Carlos', last_name: 'Pérez', document_number: '79123456' },
      external_carrier: { name: '', code: '', contact_person: '' },
      origin_location: { name: 'Bodega Central Calle 80', code: 'BOD-01' },
      stops: [
        {
          stop_sequence: 1,
          status: 'pending',
          result: null,
          collected_amount: 0,
          withholding_amount: 0,
          is_prepaid: false,
          dispatch_note: {
            id: 452,
            dispatch_number: 'REM-2026-00452',
            customer_name: 'Cliente Demo 1',
            customer_phone: '+57 300 111 2222',
            customer_address: 'Calle 100 # 15-20',
            order: { user: { first_name: '', last_name: '', phone: '' } },
          },
        },
      ],
    });
    const prisma = { dispatch_routes: { findFirst } } as any;
    const p = new DispatchRouteDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 5);

    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 5, store_id: 10 });
    expect(data.document.number).toBe('PLANILLA-2026-0005');
    expect(data.document.state).toBe('dispatched');
    expect(data.custom_variables?.vehicle_plate).toBe('WXB-987');
    expect(data.custom_variables?.driver_name).toBe('Carlos Pérez');
    expect(data.custom_variables?.origin_location).toBe('Bodega Central Calle 80');
    expect(data.custom_variables?.total_to_collect).toBe(1250000);
    const stops = data.custom_variables?.stops as any[];
    expect(stops).toHaveLength(1);
    expect(stops[0].sequence).toBe(1);
    expect(stops[0].customer).toBe('Cliente Demo 1');
    expect(stops[0].address).toBe('Calle 100 # 15-20');
  });

  /**
   * [print-editor-dsk P8] — `withholding_practiced` lee de
   * `withholding_calculations` con `role='practiced'`. Cuando la tabla
   * `withholding_certificates` exista, este provider se conecta a ella sin
   * cambiar la interfaz pública — ese salto queda documentado en el plan.
   */
  it('withholding_practiced: lee el cálculo con role=practiced y proyecta proveedor', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 99,
      created_at: new Date('2026-08-20T00:00:00.000Z'),
      year: 2026,
      base_amount: 1000000,
      withholding_amount: 25000,
      withholding_rate: 2.5,
      concept: { code: 'RETEFTE', name: 'Retención en la fuente', rate: 2.5, withholding_type: 'retefuente' },
      supplier: { name: 'Proveedor Demo S.A.S.', tax_id: '800.555.444', verification_digit: '9' },
      customer: null,
      invoice: { invoice_number: 'FV-2026-0099', issue_date: new Date('2026-08-15') },
    });
    const prisma = { withholding_calculations: { findFirst } } as any;
    const p = new WithholdingPracticedDataProvider(prisma);

    const data = await p.fetchDocumentData(10, 99);

    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 99,
      store_id: 10,
      role: 'practiced',
    });
    expect(data.document.number).toBe('WH-PRAC-99');
    expect(data.customer?.name).toBe('Proveedor Demo S.A.S.');
    expect(data.totals.grand_total).toBe(25000);
    expect(data.custom_variables?.concept_code).toBe('RETEFTE');
    expect(data.custom_variables?.year).toBe(2026);
  });
});

describe('[print-editor-dsk P3.1] — picker de documentos recientes (listRecent)', () => {
  /**
   * El picker del editor del Hub se alimenta de `provider.listRecent(storeId, limit)`.
   * Aquí se verifica que el POS (el caso más común y de mayor volumen) hace la
   * consulta barata correcta: `select` mínimo + `orderBy created_at desc` +
   * `take = limit`. Si la proyección cambia, el picker podría leer miles de
   * filas y romper la previsualización.
   */
  it('pos_sale_ticket: ordena por created_at desc, take=limit, select mínimo', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 8,
        order_number: 'POS-0008',
        created_at: new Date('2026-08-27T10:30:00.000Z'),
        grand_total: 87500,
      },
      {
        id: 7,
        order_number: 'POS-0007',
        created_at: new Date('2026-08-27T09:15:00.000Z'),
        grand_total: 12000,
      },
    ]);
    const prisma = { orders: { findMany } } as any;
    const p = new PosSaleTicketDataProvider(prisma);

    const data = await p.listRecent(42, 20);

    // La consulta correcta:
    const call = findMany.mock.calls[0][0];
    expect(call.where).toEqual({ store_id: 42 });
    expect(call.orderBy).toEqual({ created_at: 'desc' });
    expect(call.take).toBe(20);
    // Sin `include` — debe ser una consulta barata.
    expect(call.include).toBeUndefined();
    // `select` mínimo: id + número + fecha + total.
    expect(call.select).toEqual({
      id: true,
      order_number: true,
      created_at: true,
      grand_total: true,
    });

    // Y la salida formateada:
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe(8);
    expect(data[0].number).toBe('POS-0008');
    expect(data[0].date_formatted).toMatch(/\d/);
    expect(data[0].total_formatted).toMatch(/\$/);
  });

  it('pos_sale_ticket: respeta el take pasado por el servicio (caller controla el cap)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const p = new PosSaleTicketDataProvider({ orders: { findMany } } as any);

    await p.listRecent(1, 5);
    expect(findMany.mock.calls[0][0].take).toBe(5);

    await p.listRecent(1, 50);
    expect(findMany.mock.calls[1][0].take).toBe(50);
  });
});

describe('mapeador compartido invoices → modelo de impresión', () => {
  /**
   * Fila fiscalmente COMPLETA a propósito: con E.11 el emisor pasa por el
   * resolvedor único (`resolveFiscalIssuerForPrint`) y un documento electrónico
   * (`dian_status !== 'not_applicable'`) es ESTRICTO — identidad incompleta
   * lanza `FISCAL_IDENTITY_INCOMPLETE`, igual que `generatePdf`. La fila trae
   * su `fiscal_data` de tienda para poder ejercitar el camino feliz.
   */
  const filaViva = {
    id: 41,
    invoice_number: 'NC107',
    issue_date: new Date('2026-08-20T15:00:00.000Z'),
    dian_status: 'accepted',
    subtotal_amount: 100000,
    discount_amount: 0,
    tax_amount: 19000,
    withholding_amount: 5000,
    total_amount: 119000,
    cufe: 'cufe-real-de-la-fila',
    qr_code: 'contenido-qr',
    related_invoice_id: 12,
    invoice_items: [{ name: 'Servicio', quantity: 1, price: 100000, total: 100000 }],
    invoice_taxes: [{ tax_name: 'IVA', tax_rate: 19, taxable_amount: 100000, tax_amount: 19000 }],
    resolution: { resolution_number: '18760000001', prefix: 'NC' },
    store: {
      name: 'Tienda Real',
      addresses: [
        {
          address_line1: 'Calle 1',
          city: 'Bogotá D.C.',
          state_province: 'Cundinamarca',
          municipality_code: '11001',
        },
      ],
      store_settings: {
        settings: {
          fiscal_data: {
            nit: '901555333',
            legal_name: 'Tienda Real Ltda.',
            municipality_code: '11001',
            department: 'Cundinamarca',
          },
        },
      },
    },
    organization: {
      name: 'Org Real',
      legal_name: 'Org Real S.A.S.',
      tax_id: '900000000-1',
      fiscal_scope: 'STORE',
      addresses: [],
    },
    customer: { first_name: 'Ana', last_name: 'Gómez', document_number: '1020304050' },
  };

  it('no imprime el prefijo dos veces: `number` sale limpio y `prefix` no se rellena', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    // El compositor arma `doc.prefix ? doc.prefix + '-' : ''` + '#' + doc.number
    // (`print-layout-composer.service.ts:114`). El prefijo ya viene dentro de
    // `invoice_number`, así que poblar `prefix` daría `NC-#NC107`.
    expect(d.document.number).toBe('NC107');
    expect(d.document.prefix).toBeUndefined();
    expect(d.fiscal?.resolution_prefix).toBe('NC');
  });

  it('el CUFE y el adquiriente salen de la fila, no de una muestra', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    expect(d.fiscal?.cufe).toBe('cufe-real-de-la-fila');
    expect(d.customer?.name).toBe('Ana Gómez');
    expect(d.customer?.tax_id).toBe('1020304050');
    // El NIT de la muestra fiscal que se imprimía antes por cualquier id.
    expect(d.customer?.tax_id).not.toBe('800.123.987-6');
  });

  it('la referencia al documento corregido viaja cuando se le pasa', () => {
    const sin = mapFiscalDocumentToPrintData(filaViva);
    const con = mapFiscalDocumentToPrintData(filaViva, {
      referenceDocumentNumber: 'QA107',
    });

    expect(sin.document.reference_document_number).toBeUndefined();
    expect(con.document.reference_document_number).toBe('QA107');
  });

  it('las etiquetas de estado son configurables y respetan dian_status', () => {
    const aceptada = mapFiscalDocumentToPrintData(filaViva, {
      acceptedLabel: 'Nota crédito aprobada por DIAN',
      pendingLabel: 'Nota crédito pendiente',
    });
    const pendiente = mapFiscalDocumentToPrintData(
      { ...filaViva, dian_status: 'pending' },
      {
        acceptedLabel: 'Nota crédito aprobada por DIAN',
        pendingLabel: 'Nota crédito pendiente',
      },
    );

    expect(aceptada.document.state_label).toBe('Nota crédito aprobada por DIAN');
    expect(pendiente.document.state_label).toBe('Nota crédito pendiente');
  });

  it('los totales cierran contra la fila y el importe en letras sale del mismo total', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    expect(d.totals?.subtotal).toBe(100000);
    expect(d.totals?.tax_total).toBe(19000);
    expect(d.totals?.grand_total).toBe(119000);
    expect(d.totals?.grand_total_in_words).toContain('M/CTE');
  });

  it('una fila sin total_amount lo deriva, en vez de imprimir cero', () => {
    const d = mapFiscalDocumentToPrintData({
      ...filaViva,
      total_amount: null,
    });

    expect(d.totals?.grand_total).toBe(119000);
  });

  /**
   * E.11 casilla 1 — las dos brechas fiscales medidas en la medición del
   * builder (§0): retención ausente del modelo y NIT crudo sin resolvedor.
   */

  it('la retención llega a totals: el papel ya no puede perderla', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    expect(d.totals?.withholding_total).toBe(5000);
    expect(d.totals?.withholding_total_formatted).toBe('$5.000');
    // Informativa: NO descuenta del total — igual que el builder PDF.
    expect(d.totals?.grand_total).toBe(119000);
  });

  it('una fila sin retención reporta cero, no undefined', () => {
    const d = mapFiscalDocumentToPrintData({
      ...filaViva,
      withholding_amount: null,
    });

    expect(d.totals?.withholding_total).toBe(0);
  });

  it('mapea correctamente columnas reales de Prisma (unit_price, total_amount, description, product_variant) sin caer a $0', () => {
    const filaPrismaReal = {
      ...filaViva,
      payment_form: '1',
      payment_means_code: '10',
      due_date: new Date('2026-08-20T15:00:00.000Z'),
      invoice_items: [
        {
          id: 101,
          description: 'PANTALLA SAMSUNG GALAXY A21S',
          quantity: 1,
          unit_price: 40000,
          total_amount: 40000,
          discount_amount: 0,
          tax_amount: 0,
          product_id: 5,
          product_variant: {
            sku: 'PAN-SAM-A21S',
            barcode: '770123456789',
          },
        },
      ],
    };

    const d = mapFiscalDocumentToPrintData(filaPrismaReal);

    expect(d.items).toHaveLength(1);
    expect(d.items[0].product_name).toBe('PANTALLA SAMSUNG GALAXY A21S');
    expect(d.items[0].variant_sku).toBe('PAN-SAM-A21S');
    expect(d.items[0].quantity).toBe(1);
    expect(d.items[0].unit_price).toBe(40000);
    expect(d.items[0].unit_price_formatted).toBe('$40.000');
    expect(d.items[0].total_price).toBe(40000);
    expect(d.items[0].total_price_formatted).toBe('$40.000');
    expect(d.document.payment_method).toBe('Contado (Efectivo)');
    expect(d.document.valid_until_formatted).toBeDefined();
  });

  it('el NIT del emisor sale del RESOLVEDOR (fiscal_data de tienda gana al tax_id crudo de la organización) con DV derivado', () => {
    const d = mapFiscalDocumentToPrintData(filaViva);

    // Antes: `org.tax_id` crudo → «900000000-1». Ahora: `fiscal_data.nit` de la
    // tienda bajo `fiscal_scope='STORE'`, con DV calculado por módulo 11
    // (DV(901555333) = 8) y nunca el dígito almacenado.
    expect(d.store.tax_id).toBe('901555333-8');
    expect(d.store.tax_id).not.toBe('900000000-1');
    expect(d.store.legal_name).toBe('Tienda Real Ltda.');
    expect(d.store.name).toBe('Tienda Real'); // nombre comercial intacto
    expect(d.store.address).toBe('Calle 1');
    expect(d.store.city).toBe('Bogotá D.C.');
  });

  it('documento electrónico con identidad incompleta LANZA FISCAL_IDENTITY_INCOMPLETE — igual que generatePdf', async () => {
    const sinDepartamento = {
      ...filaViva,
      // Sin dirección que respalde: `buildFiscalIdentity` toma
      // `department` de `fiscal_data` O de `address.state_province`; aquí
      // ninguno existe → el resolvedor estricto corta.
      store: {
        name: filaViva.store.name,
        addresses: [],
        store_settings: {
          settings: {
            fiscal_data: {
              nit: '901555333',
              legal_name: 'Tienda Real Ltda.',
              municipality_code: '11001',
            },
          },
        },
      },
    };

    await expect(
      Promise.resolve().then(() => mapFiscalDocumentToPrintData(sinDepartamento)),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_IDENTITY_INCOMPLETE' });
  });

  it('recibo interno (not_applicable) SIN identidad completa se imprime permisivo — no hay XML con qué cuadrar', () => {
    const recibo = {
      ...filaViva,
      dian_status: 'not_applicable',
      store: {
        ...filaViva.store,
        store_settings: { settings: {} }, // sin fiscal_data
      },
    };

    const d = mapFiscalDocumentToPrintData(recibo);

    // Respaldo por columnas, normalizado y con DV derivado — nunca crudo.
    expect(d.store.tax_id).toBe('900000000-5');
    expect(d.document.state).toBe('not_applicable');
  });
});
