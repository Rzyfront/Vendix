import {
  STAGE_OUTCOMES,
  WORKFLOW_LIMITS,
  WORKFLOW_STAGE_TYPES,
  WorkflowDefinitionV1,
  WorkflowStageDef,
  WorkflowConditionGroup,
  WorkflowStageType,
  WorkflowTransitionDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import {
  STAGE_TYPE_ICON,
  STAGE_TYPE_LABEL,
  computeLayout,
  describeCondition,
  outcomeText,
} from '../../workflow-editor.utils';

/** Pure geometry and transition logic of the editable canvas (P5.1). */

export const CANVAS_NODE_W = 184;
export const CANVAS_NODE_H = 64;
/** Upper bound accepted by the contract for `ui.x` / `ui.y`. */
export const CANVAS_MAX = 20000;
const CANVAS_MIN_W = 960;
const CANVAS_MIN_H = 520;
const CANVAS_MARGIN = 160;
const SLOT_GAP_X = 56;
const SLOT_GAP_Y = 40;
/** New steps wrap after 3 columns so they land inside the visible canvas. */
export const SLOT_COLUMNS = 3;
const SLOT_START = 32;

/** Icon bubble and left bar classes of each stage type (theme tokens only). */
export const STAGE_TONE: Record<WorkflowStageType, { chip: string; bar: string }> = {
  form: { chip: 'bg-primary/10 text-primary', bar: 'border-l-primary' },
  approval: { chip: 'bg-success/10 text-success', bar: 'border-l-success' },
  review: { chip: 'bg-info/10 text-info', bar: 'border-l-info' },
  automatic: { chip: 'bg-warning/10 text-warning', bar: 'border-l-warning' },
  parallel: { chip: 'bg-info/10 text-info', bar: 'border-l-info' },
  subflow: { chip: 'bg-primary/10 text-primary', bar: 'border-l-primary' },
  wait: { chip: 'bg-warning/10 text-warning', bar: 'border-l-warning' },
  loop: { chip: 'bg-success/10 text-success', bar: 'border-l-success' },
  end: { chip: 'bg-error/10 text-error', bar: 'border-l-error' },
};

const PALETTE_HINT: Record<WorkflowStageType, string> = {
  form: 'Pide datos a una persona',
  approval: 'Aprobar o rechazar',
  review: 'Aprobar, rechazar o devolver',
  automatic: 'Se resuelve sola: decide y ejecuta acciones',
  parallel: 'Varias ramas a la vez',
  subflow: 'Inicia otros flujos',
  wait: 'Espera un tiempo o una fecha',
  loop: 'Repite mientras se cumpla una condición',
  end: 'Cierra la solicitud',
};

export interface PaletteEntry {
  type: WorkflowStageType;
  label: string;
  icon: string;
  hint: string;
}

/** Every stage type of the contract, in contract order. */
export const STAGE_PALETTE: readonly PaletteEntry[] = WORKFLOW_STAGE_TYPES.map((type) => ({
  type,
  label: STAGE_TYPE_LABEL[type],
  icon: STAGE_TYPE_ICON[type],
  hint: PALETTE_HINT[type],
}));

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasNode extends CanvasPoint {
  key: string;
  name: string;
  type: WorkflowStageType;
  start: boolean;
  unreachable: boolean;
  /** True when the position comes from the stage's saved `ui`. */
  placed: boolean;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  on: string;
  /** Index of the transition inside its stage. */
  index: number;
  path: string;
  labelX: number;
  labelY: number;
  label: string;
  conditional: boolean;
  /** Plain-text description for assistive technology. */
  text: string;
}

export interface CanvasModel {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width: number;
  height: number;
}

export function clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(CANVAS_MAX, Math.max(0, Math.round(value)));
}

export function clampPoint(point: CanvasPoint): CanvasPoint {
  return { x: clampCoordinate(point.x), y: clampCoordinate(point.y) };
}

/**
 * Nodes and edges of the canvas. A stage with `ui` keeps its position; the
 * others get the BFS level layout of the route map. `drag` overrides one node
 * while it is being moved.
 */
