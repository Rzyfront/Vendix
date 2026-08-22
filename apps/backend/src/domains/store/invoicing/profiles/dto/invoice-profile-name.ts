import { TransformFnParams } from 'class-transformer';

/**
 * NORMALIZACIÓN DEL NOMBRE — un único lugar, a propósito.
 *
 * El nombre es único por tienda, y quien lo hace cumplir es el índice
 * `invoice_profiles_unique_name_per_store` sobre `(store_id, lower(name))`. Ese
 * índice compara `lower()` pero **no** normaliza espacios: `"AIU  obras"` y
 * `"AIU obras"` son claves distintas para Postgres y el mismo nombre para la
 * persona que lo lee en un desplegable.
 *
 * Es decir: sin colapsar los espacios, la unicidad es evadible escribiendo dos
 * espacios. Y si sólo una de las tres puertas de escritura normalizara —crear,
 * editar, clonar— el hueco quedaría abierto por la que no. De ahí que esto viva
 * acá y no repetido en cada DTO, que es como estaba: tres copias de `trimmed`
 * que había que recordar cambiar a la vez.
 *
 * Recorta los extremos y colapsa cualquier corrida de espacios en blanco
 * —incluidos tabuladores y saltos de línea, que un pegado desde Excel trae— a
 * un solo espacio. No toca la caja: el usuario ve su nombre como lo escribió, y
 * la comparación insensible a mayúsculas la hace el índice.
 */
export const normalizeProfileName = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/**
 * La misma normalización, para el servicio.
 *
 * El DTO ya normalizó lo que llega por HTTP, pero el servicio también compara
 * nombres contra la base (la comprobación previa de duplicado) y ahí necesita
 * aplicar exactamente el mismo criterio. Dos criterios distintos darían un
 * mensaje que no coincide con lo que el índice acabará aceptando o rechazando.
 */
export const normalizeName = (value: string): string =>
  value.trim().replace(/\s+/g, ' ');
