import { WorkflowTemplateSummary } from '../../interfaces/workflow-templates.interfaces';

export const ALL_CATEGORIES = 'all';

const STAGE_TYPE_LABEL: Record<string, string> = {
  form: 'Formulario',
  approval: 'Aprobación',
  review: 'Revisión',
  automatic: 'Automático',
  parallel: 'Paralelo',
  subflow: 'Subflujo',
  wait: 'Espera',
  loop: 'Bucle',
  end: 'Fin',
};

export function stageTypeLabel(type: string): string {
  return STAGE_TYPE_LABEL[type] ?? type;
}

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Templates matching the search text (name, description, category) and the category. */
export function filterTemplates(
  templates: readonly WorkflowTemplateSummary[],
  search: string,
  category: string,
): WorkflowTemplateSummary[] {
  const q = normalize(search.trim());
  return templates.filter((t) => {
    if (category !== ALL_CATEGORIES && t.category !== category) return false;
    if (!q) return true;
    return normalize(`${t.name} ${t.description} ${t.category}`).includes(q);
  });
}

/** Distinct categories in catalog order. */
export function templateCategories(templates: readonly WorkflowTemplateSummary[]): string[] {
  return [...new Set(templates.map((t) => t.category))];
}

/** "1 paso" / "N pasos". */
export function stepsText(count: number): string {
  return count === 1 ? '1 paso' : `${count} pasos`;
}
