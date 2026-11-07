import {
  WORKFLOW_KEY_PATTERN,
  WorkflowConditionGroup,
  WorkflowConditionNode,
  WorkflowConditionOp,
  WorkflowConditionRule,
  WorkflowDefinitionV1,
  WorkflowFieldDef,
  WorkflowFieldType,
  WorkflowStageDef,
  WorkflowStageType,
} from '../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowIssueView } from '../interfaces/workflow.interfaces';

export type EditorTab =
  | 'general'
  | 'assignee'
  | 'form'
  | 'requirements'
  | 'transitions'
  | 'due'
  | 'actions';

export const EDITOR_TABS: { id: EditorTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'assignee', label: 'Responsable', icon: 'user' },
  { id: 'form', label: 'Formulario', icon: 'file-text' },
  { id: 'requirements', label: 'Requisitos', icon: 'paperclip' },
  { id: 'transitions', label: 'Transiciones', icon: 'git-branch' },
  { id: 'due', label: 'Plazos', icon: 'clock' },
  { id: 'actions', label: 'Acciones', icon: 'zap' },
];

export const STAGE_TYPE_LABEL: Record<WorkflowStageType, string> = {
  form: 'Formulario',
  approval: 'Aprobación',
  review: 'Revisión',
  automatic: 'Automática',
  end: 'Fin',
};

export const STAGE_TYPE_ICON: Record<WorkflowStageType, string> = {
  form: 'file-text',
  approval: 'check-circle',
  review: 'eye',
  automatic: 'zap',
  end: 'flag',
};

const OUTCOME_TEXT: Record<string, string> = {
  submit: 'Enviar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  return: 'Devolver',
  auto: 'Automática',
};

export function outcomeText(outcome: string): string {
  return OUTCOME_TEXT[outcome] ?? outcome;
}

export const END_OUTCOME_LABEL: Record<string, string> = {
  completed: 'Completada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
};

export const FIELD_TYPE_TEXT: Record<WorkflowFieldType, string> = {
  text: 'Texto corto',
  textarea: 'Texto largo',
  number: 'Número',
  money: 'Dinero',
  date: 'Fecha',
  boolean: 'Sí / no',
  select: 'Lista de opciones',
  multiselect: 'Selección múltiple',
  email: 'Correo electrónico',
  phone: 'Teléfono',
  file: 'Archivo',
  user: 'Persona del equipo',
};

export const OP_TEXT: Record<WorkflowConditionOp, string> = {
  eq: 'es igual a',
  neq: 'es distinto de',
  gt: 'es mayor que',
  gte: 'es mayor o igual que',
  lt: 'es menor que',
  lte: 'es menor o igual que',
  in: 'es uno de',
  not_in: 'no es uno de',
  contains: 'contiene',
  is_empty: 'está vacío',
  is_not_empty: 'no está vacío',
  is_true: 'es sí',
  is_false: 'es no',
};

/** Lowercase ASCII slug that satisfies WORKFLOW_KEY_PATTERN, unique among `taken`. */
export function uniqueKey(
  base: string,
  taken: Iterable<string>,
  fallback = 'item',
): string {
  const used = new Set(taken);
  let slug = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  if (!slug || !/^[a-z]/.test(slug)) slug = `${fallback}_${slug}`.replace(/_$/, '');
  if (!WORKFLOW_KEY_PATTERN.test(slug)) slug = fallback;
  if (!used.has(slug)) return slug;
  let n = 2;
  while (used.has(`${slug}_${n}`)) n++;
  return `${slug}_${n}`;
}

function isGroup(node: WorkflowConditionNode): node is WorkflowConditionGroup {
  return 'all' in node || 'any' in node;
}

export function groupMode(group: WorkflowConditionGroup): 'all' | 'any' {
  return 'all' in group ? 'all' : 'any';
}

export function groupChildren(group: WorkflowConditionGroup): WorkflowConditionNode[] {
  return 'all' in group ? group.all : group.any;
}

function valueText(
  field: WorkflowFieldDef | undefined,
  value: WorkflowConditionRule['value'],
): string {
  const one = (v: string | number): string => {
    if (typeof v === 'number' && (field?.type === 'number' || field?.type === 'money')) {
      return v.toLocaleString('es-CO');
    }
    const option = field?.options?.find((o) => o.value === String(v));
    return option ? option.label : String(v);
  };
  if (Array.isArray(value)) return value.map(one).join(', ');
  if (value === undefined || value === null) return '…';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  return one(value);
}

