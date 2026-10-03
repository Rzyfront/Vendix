import { UnrecoverableError } from 'bullmq';
import { InvoiceScanProcessor } from './invoice-scan.processor';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEY = 'org/store/purchase-orders/scans/1-f.pdf';
const ATTACHMENT = {
  key: KEY,
  file_name: 'f.pdf',
  file_type: 'application/pdf',
  file_size: 10,
};

function build() {
  const scanner = { scanInvoiceFromBuffer: jest.fn() };
  const s3 = { downloadFile: jest.fn().mockResolvedValue(PNG) };
  const processor = new InvoiceScanProcessor(scanner as any, s3 as any);
  return { processor, scanner, s3 };
}

const job = (over: Record<string, unknown> = {}) =>
  ({
    id: '7',
    data: {
      store_id: 11,
      organization_id: 3,
      user_id: 9,
      request_id: 'req-1',
      scan_attachment_key: KEY,
      scan_attachment: ATTACHMENT,
      order_type: 'ingredient',
      ...over,
    },
  }) as any;

describe('InvoiceScanProcessor', () => {
  it('restaura el contexto con el store_id del job', async () => {
    const { processor, scanner } = build();
    let seen: any;
    scanner.scanInvoiceFromBuffer.mockImplementation(async () => {
      seen = RequestContextService.getContext();
      return { line_items: [] };
    });

    await processor.process(job());

    expect(seen).toEqual(
      expect.objectContaining({
        store_id: 11,
        organization_id: 3,
        user_id: 9,
        request_id: 'req-1',
      }),
    );
  });

  it('descarga por key y pasa el MIME detectado por bytes, orderType y adjunto', async () => {
    const { processor, scanner, s3 } = build();
    const result = { line_items: [], scan_attachment: ATTACHMENT };
    scanner.scanInvoiceFromBuffer.mockResolvedValue(result);

    const res = await processor.process(job());

    expect(s3.downloadFile).toHaveBeenCalledWith(KEY);
    // bytes PNG ganan a la extension .pdf de la key
    expect(scanner.scanInvoiceFromBuffer).toHaveBeenCalledWith(
      PNG,
      'image/png',
      'ingredient',
      ATTACHMENT,
    );
    expect(res).toBe(result);
  });

  it('INV_SCAN_PARSE_FAIL => UnrecoverableError', async () => {
    const { processor, scanner } = build();
    scanner.scanInvoiceFromBuffer.mockRejectedValue(
      new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL),
    );
    const p = processor.process(job());
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toThrow(
      expect.objectContaining({ message: 'INV_SCAN_PARSE_FAIL' }),
    );
  });

  it('INV_SCAN_INCOMPLETE => UnrecoverableError', async () => {
    const { processor, scanner } = build();
    scanner.scanInvoiceFromBuffer.mockRejectedValue(
      new VendixHttpException(ErrorCodes.INV_SCAN_INCOMPLETE),
    );
    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('INV_SCAN_AI_FAIL y errores genericos se relanzan (BullMQ reintenta)', async () => {
    const { processor, scanner } = build();
    scanner.scanInvoiceFromBuffer.mockRejectedValue(
      new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL),
    );
    const p = processor.process(job());
    await expect(p).rejects.toMatchObject({ message: 'INV_SCAN_AI_FAIL' });
    await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);

    const boom = new Error('boom');
    scanner.scanInvoiceFromBuffer.mockRejectedValue(boom);
    await expect(processor.process(job())).rejects.toBe(boom);
  });

  it('fallo de S3 => error comun (reintentable) y no llama al escaner', async () => {
    const { processor, scanner, s3 } = build();
    s3.downloadFile.mockRejectedValue(new Error('s3 down'));
    const p = processor.process(job());
    await expect(p).rejects.toThrow(/No se pudo leer el documento/);
    await expect(p).rejects.not.toBeInstanceOf(UnrecoverableError);
    expect(scanner.scanInvoiceFromBuffer).not.toHaveBeenCalled();
  });
});