export function computeCanvas(
  def: WorkflowDefinitionV1,
  drag: (CanvasPoint & { key: string }) | null = null,
): CanvasModel {
  const auto = new Map(computeLayout(def).nodes.map((n) => [n.key, n]));
  const nodes: CanvasNode[] = def.stages.map((s) => {
    const base = auto.get(s.key);
    const saved = s.ui;
    const point =
      drag && drag.key === s.key
        ? { x: drag.x, y: drag.y }
        : saved
          ? { x: saved.x, y: saved.y }
          : { x: base?.x ?? SLOT_START, y: base?.y ?? SLOT_START };
    return {
      key: s.key,
      name: s.name,
      type: s.type,
      start: s.start === true,
      unreachable: base?.unreachable ?? false,
      placed: !!saved,
      ...point,
    };
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges: CanvasEdge[] = [];
  for (const s of def.stages) {
    const from = byKey.get(s.key);
    (s.transitions ?? []).forEach((t, index) => {
      const to = byKey.get(t.to);
      if (!from || !to) return;
      const when = t.when ? describeCondition(t.when, def.fields) : '';
      const label = when ? `${outcomeText(t.on)} · ${when}` : outcomeText(t.on);
      edges.push({
        id: edgeId(s.key, index),
        from: s.key,
        to: t.to,
        on: t.on,
        index,
        ...edgeGeometry(from, to, index),
        label,
        conditional: !!t.when,
        text: `${s.name} → ${to.name}: ${label}`,
      });
    });
  }
  const right = Math.max(0, ...nodes.map((n) => n.x + CANVAS_NODE_W));
  const bottom = Math.max(0, ...nodes.map((n) => n.y + CANVAS_NODE_H));
  return {
    nodes,
    edges,
    width: Math.max(CANVAS_MIN_W, right + CANVAS_MARGIN),
    height: Math.max(CANVAS_MIN_H, bottom + CANVAS_MARGIN),
  };
}

export function edgeId(from: string, index: number): string {
  return `${from}:${index}`;
}

/** Cubic Bézier from the output port of `from` to the input port of `to`. */
export function edgeGeometry(
  from: CanvasPoint,
  to: CanvasPoint,
  order: number,
): { path: string; labelX: number; labelY: number } {
  const offset = ((order % 3) - 1) * 28;
  if (from.x === to.x && from.y === to.y) {
    // Self loop above the node.
    const x1 = from.x + CANVAS_NODE_W - 24;
    const y1 = from.y;
    return {
      path: `M ${x1} ${y1} C ${x1} ${y1 - 44}, ${x1 + 56} ${y1 - 44}, ${x1 + 56} ${y1 + 16}`,
      labelX: x1 + 28,
      labelY: y1 - 36 - Math.abs(offset) / 4,
    };
  }
  const x1 = from.x + CANVAS_NODE_W;
  const y1 = from.y + CANVAS_NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + CANVAS_NODE_H / 2;
  const reach = Math.max(64, Math.abs(x2 - x1) / 2);
  const c1x = x1 + reach;
  const c2x = x2 - reach;
  const c1y = y1 + offset;
  const c2y = y2 + offset;
  return {
    path: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    // Bézier at t = 0.5.
    labelX: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    labelY: (y1 + 3 * c1y + 3 * c2y + y2) / 8 - 6,
  };
}

/** Positions to save for the nodes that still use the automatic layout. */
export function missingPositions(model: CanvasModel): Record<string, CanvasPoint> {
  const out: Record<string, CanvasPoint> = {};
  for (const n of model.nodes) if (!n.placed) out[n.key] = clampPoint(n);
  return out;
}

function overlaps(a: CanvasPoint, b: CanvasPoint): boolean {
  return (
    a.x < b.x + CANVAS_NODE_W + SLOT_GAP_X / 2 &&
    b.x < a.x + CANVAS_NODE_W + SLOT_GAP_X / 2 &&
    a.y < b.y + CANVAS_NODE_H + SLOT_GAP_Y / 2 &&
    b.y < a.y + CANVAS_NODE_H + SLOT_GAP_Y / 2
  );
}

/** First free grid slot (left to right, top to bottom) for a node added by click. */
export function nextFreePosition(nodes: readonly CanvasPoint[]): CanvasPoint {
  for (let slot = 0; slot < 400; slot++) {
    const candidate = {
      x: SLOT_START + (slot % SLOT_COLUMNS) * (CANVAS_NODE_W + SLOT_GAP_X),
      y: SLOT_START + Math.floor(slot / SLOT_COLUMNS) * (CANVAS_NODE_H + SLOT_GAP_Y),
    };
    if (!nodes.some((n) => overlaps(candidate, n))) return candidate;
  }
  return { x: SLOT_START, y: SLOT_START };
}

/** Top-left corner of a node dropped with its center on `point`. */
export function dropPosition(point: CanvasPoint): CanvasPoint {
  return clampPoint({ x: point.x - CANVAS_NODE_W / 2, y: point.y - CANVAS_NODE_H / 2 });
}

/** The node under `point`, the topmost (last drawn) when several overlap. */
export function nodeAt(nodes: readonly CanvasNode[], point: CanvasPoint): CanvasNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (
      point.x >= n.x &&
      point.x <= n.x + CANVAS_NODE_W &&
      point.y >= n.y &&
      point.y <= n.y + CANVAS_NODE_H
    ) {
      return n;
    }
  }
  return null;
}

