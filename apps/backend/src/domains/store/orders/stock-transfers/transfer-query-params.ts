import { BadRequestException } from '@nestjs/common';

/**
 * Lectura de ids que llegan como texto en la URL de las lecturas de apoyo de
 * la orden avanzada (P3), compartida por tienda y organización.
 */
export function parseOptionalId(value?: string | null): number | null {
  if (value == null || String(value).trim() === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`Id no válido: ${value}`);
  }
  return id;
}

export function parseRequiredId(
  value: string | null | undefined,
  field: string,
): number {
  const id = parseOptionalId(value);
  if (id == null) {
    throw new BadRequestException(`Falta ${field}`);
  }
  return id;
}

/** `"1,2,3"` → `[1, 2, 3]`; ignora vacíos y valores no numéricos. */
export function parseIdList(value?: string | null): number[] {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}
