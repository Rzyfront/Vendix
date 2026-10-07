import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';

const PREFIX = 'acme/tienda-1/purchase-orders/scans';

function build() {
  const po = { getScanStoragePrefix: jest.fn().mockResolvedValue(PREFIX) };
  const queue = { add: jest.fn(), getJob: jest.fn() };
  const controller = new PurchaseOrdersController(
    po as any,
    {} as any,
    new ResponseService(),
    {} as any,
    queue as any,
    {} as any,
  );
  return { controller, queue };
}

const inCtx = <T>(store_id: number, fn: () => Promise<T>) =>
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

const dto = (over: Record<string, unknown> = {}) =>
  ({
    scan_attachment_key: `${PREFIX}/1-f.pdf`,
    consolidated: { supplier: { name: 'A' }, line_items: [] },
    note: 'n',
    ...over,
  }) as any;

describe('PurchaseOrdersController — scan/revalidate', () => {
  it('key de otra tienda => 400 y no encola', async () => {
    const { controller, queue } = build();
    await expect(
      inCtx(1, () =>
        controller.enqueueInvoiceRevalidate(
          dto({ scan_attachment_key: 'otra/tienda-2/purchase-orders/scans/x.pdf' }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      inCtx(1, () =>
        controller.enqueueInvoiceRevalidate(
          dto({ scan_attachment_key: `${PREFIX}/../otra/x.pdf` }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('nombre con puntos seguidos (captura macOS «a.m..png») sí encola', async () => {
    const { controller, queue } = build();
    queue.add.mockResolvedValue({ id: '43' });
    const key = `${PREFIX}/1790744718377-Captura_12.05.14___a.m..png`;
    const res: any = await inCtx(1, () =>
      controller.enqueueInvoiceRevalidate(dto({ scan_attachment_key: key })),
    );
    expect(res.data).toEqual({ job_id: '43' });
    expect(queue.add.mock.calls[0][1]).toEqual(
      expect.objectContaining({ scan_attachment_key: key }),
    );
  });

  it('consolidated > 200 KB => 400', async () => {
    const { controller, queue } = build();
    await expect(
      inCtx(1, () =>
        controller.enqueueInvoiceRevalidate(
          dto({ consolidated: { blob: 'x'.repeat(201 * 1024) } }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('encola y responde job_id', async () => {
    const { controller, queue } = build();
    queue.add.mockResolvedValue({ id: '42' });
    const res: any = await inCtx(1, () =>
      controller.enqueueInvoiceRevalidate(dto({ order_type: 'ingredient' })),
    );
    expect(res.data).toEqual({ job_id: '42' });
    const [name, payload] = queue.add.mock.calls[0];
    expect(name).toBe('revalidate');
    expect(payload).toEqual(
      expect.objectContaining({
        store_id: 1,
        organization_id: 5,
        user_id: 9,
        scan_attachment_key: `${PREFIX}/1-f.pdf`,
        order_type: 'ingredient',
        note: 'n',
      }),
    );
  });

  it('poll de job ajeno o inexistente => AI_QUEUE_002', async () => {
    const { controller, queue } = build();
    queue.getJob.mockResolvedValue({
      data: { store_id: 2 },
      getState: jest.fn(),
      returnvalue: { secret: 1 },
    });
    await expect(
      inCtx(1, () => controller.getInvoiceRevalidateStatus('42')),
    ).rejects.toMatchObject({ errorCode: 'AI_QUEUE_002' });
    queue.getJob.mockResolvedValue(undefined);
    await expect(
      inCtx(1, () => controller.getInvoiceRevalidateStatus('43')),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('poll de job propio devuelve estado y result', async () => {
    const { controller, queue } = build();
    queue.getJob.mockResolvedValue({
      data: { store_id: 1 },
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: { consolidated: {}, report: {} },
      failedReason: undefined,
    });
    const res = await inCtx(1, () => controller.getInvoiceRevalidateStatus('42'));
    expect(res).toEqual({
      status: 'completed',
      result: { consolidated: {}, report: {} },
      error: undefined,
    });
  });
});
