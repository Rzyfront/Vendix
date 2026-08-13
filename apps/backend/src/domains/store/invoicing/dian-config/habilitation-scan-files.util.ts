import { ErrorCodes, VendixHttpException } from '@common/errors';
import { MAX_HABILITATION_SCAN_FILES } from './dian-habilitation-scanner.service';

/** Accepted by the scanner; anything else is rejected before touching the AI. */
const SCAN_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

/**
 * Validates the uploaded batch before it reaches the vision model.
 *
 * Lives here and not inline in each controller because the store and the
 * organization namespaces expose the same scanner: a rule that only one of
 * them applies is a rule the other silently skips.
 *
 * `FilesInterceptor` already caps the array at {@link MAX_HABILITATION_SCAN_FILES},
 * dropping the extras without a word. The explicit count check turns that
 * silent truncation into an error the user can act on.
 */
export function assertScannableFiles(
  files: Express.Multer.File[] | undefined,
): Express.Multer.File[] {
  if (!files?.length) {
    throw new VendixHttpException(ErrorCodes.HABILITATION_SCAN_NO_FILE);
  }
  if (files.length > MAX_HABILITATION_SCAN_FILES) {
    throw new VendixHttpException(ErrorCodes.HABILITATION_SCAN_TOO_MANY_FILES);
  }
  for (const file of files) {
    if (!SCAN_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new VendixHttpException(ErrorCodes.HABILITATION_SCAN_INVALID_FILE);
    }
  }
  return files;
}
