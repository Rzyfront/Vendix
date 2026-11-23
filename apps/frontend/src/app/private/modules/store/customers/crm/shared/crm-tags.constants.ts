import type { SelectorOption } from '../../../../../../shared/components';
import { CrmTag } from './crm.interface';

/**
 * Grupos del catálogo de etiquetas del CRM (lote 2 de etiquetas).
 *
 * Espejo de `CRM_TAG_GROUPS` del backend
 * (`apps/backend/.../crm/tags/crm-tags.constants.ts`): el orden de esta lista es
 * el orden en que se agrupan y se ordenan las etiquetas en el gestor y en el
 * selector del cliente. Las etiquetas sin grupo van al final.
 */
export const CRM_TAG_GROUPS: readonly string[] = [
  'Temperatura',
  'Prioridad',
  'Tipo',
  'Necesidad',
  'Uso',
  'Pago',
  'Valor',
];

/** Value of the «Sin grupo» option: the API receives `null`. */
export const CRM_TAG_NO_GROUP = '';

/** Options of the group select: the seven groups plus «Sin grupo» first. */
export const CRM_TAG_GROUP_OPTIONS: SelectorOption[] = [
  { value: CRM_TAG_NO_GROUP, label: 'Sin grupo' },
  ...CRM_TAG_GROUPS.map((group) => ({ value: group, label: group })),
];

/** Heading of a group in the manager; `null` is the catch-all bucket. */
export function crmTagGroupLabel(group: string | null | undefined): string {
  return group?.trim() || 'Sin grupo';
}

/**
 * Sort rank: the seven groups in sheet order, then any unexpected group
 * (older data or a group made free later), then the tags without a group.
 */
function groupRank(group: string | null | undefined): number {
  const value = group?.trim();
  if (!value) return CRM_TAG_GROUPS.length + 1;
  const index = CRM_TAG_GROUPS.indexOf(value);
  return index === -1 ? CRM_TAG_GROUPS.length : index;
}

/** Catalog order everywhere in the UI: by group, then by name. */
export function compareCrmTags(a: CrmTag, b: CrmTag): number {
  const byGroup = groupRank(a.group_name) - groupRank(b.group_name);
  if (byGroup !== 0) return byGroup;
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
}