/** "Monto es mayor que 2.000.000 y Área es igual a Compras". */
export function describeCondition(
  node: WorkflowConditionNode | undefined,
  fields: WorkflowFieldDef[],
  nested = false,
): string {
  if (!node) return '';
  if (isGroup(node)) {
    const children = groupChildren(node)
      .map((child) => describeCondition(child, fields, true))
      .filter((text) => text.length > 0);
    if (children.length === 0) return '';
    const text = children.join(groupMode(node) === 'all' ? ' y ' : ' o ');
    return nested && children.length > 1 ? `(${text})` : text;
  }
  const field = fields.find((f) => f.key === node.field);
  const label = field?.label ?? node.field;
  const op = OP_TEXT[node.op] ?? node.op;
  const needsValue = !['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(node.op);
  return needsValue ? `${label} ${op} ${valueText(field, node.value)}` : `${label} ${op}`;
}

// ─── Route map layout ────────────────────────────────────────────────

export const NODE_W = 176;
export const NODE_H = 56;
const COL_GAP = 88;
const ROW_GAP = 40;
const PAD = 24;

export interface MapNode {
  key: string;
  name: string;
  type: WorkflowStageType;
  start: boolean;
  unreachable: boolean;
  x: number;
  y: number;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  path: string;
  labelX: number;
  labelY: number;
  label: string;
  conditional: boolean;
  text: string;
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  width: number;
  height: number;
}

export function computeLayout(def: WorkflowDefinitionV1): MapLayout {
  const stages = def.stages;
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const level = new Map<string, number>();
  const start = stages.find((s) => s.start === true) ?? stages[0];
  if (start) {
    level.set(start.key, 0);
    const queue = [start.key];
    while (queue.length > 0) {
      const key = queue.shift() as string;
      const depth = level.get(key) as number;
      for (const t of byKey.get(key)?.transitions ?? []) {
        if (byKey.has(t.to) && !level.has(t.to)) {
          level.set(t.to, depth + 1);
          queue.push(t.to);
        }
      }
    }
  }
  const maxLevel = Math.max(-1, ...level.values());
  const unreachableLevel = maxLevel + 1;
  const columns = new Map<number, WorkflowStageDef[]>();
  for (const s of stages) {
    const l = level.get(s.key) ?? unreachableLevel;
    columns.set(l, [...(columns.get(l) ?? []), s]);
  }
  const nodes: MapNode[] = [];
  const pos = new Map<string, MapNode>();
  let maxRows = 1;
  const orderedLevels = [...columns.keys()].sort((a, b) => a - b);
  orderedLevels.forEach((l, col) => {
    const list = columns.get(l) ?? [];
    maxRows = Math.max(maxRows, list.length);
    list.forEach((s, row) => {
      const node: MapNode = {
        key: s.key,
        name: s.name,
        type: s.type,
        start: s.start === true,
        unreachable: !level.has(s.key),
        x: PAD + col * (NODE_W + COL_GAP),
        y: PAD + 16 + row * (NODE_H + ROW_GAP),
      };
      nodes.push(node);
      pos.set(s.key, node);
    });
  });
  const edges: MapEdge[] = [];
  for (const s of stages) {
    const from = pos.get(s.key);
    (s.transitions ?? []).forEach((t, index) => {
      const to = pos.get(t.to);
      if (!from || !to) return;
      const when = t.when ? describeCondition(t.when, def.fields) : '';
      const label = when ? `${outcomeText(t.on)} · Si ${when}` : outcomeText(t.on);
      edges.push({
        id: `${s.key}:${index}`,
        from: s.key,
        to: t.to,
        ...edgeGeometry(from, to, index),
        label,
        conditional: !!t.when,
        text: `${s.name} → ${to.name}: ${label}`,
      });
    });
  }
  return {
    nodes,
    edges,
    width: PAD * 2 + orderedLevels.length * NODE_W + Math.max(0, orderedLevels.length - 1) * COL_GAP,
    height: PAD * 2 + 16 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP + 24,
  };
}

function edgeGeometry(
  from: MapNode,
  to: MapNode,
  index: number,
): { path: string; labelX: number; labelY: number } {
  if (from.key === to.key) {
    const x = from.x + NODE_W - 24;
    const y = from.y;
    return {
      path: `M ${x} ${y} C ${x} ${y - 28}, ${x + 40} ${y - 28}, ${x + 40} ${y + 14}`,
      labelX: x + 20,
      labelY: y - 22,
    };
  }
  if (to.x > from.x) {
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    // Spread parallel labels so they do not overlap.
    const shift = (index % 3) * 14 - 14;
    return {
      path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
      labelX: mid,
      labelY: (y1 + y2) / 2 - 6 + shift,
    };
  }
  // Backward or same-column edge: loop under both nodes.
  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y + NODE_H;
  const drop = Math.max(y1, y2) + 34 + (index % 3) * 8;
  return {
    path: `M ${x1} ${y1} C ${x1} ${drop}, ${x2} ${drop}, ${x2} ${y2}`,
    labelX: (x1 + x2) / 2,
    labelY: drop - 4,
  };
}

// ─── Validation helpers ──────────────────────────────────────────────

export function issueStageKey(
  issue: WorkflowIssueView,
  def: WorkflowDefinitionV1 | null,
): string | null {
  if (issue.stage_key) return issue.stage_key;
  const match = /^stages\[(\d+)\]/.exec(issue.path);
  if (match && def) return def.stages[Number(match[1])]?.key ?? null;
  return null;
}

export function tabForIssue(issue: WorkflowIssueView): EditorTab {
  const path = issue.path;
  if (path.includes('.assignee') || path.includes('.quorum')) return 'assignee';
  if (path.includes('.transitions') || issue.code.startsWith('DEFAULT_BRANCH')) {
    return 'transitions';
  }
  if (path.includes('.requirements')) return 'requirements';
  if (path.includes('.form') || path.startsWith('fields')) return 'form';
  if (path.includes('.due')) return 'due';
  if (path.includes('.on_enter') || path.includes('.on_exit')) return 'actions';
  return 'general';
}

export function stageFieldsOf(
  def: WorkflowDefinitionV1,
  stage: WorkflowStageDef,
): WorkflowFieldDef[] {
  return (stage.form?.fields ?? [])
    .map((key) => def.fields.find((f) => f.key === key))
    .filter((f): f is WorkflowFieldDef => !!f);
}

/** Replaces `items[index]` immutably. */
export function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item));
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}
