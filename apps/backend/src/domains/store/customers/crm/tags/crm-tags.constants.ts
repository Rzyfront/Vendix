/**
 * Grupos del catálogo de etiquetas del CRM (lote 2 de etiquetas).
 *
 * El grupo es el eje con el que se ordena y se agrupa el catálogo: primero por
 * grupo en este orden y luego por nombre; las etiquetas sin grupo van al final.
 *
 * Es una LISTA CERRADA a propósito. Si Rafael decide que el grupo debe ser
 * libre (escribir cualquier texto), el único cambio de backend es borrar
 * `@IsIn(CRM_TAG_GROUPS)` de `CreateCrmTagDto` y `UpdateCrmTagDto` en
 * `profile/dto/customer-crm.dto.ts`: la columna ya es texto y el servicio no
 * valida nada más. El frontend quedaría con un selector, pero aceptaría texto
 * nuevo sin tocar nada.
 */
export const CRM_TAG_GROUPS = [
  'Temperatura',
  'Prioridad',
  'Tipo',
  'Necesidad',
  'Uso',
  'Pago',
  'Valor',
] as const;

export type CrmTagGroup = (typeof CRM_TAG_GROUPS)[number];
