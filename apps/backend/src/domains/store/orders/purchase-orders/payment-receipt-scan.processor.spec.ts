import { UnrecoverableError } from 'bullmq';
import { PaymentReceiptScanProcessor } from './payment-receipt-scan.processor';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';

function build() {
  const scanner = { scanPaymentFromImage: jest.fn() };
  const monitor = {
    runAiWork: jest.fn((_job: unknown, _source: unknown, work: () => unknown) =>
      work(),
    ),
    onFailed: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new PaymentReceiptScanProcessor(
    scanner as any,
    monitor as any,
  );
  return { processor, scanner, monitor };
}

const job = () =>
  ({
    id: '5',
    data: {
      dataUri: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      context: { store_id: 11, organization_id: 3, user_id: 9, request_id: 'r1' },
    },
  }) as any;

describe('PaymentReceiptScanProcessor', () => {
  it('restaura el contexto y devuelve el resultado envuelto en runAiWork', async () => {
    const { processor, scanner, monitor } = build();
    let seen: any;
    const result = { amount: 10 };
    scanner.scanPaymentFromImage.mockImplementation(async () => {
      seen = RequestContextService.getContext();
      return result;
    });
    const j = job();

    const res = await processor.process(j);

    expect(res).toBe(result);
    expect(seen).toEqual(expect.objectContaining({ store_id: 11, request_id: 'r1' }));
    expect(scanner.scanPaymentFromImage).toHaveBeenCalledWith(
      'data:image/png;base64,AAAA',
      'image/png',
    );
    expect(monitor.runAiWork).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.paymentReceiptScan,
      expect.any(Function),
    );
  });

  it('un error 4xx deja el CODIGO como failedReason y no se reintenta', async () => {
    const { processor, scanner } = build();
    scanner.scanPaymentFromImage.mockRejectedValue(
      new VendixHttpException(ErrorCodes.INV_SCAN_INVALID_FILE),
    );
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toMatchObject({ message: 'INV_SCAN_INVALID_FILE' });
  });

  it.each(['INV_SCAN_AI_FAIL', 'INV_SCAN_PARSE_FAIL'])(
    'un fallo de lectura/parseo del modelo se reintenta (Error plano con el código): %s',
    async (code) => {
      const { processor, scanner } = build();
      scanner.scanPaymentFromImage.mockRejectedValue(
        new VendixHttpException(
          ErrorCodes[code as keyof typeof ErrorCodes] as any,
        ),
      );
      const p = processor.process(job());
      await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
      await expect(p).rejects.toMatchObject({ message: code });
    },
  );

  it('un error cualquiera se relanza tal cual (BullMQ reintenta)', async () => {
    const { processor, scanner } = build();
    const boom = new Error('boom');
    scanner.scanPaymentFromImage.mockRejectedValue(boom);
    await expect(processor.process(job())).rejects.toBe(boom);
  });

  it('onFailed delega en el monitor con el context del job', async () => {
    const { processor, monitor } = build();
    const j = job();
    await processor.onFailed(j);
    expect(monitor.onFailed).toHaveBeenCalledWith(
      j,
      LEGACY_AI_SOURCES.paymentReceiptScan,
      j.data.context,
    );
    await processor.onFailed(undefined);
    expect(monitor.onFailed).toHaveBeenCalledTimes(1);
  });
});
