import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import {
  CANVAS_MAX,
  CANVAS_NODE_H,
  CANVAS_NODE_W,
  clampPoint,
  computeCanvas,
  connectStages,
  dropPosition,
  edgeId,
  missingPositions,
  nextFreePosition,
  nodeAt,
  outcomesOf,
} from './canvas.utils';

function def(stages: WorkflowStageDef[]): WorkflowDefinitionV1 {
  return {
    schema: 'vendix.workflow/v1',
    key: 'compras',
    name: 'Compras',
    fields: [{ key: 'monto', type: 'money', label: 'Monto' }],
    stages,
  } as WorkflowDefinitionV1;
}

const stages: WorkflowStageDef[] = [
  {
    key: 'pedir',
    name: 'Pedir',
    type: 'form',
    start: true,
    ui: { x: 40, y: 60 },
    transitions: [{ on: 'submit', to: 'jefe' }],
  },
  {
    key: 'jefe',
    name: 'Jefe',
    type: 'approval',
    transitions: [
      { on: 'approve', to: 'gerencia', when: { all: [{ field: 'monto', op: 'gt', value: 2000000 }] } },
      { on: 'approve', to: 'fin' },
      { on: 'reject', to: 'fin' },
    ],
  },
  { key: 'gerencia', name: 'Gerencia', type: 'approval', transitions: [] },
  { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
];

describe('canvas.utils', () => {
  it('uses the saved ui position and the automatic layout for stages without it', () => {
    const model = computeCanvas(def(stages));
    const pedir = model.nodes.find((n) => n.key === 'pedir');
    const jefe = model.nodes.find((n) => n.key === 'jefe');
    expect(pedir).toEqual(jasmine.objectContaining({ x: 40, y: 60, placed: true, start: true }));
    expect(jefe?.placed).toBeFalse();
    expect(jefe?.x).toBeGreaterThan(0);
  });

  it('draws one edge per transition labelled with the outcome and the condition', () => {
    const model = computeCanvas(def(stages));
    expect(model.edges.length).toBe(4);
    const conditional = model.edges.find((e) => e.id === edgeId('jefe', 0));
    expect(conditional?.label).toBe('Aprobar · Monto es mayor que 2.000.000');
    expect(conditional?.conditional).toBeTrue();
    expect(model.edges.find((e) => e.id === edgeId('jefe', 2))?.label).toBe('Rechazar');
  });

  it('skips edges whose target no longer exists', () => {
    const broken = stages.map((s) => (s.key === 'pedir' ? { ...s, transitions: [{ on: 'submit', to: 'nada' }] } : s));
    expect(computeCanvas(def(broken)).edges.some((e) => e.from === 'pedir')).toBeFalse();
  });

  it('a drag override moves only that node and grows the surface', () => {
    const model = computeCanvas(def(stages), { key: 'pedir', x: 3000, y: 10 });
    expect(model.nodes.find((n) => n.key === 'pedir')?.x).toBe(3000);
    expect(model.width).toBeGreaterThan(3000 + CANVAS_NODE_W);
  });

  it('missingPositions lists only the nodes on automatic layout', () => {
    const missing = missingPositions(computeCanvas(def(stages)));
    expect(Object.keys(missing).sort()).toEqual(['fin', 'gerencia', 'jefe']);
  });

  it('clamps coordinates to the contract range', () => {
    expect(clampPoint({ x: -5, y: 30000.4 })).toEqual({ x: 0, y: CANVAS_MAX });
    expect(clampPoint({ x: Number.NaN, y: 12.6 })).toEqual({ x: 0, y: 13 });
    expect(dropPosition({ x: 10, y: 10 })).toEqual({ x: 0, y: 0 });
  });

  it('nextFreePosition skips occupied slots', () => {
    const first = nextFreePosition([]);
    const second = nextFreePosition([first]);
    expect(second).not.toEqual(first);
    expect(Math.abs(second.x - first.x) >= CANVAS_NODE_W || Math.abs(second.y - first.y) >= CANVAS_NODE_H).toBeTrue();
  });

  it('nodeAt finds the node under the pointer, topmost first', () => {
    const nodes = computeCanvas(def(stages)).nodes;
    const pedir = nodes[0];
    expect(nodeAt(nodes, { x: pedir.x + 5, y: pedir.y + 5 })?.key).toBe('pedir');
    expect(nodeAt(nodes, { x: -50, y: -50 })).toBeNull();
  });

  it('outcomesOf follows the contract (end has none)', () => {
    expect(outcomesOf('approval')).toEqual(['approve', 'reject']);
    expect(outcomesOf('end')).toEqual([]);
  });

  describe('connectStages', () => {
    it('adds a transition for an outcome that has none yet', () => {
      const result = connectStages(stages[2], 'approve', 'fin');
      expect(result).toEqual({ transitions: [{ on: 'approve', to: 'fin' }], index: 0 });
    });

    it('appends after the conditional branches of the outcome', () => {
      const only: WorkflowStageDef = {
        ...stages[1],
        transitions: [{ on: 'approve', to: 'gerencia', when: { all: [{ field: 'monto', op: 'gt', value: 1 }] } }],
      };
      expect(connectStages(only, 'approve', 'fin')?.index).toBe(1);
    });

    it('rejects an identical unconditional connection', () => {
      expect(connectStages(stages[0], 'submit', 'jefe')).toBeNull();
    });

    it('keeps the default last: a new branch goes before the default of its outcome', () => {
      const result = connectStages(stages[1], 'approve', 'pedir');
      expect(result?.index).toBe(1);
      expect(result?.transitions.map((t) => `${t.on}>${t.to}`)).toEqual([
        'approve>gerencia',
        'approve>pedir',
        'approve>fin',
        'reject>fin',
      ]);
    });

    it('refuses past the per-stage limit', () => {
      const many: WorkflowStageDef = {
        ...stages[0],
        transitions: Array.from({ length: 20 }, (_, i) => ({ on: 'submit', to: `x${i}` })),
      };
      expect(connectStages(many, 'submit', 'fin')).toBeNull();
    });
  });
});
