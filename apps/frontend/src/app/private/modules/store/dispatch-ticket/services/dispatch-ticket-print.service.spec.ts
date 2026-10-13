import { TestBed } from '@angular/core/testing';
import Decimal from 'decimal.js';
import { of, throwError } from 'rxjs';
import { DocumentPrintService } from '../../../../../shared/services/print/document-print.service';
import { PrintGatewayClientService } from '../../../../../shared/services/print/print-gateway-client.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DispatchTicketData } from '../models/dispatch-ticket-data.model';
import {
  DispatchTicketPrintService,
  PosDispatchPrintContext,
} from './dispatch-ticket-print.service';

describe('DispatchTicketPrintService POS auto-print policy', () => {
  let service: DispatchTicketPrintService;
  let documentPrint: jasmine.SpyObj<DocumentPrintService>;
  let gateway: jasmine.SpyObj<PrintGatewayClientService>;
  let detail: any;

  const data: DispatchTicketData = {
    orderId: 41,
    orderNumber: 'POS-41',
    dateFormatted: '10/10/2026',
    storeName: 'Tienda',
    customer: { name: 'Cliente', addressLine1: 'Calle 1' },
    items: [],
  };
  const printResult = {
    documents: 1,
    pages: 1,
    copies: 1,
    format: 'thermal_80',
  } as any;

  const makeDetail = (options: {
    is_active?: boolean;
    auto_print?: boolean;
    auto_print_after_pos_sale?: boolean;
  } = {}) => ({
    is_active: options.is_active ?? true,
    definition: {
      paper: {
        auto_print: options.auto_print,
        ...(options.auto_print_after_pos_sale !== undefined
          ? { auto_print_after_pos_sale: options.auto_print_after_pos_sale }
          : {}),
      },
    },
  });

  const makeContext = (
    overrides: Partial<PosDispatchPrintContext> = {},
  ): PosDispatchPrintContext => {
    const { order, ...context } = overrides;
    return {
      origin: 'sale_completed',
      counterEnabled: false,
      ...context,
      order: {
        id: 41,
        state: 'finished',
        status: 'finished',
        payment_status: 'paid',
        delivery_type: 'home_delivery',
        grand_total: '119.25',
        total_paid: '119.25',
        remaining_balance: '0',
        ...order,
      },
    };
  };

  beforeEach(() => {
    detail = makeDetail({ auto_print_after_pos_sale: true });
    documentPrint = jasmine.createSpyObj<DocumentPrintService>(
      'DocumentPrintService',
      ['printViaGateway'],
    );
    documentPrint.printViaGateway.and.returnValue(Promise.resolve(printResult));
    gateway = jasmine.createSpyObj<PrintGatewayClientService>(
      'PrintGatewayClientService',
      ['getFormatDetail'],
    );
    gateway.getFormatDetail.and.callFake(() => of(detail));

    TestBed.configureTestingModule({
      providers: [
        DispatchTicketPrintService,
        { provide: DocumentPrintService, useValue: documentPrint },
        { provide: PrintGatewayClientService, useValue: gateway },
        {
          provide: ToastService,
          useValue: { success: jasmine.createSpy(), error: jasmine.createSpy() },
        },
      ],
    });
    service = TestBed.inject(DispatchTicketPrintService);
  });

  it('prints the fully settled POS snapshot for counter, pickup, delivery and table sales', async () => {
    const fulfillmentTypes = [
      'direct_delivery',
      'pickup',
      'home_delivery',
      'dine_in',
    ];

    for (const [index, delivery_type] of fulfillmentTypes.entries()) {
      const orderId = 41 + index;
      await service.printFromPos(
        { ...data, orderId },
        makeContext({ order: { id: orderId, delivery_type } }),
      );
    }

    expect(gateway.getFormatDetail).toHaveBeenCalledTimes(fulfillmentTypes.length);
    expect(gateway.getFormatDetail).toHaveBeenCalledWith('dispatch_ticket');
    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(fulfillmentTypes.length);
  });

  it('uses exact decimal comparisons without rounding large settlement amounts', async () => {
    const exact = '9007199254740993.25';

    await service.printFromPos(
      data,
      makeContext({
        order: {
          grand_total: exact,
          total_paid: '9007199254740993',
          remaining_balance: '0',
        },
      }),
    );
    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();

    await service.printFromPos(
      data,
      makeContext({
        order: {
          grand_total: exact,
          total_paid: exact,
          remaining_balance: new Decimal('0').toString(),
        },
      }),
    );

    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(1);
  });

  it('does not print partial payments or credit sales with a remaining balance', async () => {
    const cases = [
      { total_paid: '119.24', remaining_balance: '0' },
      { total_paid: '119.25', remaining_balance: '0.01' },
    ];

    for (const settlement of cases) {
      await service.printFromPos(data, makeContext({ order: settlement }));
    }

    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('fails closed when a settlement amount is absent, non-decimal, non-finite or negative', async () => {
    const invalidValues: unknown[] = [
      undefined,
      null,
      true,
      [],
      {},
      '',
      'NaN',
      'Infinity',
      '0x10',
      '1e2',
      '-1',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
    ];

    for (const field of ['grand_total', 'total_paid', 'remaining_balance'] as const) {
      for (const value of invalidValues) {
        await service.printFromPos(
          data,
          makeContext({ order: { [field]: value } }),
        );
      }
    }

    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('rejects unpaid and cancelled order/payment states even with zero balance', async () => {
    const rejectedOrderStates = [
      'draft',
      'created',
      'pending_payment',
      'cancelled',
      'refunded',
    ];
    const rejectedPaymentStates = [
      'pending',
      'processing',
      'failed',
      'authorized',
      'refunded',
      'cancelled',
      'canceled',
      'partially_refunded',
      'unknown',
    ];

    for (const state of rejectedOrderStates) {
      await service.printFromPos(data, makeContext({ order: { state } }));
      await service.printFromPos(data, makeContext({ order: { status: state } }));
    }
    for (const payment_status of rejectedPaymentStates) {
      await service.printFromPos(data, makeContext({ order: { payment_status } }));
    }

    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('requires a document ID and never treats missing snapshot data as zero', async () => {
    await service.printFromPos(
      { ...data, orderId: '' },
      makeContext({ order: { id: undefined } }),
    );
    await service.printFromPos(
      data,
      makeContext({ order: { grand_total: undefined } }),
    );

    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('requires matching canonical positive order and document IDs for the opt-in path', async () => {
    const invalidIds: Array<number | string> = [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      '0',
      '-1',
      '01',
      '1.0',
      'order-41',
      '9007199254740993',
      ' 41 ',
    ];

    for (const id of invalidIds) {
      await service.printFromPos(data, makeContext({ order: { id } }));
      await service.printFromPos({ ...data, orderId: id }, makeContext());
    }
    await service.printFromPos(
      { ...data, orderId: 42 },
      makeContext({ order: { id: 41 } }),
    );

    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('allows absent payment_status when all settlement amounts prove full payment', async () => {
    await service.printFromPos(
      data,
      makeContext({ order: { payment_status: undefined } }),
    );
    await service.printFromPos(
      { ...data, orderId: 42 },
      makeContext({ order: { id: 42, payment_status: null } }),
    );

    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(2);
  });

  it('does not consult POS receipt settings as a prerequisite', async () => {
    await service.printFromPos(data, makeContext());

    expect(gateway.getFormatDetail).toHaveBeenCalledTimes(1);
    expect(gateway.getFormatDetail).toHaveBeenCalledWith('dispatch_ticket');
    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(1);
  });

  it('reads the master format policy fresh on every decision', async () => {
    detail = makeDetail({ auto_print_after_pos_sale: true });
    await service.printFromPos(
      data,
      makeContext({
        counterEnabled: false,
        order: { delivery_type: 'direct_delivery' },
      }),
    );
    detail = makeDetail({ auto_print_after_pos_sale: false });
    await service.printFromPos(
      { ...data, orderId: 42 },
      makeContext({
        counterEnabled: false,
        order: { id: 42, delivery_type: 'direct_delivery' },
      }),
    );

    expect(gateway.getFormatDetail).toHaveBeenCalledTimes(2);
    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(1);
  });

  it('requires an active format and master auto-print enabled', async () => {
    detail = makeDetail({ is_active: false, auto_print_after_pos_sale: true });
    await service.printFromPos(data, makeContext());
    detail = makeDetail({ auto_print: false, auto_print_after_pos_sale: true });
    await service.printFromPos(data, makeContext());

    expect(gateway.getFormatDetail).toHaveBeenCalledTimes(2);
    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('fails closed on a format lookup error', async () => {
    gateway.getFormatDetail.and.returnValue(throwError(() => new Error('offline')));

    const result = await service.printFromPos(data, makeContext());

    expect(result).toBeNull();
    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('preserves the legacy delivery eligibility when the opt-in is false or absent', async () => {
    for (const [index, auto_print_after_pos_sale] of [false, undefined].entries()) {
      detail = makeDetail({ auto_print_after_pos_sale });
      const orderId = 41 + index;
      await service.printFromPos(
        { ...data, orderId },
        makeContext({
          counterEnabled: false,
          order: {
            id: orderId,
            delivery_type: 'home_delivery',
            total_paid: '0',
            remaining_balance: '119.25',
          },
        }),
      );
    }

    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(2);
  });

  it('preserves the legacy counter switch and does not apply the new settlement gate', async () => {
    detail = makeDetail({ auto_print_after_pos_sale: false });
    await service.printFromPos(
      data,
      makeContext({
        counterEnabled: true,
        order: {
          delivery_type: 'direct_delivery',
          total_paid: '0',
          remaining_balance: '119.25',
        },
      }),
    );

    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(1);
  });

  it('suppresses the confirmation origin when POS settlement auto-print is enabled', async () => {
    const result = await service.printFromPos(
      data,
      makeContext({ origin: 'confirmation' }),
    );

    expect(result).toBeNull();
    expect(gateway.getFormatDetail).toHaveBeenCalledTimes(1);
    expect(documentPrint.printViaGateway).not.toHaveBeenCalled();
  });

  it('deduplicates repeated automatic prints but still allows explicit reprints', async () => {
    await service.printFromPos(data, makeContext());
    const duplicate = await service.printFromPos(data, makeContext());

    expect(duplicate).toBeNull();
    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(1);

    await service.printDispatchTicket(data, 'explicit');
    await service.printDispatchTicket(data, 'explicit');
    expect(documentPrint.printViaGateway).toHaveBeenCalledTimes(3);
  });

  it('serializes explicit reprints through the existing FIFO queue', async () => {
    let releaseFirst: ((value: any) => void) | undefined;
    let calls = 0;
    documentPrint.printViaGateway.and.callFake(() => {
      calls++;
      if (calls === 1) {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve(printResult);
    });

    const first = service.printDispatchTicket(data, 'explicit');
    const second = service.printDispatchTicket({ ...data, orderId: 42 }, 'explicit');
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);

    releaseFirst?.(printResult);
    await Promise.all([first, second]);

    expect(calls).toBe(2);
    expect(documentPrint.printViaGateway.calls.allArgs().map((args) => args[0].documentId))
      .toEqual([41, 42]);
  });
});