/** Outcomes a stage of `type` can be connected with (none for `end`). */
export function outcomesOf(type: WorkflowStageType): readonly string[] {
  return STAGE_OUTCOMES[type] ?? [];
}

/**
 * Sets (or clears) the condition of one transition and keeps the stage valid:
 * among the transitions of the same outcome, the conditional ones stay in their
 * order and the default (no condition) goes last, as the validator requires.
 * Returns the new list and the new index of the edited transition.
 */
export function setTransitionWhen(
  transitions: readonly WorkflowTransitionDef[],
  index: number,
  when: WorkflowConditionGroup | undefined,
): { transitions: WorkflowTransitionDef[]; index: number } {
  const edited = transitions.map((t, i) => {
    if (i !== index) return t;
    const { when: _previous, ...rest } = t;
    return (when ? { ...rest, when } : rest) as WorkflowTransitionDef;
  });
  const target = edited[index];
  if (!target) return { transitions: edited, index };
  const slots = edited.map((t, i) => ({ t, i })).filter((o) => o.t.on === target.on);
  const ordered = [...slots.filter((o) => o.t.when), ...slots.filter((o) => !o.t.when)];
  const result = [...edited];
  slots.forEach((slot, k) => {
    result[slot.i] = ordered[k].t;
  });
  return { transitions: result, index: slots[ordered.findIndex((o) => o.i === index)].i };
}

/**
 * Transitions of `stage` after connecting `outcome` to `to`, plus the index of
 * the new one. Null when the connection already exists (unconditional) or the
 * stage is at its transition limit. A new branch goes before an existing
 * default (no `when`) of the same outcome so the default stays last.
 */
export function connectStages(
  stage: WorkflowStageDef,
  outcome: string,
  to: string,
): { transitions: WorkflowTransitionDef[]; index: number } | null {
  const current = stage.transitions ?? [];
  if (current.length >= WORKFLOW_LIMITS.maxTransitionsPerStage) return null;
  if (current.some((t) => t.on === outcome && t.to === to && !t.when)) return null;
  let lastOfOutcome = -1;
  current.forEach((t, i) => {
    if (t.on === outcome) lastOfOutcome = i;
  });
  const lastIsDefault = lastOfOutcome >= 0 && !current[lastOfOutcome].when;
  const index = lastIsDefault ? lastOfOutcome : lastOfOutcome >= 0 ? lastOfOutcome + 1 : current.length;
  const transitions = [...current.slice(0, index), { on: outcome, to }, ...current.slice(index)];
  return { transitions, index };
}
