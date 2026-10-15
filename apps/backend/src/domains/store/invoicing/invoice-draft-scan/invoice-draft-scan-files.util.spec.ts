import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  assertInvoiceDraftScanFiles,
  enqueueInvoiceDraftScan,
} from './invoice-draft-scan-files.util';
import { MAX_INVOICE_DRAFT_SCAN_FILES } from './invoice-draft-scan.types';

const file = (mimetype: string, originalname = 'doc'): Express.Multer.File =>
  ({ mimetype, originalname, buffer: Buffer.from('x'), size: 1 }) as Express.Multer.File;

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof VendixHttpException ? err.errorCode : 'OTHER';
  }
  return undefined;
};

describe('assertInvoiceDraftScanFiles', () => {
  it('accepts a mixed batch of PDFs and images', () => {
    const files = [file('application/pdf'), file('image/jpeg'), file('image/png'), file('image/webp')];
    expect(assertInvoiceDraftScanFiles(files)).toBe(files);
  });

  it('rejects an empty batch', () => {
    expect(codeOf(() => assertInvoiceDraftScanFiles(undefined))).toBe(
      ErrorCodes.INVOICE_DRAFT_SCAN_NO_FILES.code,
    );
    expect(codeOf(() => assertInvoiceDraftScanFiles([]))).toBe(
      ErrorCodes.INVOICE_DRAFT_SCAN_NO_FILES.code,
    );
  });

  it('rejects more files than the cap', () => {
    const files = Array.from({ length: MAX_INVOICE_DRAFT_SCAN_FILES + 1 }, () =>
      file('image/png'),
    );
    expect(codeOf(() => assertInvoiceDraftScanFiles(files))).toBe(
      ErrorCodes.INVOICE_DRAFT_SCAN_TOO_MANY_FILES.code,
    );
  });

  it('rejects Word and Excel', () => {
    for (const mime of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
    ]) {
      expect(codeOf(() => assertInvoiceDraftScanFiles([file('application/pdf'), file(mime)]))).toBe(
        ErrorCodes.INVOICE_DRAFT_SCAN_UNSUPPORTED_TYPE.code,
      );
    }
  });
});

describe('enqueueInvoiceDraftScan', () => {
  const deps = () => ({
    scanner: { assertReady: jest.fn().mockResolvedValue(undefined) },
    aiScanJobs: { enqueue: jest.fn().mockResolvedValue({ job_id: '42' }) },
  });

  it('store: valida, confirma la app IA y encola { note } (payload intacto)', async () => {
    const d = deps();
    const files = [file('application/pdf')];
    await expect(enqueueInvoiceDraftScan(d, files, '  50 % anticipo  ')).resolves.toEqual({
      job_id: '42',
    });
    expect(d.scanner.assertReady).toHaveBeenCalled();
    expect(d.aiScanJobs.enqueue).toHaveBeenCalledWith('invoice_draft', files, {
      note: '50 % anticipo',
    });
  });

  it('platform: mismo kind con params.context = platform', async () => {
    const d = deps();
    const files = [file('image/png')];
    await enqueueInvoiceDraftScan(d, files, '', 'platform');
    expect(d.aiScanJobs.enqueue).toHaveBeenCalledWith('invoice_draft', files, {
      note: null,
      context: 'platform',
    });
  });

  it('un lote inválido no llega a la IA ni a la cola', async () => {
    const d = deps();
    await expect(
      enqueueInvoiceDraftScan(d, [file('application/msword')], null, 'platform'),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.INVOICE_DRAFT_SCAN_UNSUPPORTED_TYPE.code });
    expect(d.scanner.assertReady).not.toHaveBeenCalled();
    expect(d.aiScanJobs.enqueue).not.toHaveBeenCalled();
  });
});
