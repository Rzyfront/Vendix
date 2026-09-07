import { TransformFnParams } from 'class-transformer';

/**
 * NORMALIZACIÓN DEL NOMBRE — un único lugar, a propósito.
 *
 * El nombre es único por tienda, y quien lo hace cumplir es el índice
 * `quotation_profiles_unique_name_per_store` sobre `(store_id, lower(name))`.
 * Ese índice compara `lower()` pero **no** normaliza espacios: `"Obra  norte"`
 * y `"Obra norte"` son claves distintas para Postgres y el mismo nombre para
 * la persona que lo lee en un desplegable.
 *
 * Recorta los extremos y colapsa cualquier corrida de espacios en blanco a
 * un solo espacio. No toca la caja: la comparación insensible la hace el
 * índice.
 */
export const normalizeQuotationProfileName = ({
  value,
}: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/**
 * La misma normalización, para el servicio: la comprobación previa de
 * duplicado tiene que aplicar exactamente el mismo criterio que el índice
 * acabará aceptando o rechazando.
 */
export const normalizeQuotationName = (value: string): string =>
  value.trim().replace(/\s+/g, ' ');
