import { PurchaseOrdersController } from './purchase-orders.controller';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';

const ATTACHMENT = {
  key: 'acme/tienda-1/purchase-orders/scans/1-f.pdf',
  file_name: 'f.pdf',
  file_type: 'application/pdf',
  file_size: 10,
};

function build() {
  const po = { uploadScanDocument: jest.fn().mockResolvedValue(ATTACHMENT) };
  const scanQueue = { add: jest.fn(), getJob: jest.fn() };
  const controller = new PurchaseOrdersController(
    po as any,
    {} as any,
    new ResponseService(),
    {} as any,
    {} as any,
    scanQueue as any,
  );
  return { controller, po, queue: scanQueue };
}

const inCtx = <T>(store_id: number | undefined, fn: () => Promise<T>) =>
  RequestContextService.run(
    {
      store_id,
      organization_id: 5,
      user_id: 9,
      is_super_admin: false,
      is_owner: false,
      request_id: 'r1',
    } as any,
    fn,
  );

const file = (over: Record<string, unknown> = {}) =>
  ({
    originalname: 'f.pdf',
    mimetype: 'application/pdf',
    size: 10,
    buffer: Buffer.from('%PDF'),
    ...over,
  }) as any;

describe('PurchaseOrdersController — scan/async', () => {
  it('sube a S3, encola y responde job_id con store_id del contexto', async () => {
    const { controller, po, queue } = build();
    queue.add.mockResolvedValue({ id: '51' });

    const res: any = await inCtx(1, () =>
      controller.enqueueInvoiceScan(file(), 'ingredient'),
    );

    expect(res.data).toEqual({ job_id: '51' });
    expect(po.uploadScanDocument).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = queue.add.mock.calls[0];
    expect(name).toBe('scan');
    expect(payload).toEqual({
      store_id: 1,
      organization_id: 5,
      user_id: 9,
      request_id: 'r1',
      scan_attachment_key: ATTACHMENT.key,
      scan_attachment: ATTACHMENT,
      order_type: 'ingredient',
    });
    expect(opts).toEqual(
      expect.objectContaining({
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
  });

  it('orderType ausente => retail', async () => {
    const { controller, queue } = build();
    queue.add.mockResolvedValue({ id: '52' });
    await inCtx(1, () => controller.enqueueInvoiceScan(file()));
    expect(queue.add.mock.calls[0][1].order_type).toBe('retail');
  });

  it('sin archivo => INV_SCAN_NO_FILE', async () => {
    const { controller, queue } = build();
    await expect(
      inCtx(1, () => controller.enqueueInvoiceScan(undefined as any)),
    ).rejects.toMatchObject({ errorCode: 'INV_SCAN_NO_FILE' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('MIME invalido => INV_SCAN_INVALID_FILE', async () => {
    const { controller, queue, po } = build();
    await expect(
      inCtx(1, () =>
        controller.enqueueInvoiceScan(file({ mimetype: 'text/plain' })),
      ),
    ).rejects.toMatchObject({ errorCode: 'INV_SCAN_INVALID_FILE' });
    expect(po.uploadScanDocument).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sin store en contexto => STORE_CONTEXT_001', async () => {
    const { controller, queue } = build();
    await expect(
      inCtx(undefined, () => controller.enqueueInvoiceScan(file())),
    ).rejects.toMatchObject({ errorCode: 'STORE_CONTEXT_001' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('fallo de subida a S3 => UPLOAD_FAILED_001 y no encola', async () => {
    const { controller, queue, po } = build();
    po.uploadScanDocument.mockRejectedValue(new Error('s3 down'));
    await expect(
      inCtx(1, () => controller.enqueueInvoiceScan(file())),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_FAILED_001' });
    po.uploadScanDocument.mockResolvedValue({ ...ATTACHMENT, key: '' });
    await expect(
      inCtx(1, () => controller.enqueueInvoiceScan(file())),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_FAILED_001' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('fallo al encolar => AI_QUEUE_001', async () => {
    const { controller, queue } = build();
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(
      inCtx(1, () => controller.enqueueInvoiceScan(file())),
    ).rejects.toMatchObject({ errorCode: 'AI_QUEUE_001' });
  });

  it('poll de job de otra tienda => AI_QUEUE_002', async () => {
    const { controller, queue } = build();
    queue.getJob.mockResolvedValue({
      data: { store_id: 2 },
      getState: jest.fn(),
      returnvalue: { secret: 1 },
    });
    await expect(
      inCtx(1, () => controller.getInvoiceScanStatus('51')),
    ).rejects.toMatchObject({ errorCode: 'AI_QUEUE_002' });
  });

  it('poll de job inexistente => AI_QUEUE_002', async () => {
    const { controller, queue } = build();
    queue.getJob.mockResolvedValue(undefined);
    await expect(
      inCtx(1, () => controller.getInvoiceScanStatus('99')),
    ).rejects.toMatchObject({ errorCode: 'AI_QUEUE_002' });
  });

  it('poll de job propio devuelve {status, result, error} sin envelope', async () => {
    const { controller, queue } = build();
    queue.getJob.mockResolvedValue({
      data: { store_id: 1 },
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: { line_items: [] },
      failedReason: undefined,
    });
    const res = await inCtx(1, () => controller.getInvoiceScanStatus('51'));
    expect(res).toEqual({
      status: 'completed',
      result: { line_items: [] },
      error: undefined,
    });
  });
});
