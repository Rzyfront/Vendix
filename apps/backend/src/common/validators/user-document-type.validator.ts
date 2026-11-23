import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import {
  DOCUMENT_TYPE_CODES,
  DOCUMENT_TYPE_INVALID_MESSAGE,
  normalizeDocumentType,
} from '../constants/document-types';

/**
 * Optional `document_type` for user writes (`identification_type_enum`).
 * Accepts any casing/whitespace (`"cc"`, `" Cc "` → `"CC"`), maps empty
 * strings to `null` so the field can be cleared, and rejects unknown codes
 * with a clear Spanish message instead of a raw Prisma enum error.
 */
export function IsUserDocumentType(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => normalizeDocumentType(value)),
    IsOptional(),
    IsIn(DOCUMENT_TYPE_CODES as unknown as string[], {
      message: DOCUMENT_TYPE_INVALID_MESSAGE,
    }),
  );
}
