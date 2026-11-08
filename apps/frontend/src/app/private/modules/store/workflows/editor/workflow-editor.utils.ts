import {
  OPS_BY_FIELD_TYPE,
  WORKFLOW_KEY_PATTERN,
  WorkflowEndOutcome,
  WorkflowConditionGroup,
  WorkflowConditionNode,
  WorkflowConditionOp,
  WorkflowConditionRule,
  WorkflowDefinitionV1,
  WorkflowFieldDef,
  WorkflowFieldType,
  WorkflowStageDef,
  WorkflowStageType,
  WorkflowWaitDef,
} from '../../../../../shared/workflows/contract/workflow-contract';
import { stageFormKeys, stageOutcomes } from '../../../../../shared/workflows/contract/workflow-runtime';
import { WorkflowIssueView } from '../interfaces/workflow.interfaces';

export type EditorTab =
  | 'general'
  | 'assignee'
  | 'form'
  | 'requirements'
  | 'transitions'
  | 'due'
  | 'config'
  | 'guards'
  | 'actions';

export const EDITOR_TABS: { id: EditorTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'assignee', label: 'Responsable', icon: 'user' },
  { id: 'form', label: 'Formulario', icon: 'file-text' },
  { id: 'requirements', label: 'Requisitos', icon: 'paperclip' },
  { id: 'transitions', label: 'Transiciones', icon: 'git-branch' },
  { id: 'due', label: 'Plazos', icon: 'clock' },
  { id: 'config', label: 'Configuración', icon: 'sliders-horizontal' },
  { id: 'guards', label: 'Guardas', icon: 'shield-check' },
  { id: 'actions', label: 'Acciones', icon: 'zap' },
];

/** Stage types that carry their own engine config (the "Configuración" tab). */
export const CONFIG_STAGE_TYPES: readonly WorkflowStageType[] = ['parallel', 'subflow', 'wait', 'loop', 'ai'];

/** Tabs shown for a stage type: "Configuración" only where the type has config. */
export function tabsForStage(
  type: WorkflowStageType,
  aiReview = false,
): { id: EditorTab; label: string; icon: string }[] {
  const engineStage = CONFIG_STAGE_TYPES.includes(type);
  return EDITOR_TABS.filter((t) => {
    if (t.id === 'config') return engineStage;
    // An AI step has no form or requirements (the reviewer edits what the AI
    // wrote); assignee and deadline exist only when a person reviews it.
    if (type === 'ai') {
      if (t.id === 'form' || t.id === 'requirements') return false;
      if (t.id === 'assignee' || t.id === 'due') return aiReview;
      return true;
    }
    // The engine resolves these stages itself (a parallel stage assigns per
    // branch): no stage assignee, form or deadline to edit.
    if (engineStage && (t.id === 'assignee' || t.id === 'form' || t.id === 'due')) return false;
    return true;
  });
}

export const STAGE_TYPE_LABEL: Record<WorkflowStageType, string> = {
  form: 'Formulario',
  approval: 'Aprobación',
  review: 'Revisión',
  automatic: 'Automática',
  ai: 'Paso de IA',
  parallel: 'Paralelo',
  subflow: 'Subflujo',
  wait: 'Espera',
  loop: 'Bucle',
  end: 'Fin',
};

export const STAGE_TYPE_ICON: Record<WorkflowStageType, string> = {
  form: 'file-text',
  approval: 'check-circle',
  review: 'eye',
  automatic: 'zap',
  ai: 'sparkles',
  parallel: 'git-merge',
  subflow: 'git-branch',
  wait: 'timer',
  loop: 'repeat',
  end: 'flag',
};

