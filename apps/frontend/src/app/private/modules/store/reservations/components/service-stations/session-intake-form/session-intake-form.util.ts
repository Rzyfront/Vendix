import type {
  IntakeTemplate,
  IntakeTemplateItem,
  IntakeTemplateSection,
  IntakeValue,
} from '../service-stations.service';

/** Flat section of the intake form (tabs and sub-sections flattened in order). */
export interface IntakeSectionView {
  key: string;
  title: string;
  description?: string | null;
  items: IntakeTemplateItem[];
}

/** One answer ready for `intake_values`. */
export interface IntakeValueEntry {
  field_id: number;
  value: IntakeValue;
}

const bySort = <T extends { sort_order?: number }>(list: T[] | undefined): T[] =>
  [...(list ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

/** Sections of the template, flattened in order (tabs -> sections -> sub-sections). */
export function flattenIntakeSections(template: IntakeTemplate | null): IntakeSectionView[] {
  if (!template) return [];
  const roots: IntakeTemplateSection[] = template.tabs?.length
    ? bySort(template.tabs).flatMap((tab) => bySort(tab.sections))
    : bySort(template.sections);
  const out: IntakeSectionView[] = [];
  const push = (section: IntakeTemplateSection) => {
    const items = bySort(section.items).filter((item) => !!item.metadata_field);
    if (items.length) {
      out.push({ key: `s${section.id}`, title: section.title, description: section.description, items });
    }
    for (const child of bySort(section.child_sections)) push(child);
  };
  for (const root of roots) push(root);
  return out;
}

/** Every item of the sections, once per metadata field, in order. */
export function uniqueIntakeItems(sections: IntakeSectionView[]): IntakeTemplateItem[] {
  const seen = new Set<number>();
  const items: IntakeTemplateItem[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      if (seen.has(item.metadata_field.id)) continue;
      seen.add(item.metadata_field.id);
      items.push(item);
    }
  }
  return items;
}

/** Same as the server: the item's "required" flag in the template decides. */
export function isIntakeItemRequired(item: IntakeTemplateItem): boolean {
  return !!item.is_required;
}

export function normalizeIntakeValue(fieldType: string, raw: unknown): IntakeValue | undefined {
  if (fieldType === 'checkbox') return raw === true || raw === 'true';
  if (raw === undefined || raw === null) return undefined;
  if (fieldType === 'number') {
    if (raw === '') return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }
  const text = String(raw).trim();
  return text ? text : undefined;
}

/** Answers ready for `intake_values` (empty ones are omitted). */
export function buildIntakeEntries(
  items: IntakeTemplateItem[],
  values: Record<number, unknown>,
): IntakeValueEntry[] {
  const out: IntakeValueEntry[] = [];
  for (const item of items) {
    const field = item.metadata_field;
    const value = normalizeIntakeValue(field.field_type, values[field.id]);
    if (value === undefined) continue;
    out.push({ field_id: field.id, value });
  }
  return out;
}

/** Required items without an answer (a required checkbox must be checked). */
export function missingRequiredIntakeItems(
  items: IntakeTemplateItem[],
  values: Record<number, unknown>,
): IntakeTemplateItem[] {
  return items.filter((item) => {
    if (!isIntakeItemRequired(item)) return false;
    const field = item.metadata_field;
    if (field.field_type === 'checkbox') return values[field.id] !== true;
    return normalizeIntakeValue(field.field_type, values[field.id]) === undefined;
  });
}
