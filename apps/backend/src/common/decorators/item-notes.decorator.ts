import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Largo maximo de la nota por item (carrito, checkout, orden, KDS). */
export const ITEM_NOTES_MAX_LENGTH = 200;

/**
 * Nota libre por item: opcional, string de max 200, con trim y `''` -> `null`.
 * `null` es valido (borra la nota); `undefined` (clave ausente) no toca nada.
 */
export function ItemNotes() {
  return applyDecorators(
    Transform(({ value }) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }),
    IsOptional(),
    IsString(),
    MaxLength(ITEM_NOTES_MAX_LENGTH),
  );
}