const OUTCOME_TEXT: Record<string, string> = {
  submit: 'Enviar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  return: 'Devolver',
  auto: 'Automática',
  joined: 'Ramas unidas',
  completed: 'Completada',
  rejected: 'Rechazada',
  elapsed: 'Espera cumplida',
  continue: 'Otra vuelta',
  done: 'Terminado',
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

/** A field in a select: disabled group headers plus one entry per field ("Formulario", "Calculados"). */
export interface ConditionFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Field choices of the condition builder. A condition only sees the instance
 * data (`evaluateCondition` reads declared fields, calculated ones included),
 * so request and event values are not offered here.
 */
export function conditionFieldOptions(fields: readonly WorkflowFieldDef[]): ConditionFieldOption[] {
  const entry = (f: WorkflowFieldDef): ConditionFieldOption => ({
    value: f.key,
    label: `${f.label || f.key} · ${FIELD_TYPE_TEXT[f.type]}`,
  });
  const group = (id: string, title: string, members: readonly WorkflowFieldDef[]): ConditionFieldOption[] =>
    members.length > 0
      ? [{ value: `__group__${id}`, label: `— ${title} —`, disabled: true }, ...members.map(entry)]
      : [];
  return [
    ...group('form', 'Formulario', fields.filter((f) => !f.compute)),
    ...group('computed', 'Calculados', fields.filter((f) => !!f.compute)),
  ];
}

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
  // Engine config and guards first: their paths also contain .assignee / .form.
  if (/\.(parallel|subflow|wait|loop|ai)(\.|$|\[)/.test(path)) return 'config';
  if (path.includes('.guards')) return 'guards';
  if (path.includes('.assignee') || path.includes('.quorum')) return 'assignee';
  if (path.includes('.transitions') || issue.code.startsWith('DEFAULT_BRANCH')) {
    return 'transitions';
  }
  if (path.includes('.requirements')) return 'requirements';
  if (path.includes('.form') || path.startsWith('fields')) return 'form';
  if (path.includes('.due')) return 'due';
  if (/\.on_(enter|exit|submit|complete)/.test(path)) return 'actions';
  return 'general';
}

export function stageFieldsOf(
  def: WorkflowDefinitionV1,
  stage: WorkflowStageDef,
): WorkflowFieldDef[] {
  return stageFormKeys(stage)
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

// ─── Stage type changes (P2) ──────────────────────────────────────────

const TYPE_CONFIG_PROPS = ['parallel', 'subflow', 'wait', 'loop', 'ai'] as const;

/** Default config of a stage type that carries its own (parallel, subflow, wait, loop, ai). */
export function defaultTypeConfig(
  type: WorkflowStageType,
  fields: WorkflowFieldDef[],
): Partial<WorkflowStageDef> {
  switch (type) {
    case 'parallel':
      return {
        parallel: {
          branches: [
            { key: 'rama_1', name: 'Rama 1', assignee: { kind: 'initiator' } },
            { key: 'rama_2', name: 'Rama 2', assignee: { kind: 'initiator' } },
          ],
          join: 'all',
        },
      };
    case 'subflow':
      return { subflow: { flows: [{ flow_key: '' }], wait: true } };
    case 'wait':
      return { wait: { kind: 'duration', days: 1 } };
    case 'ai':
      return { ai: { task: 'classify', instructions: '', inputs: [], outputs: [] } };
    case 'loop': {
      const first = fields[0];
      return {
        loop: {
          while: first ? { all: [{ field: first.key, op: OPS_BY_FIELD_TYPE[first.type][0] }] } : { all: [] },
          max_iterations: 3,
        },
      };
    }
    default:
      return {};
  }
}

/**
 * Returns `stage` as a stage of `type`: drops the config and properties the new
 * type cannot hold (other types' config, transitions of other outcomes,
 * assignee/form of non-human stages) and sets the default config of the new one.
 */
export function retypeStage(
  stage: WorkflowStageDef,
  type: WorkflowStageType,
  fields: WorkflowFieldDef[],
): WorkflowStageDef {
  const {
    outcome: _outcome,
    assignee,
    quorum,
    due,
    form,
    requirements,
    parallel: _p,
    subflow: _s,
    wait: _w,
    loop: _l,
    ai: _a,
    ...rest
  } = stage;
  const human = type === 'form' || type === 'approval' || type === 'review';
  const engine = (TYPE_CONFIG_PROPS as readonly string[]).includes(type);
  const retyped: WorkflowStageDef = {
    ...rest,
    type,
    transitions: stage.transitions ?? [],
    ...(type === 'end' ? { outcome: (stage.outcome ?? 'completed') as WorkflowEndOutcome } : {}),
    ...(human ? { assignee: assignee ?? { kind: 'initiator' as const }, ...(due ? { due } : {}) } : {}),
    ...(type === 'approval' && quorum ? { quorum } : {}),
    ...(!engine && form ? { form } : {}),
    ...(!engine && requirements ? { requirements } : {}),
    ...defaultTypeConfig(type, fields),
  };
  const outcomes = stageOutcomes(retyped);
  return { ...retyped, transitions: (retyped.transitions ?? []).filter((t) => outcomes.includes(t.on)) };
}

/** Whole number from an input value, `undefined` when empty or not a number. */
export function toWholeNumber(raw: unknown): number | undefined {
  if (raw === '' || raw === null || raw === undefined) return undefined;
  const parsed = Math.floor(Number(String(raw).replace(',', '.')));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const WAIT_KIND_LABEL: Record<WorkflowWaitDef['kind'], string> = {
  duration: 'Una duración',
  date: 'Una fecha fija',
  field: 'La fecha de un campo',
  business_days: 'Días hábiles',
  day_of_month: 'Un día del mes',
};

function atTime(time: string | undefined): string {
  return time ? ` a las ${time}` : '';
}

/** "3 días y 2 h", "Hasta el 2026-12-01 a las 08:00"…: what the wait does, in words. */
export function describeWait(wait: WorkflowWaitDef | undefined, fields: WorkflowFieldDef[]): string {
  if (!wait) return '';
  switch (wait.kind) {
    case 'duration': {
      const parts = [
        wait.days ? `${wait.days} ${wait.days === 1 ? 'día' : 'días'}` : '',
        wait.hours ? `${wait.hours} h` : '',
        wait.minutes ? `${wait.minutes} min` : '',
      ].filter((p) => p.length > 0);
      return parts.length > 0 ? `Espera ${parts.join(' y ')}` : 'Define cuánto esperar';
    }
    case 'date':
      return wait.date ? `Espera hasta el ${wait.date}${atTime(wait.time)}` : 'Elige la fecha';
    case 'field': {
      const label = fields.find((f) => f.key === wait.field)?.label ?? wait.field;
      if (!wait.field) return 'Elige el campo de fecha';
      const offset = wait.offset_days ?? 0;
      const shift =
        offset === 0
          ? ''
          : offset > 0
            ? ` + ${offset} ${offset === 1 ? 'día' : 'días'}`
            : ` − ${-offset} ${offset === -1 ? 'día' : 'días'}`;
      return `Espera hasta «${label}»${shift}${atTime(wait.time)}`;
    }
    case 'business_days':
      return `Espera ${wait.days} ${wait.days === 1 ? 'día hábil' : 'días hábiles'}${atTime(wait.time)} (calendario de Colombia)`;
    case 'day_of_month':
      return `Espera hasta el próximo día ${wait.day} del mes${atTime(wait.time)}`;
  }
}

/**
 * Stages with the given canvas positions applied. Only `x` and `y` are stored:
 * `ui` is a closed object in the contract, so any other key (a node key, a
 * drag offset) would make the draft fail validation.
 */
export function withStagePositions(
  stages: readonly WorkflowStageDef[],
  positions: Readonly<Record<string, { x: number; y: number }>>,
): WorkflowStageDef[] {
  return stages.map((s) => {
    const p = positions[s.key];
    return p ? { ...s, ui: { x: p.x, y: p.y } } : s;
  });
}
