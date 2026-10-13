import { UnrecoverableError } from 'bullmq';
import { PurchaseOrderReceiveProcessor } from './purchase-order-receive.processor';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, quantity_received: 1 }));

function build() {
  const po = { receive: jest.fn().mockResolvedValue({ status: 'partial' }) };
  const processor = new PurchaseOrderReceiveProcessor(po as any);
  return { processor, po };
}

const job = (n: number, over: Record<string, unknown> = {}) => {
  const j: any = {
    id: '9',
    data: {
      store_id: 11,
      organization_id: 3,
      user_id: 7,
      request_id: 'r',
      purchase_order_id: 42,
      items: lines(n),
      notes: 'nota',
      supplier_invoice_number: 'FV-1',
      total_lines: n,
      batches_total: Math.ceil(n / 100),
      ...over,
    },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
  return j;
};

describe('PurchaseOrderReceiveProcessor', () => {
  it('250 líneas => 3 receive() de 100/100/50 con progreso por lote', async () => {
    const { processor, po } = build();
    po.receive
      .mockResolvedValueOnce({ status: 'partial' })
      .mockResolvedValueOnce({ status: 'partial' })
      .mockResolvedValueOnce({ status: 'received' });
    const j = job(250);

    const res = await processor.process(j);

    expect(po.receive).toHaveBeenCalledTimes(3);
    expect(po.receive.mock.calls.map((c) => c[1].items.length)).toEqual([
      100, 100, 50,
    ]);
    expect(po.receive.mock.calls[0][0]).toBe(42);
    expect(po.receive.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        notes: 'nota',
        supplier_invoice_number: 'FV-1',
      }),
    );
    expect(j.updateProgress.mock.calls.map((c: any[]) => c[0])).toEqual([
      { processed_lines: 100, total_lines: 250, batches_done: 1, batches_total: 3 },
      { processed_lines: 200, total_lines: 250, batches_done: 2, batches_total: 3 },
      { processed_lines: 250, total_lines: 250, batches_done: 3, batches_total: 3 },
    ]);
    expect(res).toEqual({ purchase_order_id: 42, status: 'received' });
  });

  it('restaura el contexto de la tienda del job en cada receive()', async () => {
    const { processor, po } = build();
    const seen: any[] = [];
    po.receive.mockImplementation(async () => {
      seen.push(RequestContextService.getContext());
      return { status: 'received' };
    });
    await processor.process(job(5));
    expect(seen[0]).toEqual(
      expect.objectContaining({ store_id: 11, organization_id: 3, user_id: 7 }),
    );
  });

  it('el lote 2 falla => failed con batch_index=1, failed_at_line=100 y el lote 1 no se revierte', async () => {
    const { processor, po } = build();
    const failure = new VendixHttpException(ErrorCodes.AI_QUEUE_001);
    po.receive
      .mockResolvedValueOnce({ status: 'partial' })
      .mockRejectedValueOnce(failure);
    const j = job(250);

    const err: any = await processor.process(j).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(JSON.parse(err.message)).toEqual({
      message: failure.message,
      batch_index: 1,
      failed_at_line: 100,
    });
    // Lote 3 jamás se intenta y el progreso del lote 1 quedó registrado.
    expect(po.receive).toHaveBeenCalledTimes(2);
    expect(j.updateProgress).toHaveBeenCalledTimes(1);
    expect(j.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ batches_done: 1, processed_lines: 100 }),
    );
  });

  it('exactamente 100 líneas => un solo lote', async () => {
    const { processor, po } = build();
    await processor.process(job(100));
    expect(po.receive).toHaveBeenCalledTimes(1);
  });
});
