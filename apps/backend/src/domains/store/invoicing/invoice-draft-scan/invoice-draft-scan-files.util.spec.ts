import { ErrorCodes, VendixHttpException } from '@common/errors';
import { assertInvoiceDraftScanFiles } from './invoice-draft-scan-files.util';
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
