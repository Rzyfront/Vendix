import {
  WORKFLOW_EXAMPLE_PURCHASE_APPROVAL,
  WorkflowConditionGroup,
  WorkflowDefinitionV1,
  WorkflowFieldDef,
  canonicalJson,
  evaluateCondition,
  findStage,
  isHumanStage,
  normalizeDefinition,
  resolveTokens,
  resolveTransition,
  stageOutcomes,
  startStage,
  validateFormValues,
  visibleFieldKeys,
} from './index';

const F = (key: string, type: any, extra: any = {}): WorkflowFieldDef => ({ key, type, label: key, ...extra });
const fields: WorkflowFieldDef[] = [
  F('n', 'number'),
  F('m', 'money'),
  F('d', 'date'),
  F('t', 'text'),
  F('ta', 'textarea'),
  F('b', 'boolean'),
  F('s', 'select', { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
  F('ms', 'multiselect', { options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }),
  F('e', 'email'),
  F('p', 'phone'),
  F('f', 'file'),
  F('u', 'user'),
];
const ev = (field: string, op: any, value: any, data: Record<string, unknown>) =>
  evaluateCondition({ all: [{ field, op, value }] }, data, fields);

describe('evaluateCondition — operators by type', () => {
  it('number / money compare numerically, accepting numeric strings', () => {
    expect(ev('n', 'gt', 5, { n: 6 })).toBe(true);
    expect(ev('n', 'gt', 5, { n: 5 })).toBe(false);
    expect(ev('n', 'gte', 5, { n: 5 })).toBe(true);
    expect(ev('n', 'lt', 5, { n: 4 })).toBe(true);
    expect(ev('n', 'lte', 5, { n: 5 })).toBe(true);
    expect(ev('n', 'eq', 5, { n: '5' })).toBe(true);
    expect(ev('n', 'neq', 5, { n: 6 })).toBe(true);
    expect(ev('m', 'gt', 2000000, { m: '3000000' })).toBe(true);
    expect(ev('m', 'gt', 9, { m: '10' })).toBe(true); // numeric, not lexicographic
  });

  it('date compares YYYY-MM-DD strings', () => {
    expect(ev('d', 'gt', '2026-01-01', { d: '2026-02-01' })).toBe(true);
    expect(ev('d', 'lt', '2026-01-01', { d: '2026-02-01' })).toBe(false);
    expect(ev('d', 'eq', '2026-02-01', { d: '2026-02-01' })).toBe(true);
    expect(ev('d', 'gte', '2026-02-01', { d: '2026-02-01' })).toBe(true);
    expect(ev('d', 'lte', '2026-02-01', { d: '2026-02-01' })).toBe(true);
    expect(ev('d', 'neq', '2026-02-01', { d: '2026-02-02' })).toBe(true);
  });

  it('text: eq, neq, contains (case-insensitive), in, not_in', () => {
    expect(ev('t', 'eq', 'abc', { t: 'abc' })).toBe(true);
    expect(ev('t', 'neq', 'abc', { t: 'abd' })).toBe(true);
    expect(ev('t', 'contains', 'BC', { t: 'abc' })).toBe(true);
    expect(ev('t', 'contains', 'zz', { t: 'abc' })).toBe(false);
    expect(ev('t', 'in', ['abc', 'q'], { t: 'abc' })).toBe(true);
    expect(ev('t', 'not_in', ['q'], { t: 'abc' })).toBe(true);
    expect(ev('t', 'not_in', ['abc'], { t: 'abc' })).toBe(false);
    expect(ev('e', 'eq', 'a@b.co', { e: 'a@b.co' })).toBe(true);
  });

  it('select: eq, neq, in, not_in', () => {
    expect(ev('s', 'eq', 'a', { s: 'a' })).toBe(true);
    expect(ev('s', 'neq', 'a', { s: 'b' })).toBe(true);
    expect(ev('s', 'in', ['a', 'b'], { s: 'b' })).toBe(true);
    expect(ev('s', 'not_in', ['a'], { s: 'b' })).toBe(true);
  });

  it('multiselect contains = array includes', () => {
    expect(ev('ms', 'contains', 'x', { ms: ['x', 'y'] })).toBe(true);
    expect(ev('ms', 'contains', 'z', { ms: ['x', 'y'] })).toBe(false);
    expect(ev('ms', 'contains', 'x', { ms: 'x' })).toBe(false);
  });

  it('boolean is_true / is_false', () => {
    expect(ev('b', 'is_true', undefined, { b: true })).toBe(true);
    expect(ev('b', 'is_true', undefined, { b: false })).toBe(false);
    expect(ev('b', 'is_false', undefined, { b: false })).toBe(true);
    expect(ev('b', 'is_false', undefined, {})).toBe(false);
  });

  it('is_empty / is_not_empty for undefined, null, "", [] and values', () => {
    for (const v of [undefined, null, '', []]) {
      expect(ev('t', 'is_empty', undefined, { t: v })).toBe(true);
      expect(ev('t', 'is_not_empty', undefined, { t: v })).toBe(false);
    }
    expect(ev('t', 'is_not_empty', undefined, { t: 'x' })).toBe(true);
    expect(ev('f', 'is_not_empty', undefined, { f: 12 })).toBe(true);
    expect(ev('ms', 'is_empty', undefined, { ms: [] })).toBe(true);
    expect(ev('n', 'is_empty', undefined, { n: 0 })).toBe(false);
    expect(ev('b', 'is_true', undefined, { b: true })).toBe(true);
  });

  it('user eq / neq compare ids', () => {
    expect(ev('u', 'eq', 7, { u: 7 })).toBe(true);
    expect(ev('u', 'neq', 7, { u: 8 })).toBe(true);
  });
});

describe('evaluateCondition — fail closed', () => {
  it('unknown field, op not allowed for the type, type mismatch, missing data', () => {
    expect(ev('zz', 'eq', 1, { zz: 1 })).toBe(false);
    expect(ev('n', 'contains', 'a', { n: 5 })).toBe(false);
    expect(ev('n', 'gt', 5, { n: 'abc' })).toBe(false);
    expect(ev('n', 'gt', 5, {})).toBe(false);
    expect(ev('n', 'neq', 5, {})).toBe(false);
    expect(ev('n', 'gt', 'abc', { n: 6 })).toBe(false);
    expect(ev('d', 'gt', '2026-01-01', { d: 'mañana' })).toBe(false);
    expect(ev('t', 'contains', 'a', { t: 5 })).toBe(false);
    expect(ev('t', 'in', 'a', { t: 'a' })).toBe(false);
    expect(ev('b', 'is_true', undefined, { b: 'true' })).toBe(false);
  });

  it('malformed groups and nodes are false', () => {
    expect(evaluateCondition({ all: [] }, {}, fields)).toBe(false);
    expect(evaluateCondition(null as any, {}, fields)).toBe(false);
    expect(evaluateCondition({ all: [{} as any] }, {}, fields)).toBe(false);
    expect(evaluateCondition({ all: [{ field: 'n', op: 'gt', value: 1 }], extra: 1 } as any, { n: 5 }, fields)).toBe(true);
  });
});

describe('evaluateCondition — nesting', () => {
  const g: WorkflowConditionGroup = {
    all: [
      { field: 'n', op: 'gt', value: 1 },
      {
        any: [
          { field: 't', op: 'eq', value: 'a' },
          { all: [{ field: 'b', op: 'is_true' }, { field: 's', op: 'eq', value: 'a' }] },
        ],
      },
    ],
  };
  it('all / any combine', () => {
    expect(evaluateCondition(g, { n: 2, t: 'a' }, fields)).toBe(true);
    expect(evaluateCondition(g, { n: 2, t: 'z', b: true, s: 'a' }, fields)).toBe(true);
    expect(evaluateCondition(g, { n: 2, t: 'z', b: true, s: 'b' }, fields)).toBe(false);
    expect(evaluateCondition(g, { n: 0, t: 'a' }, fields)).toBe(false);
  });
});

describe('resolveTransition', () => {
  const def = WORKFLOW_EXAMPLE_PURCHASE_APPROVAL;
  const jefe = findStage(def, 'jefe')!;
  it('first transition with matching outcome and passing condition, default last', () => {
    expect(resolveTransition(jefe, 'approve', { monto: 3000000 }, def.fields)?.to).toBe('gerente');
    expect(resolveTransition(jefe, 'approve', { monto: 1000 }, def.fields)?.to).toBe('aprobada');
    expect(resolveTransition(jefe, 'approve', {}, def.fields)?.to).toBe('aprobada');
    expect(resolveTransition(jefe, 'reject', {}, def.fields)?.to).toBe('rechazada');
  });
  it('null when no transition matches', () => {
    expect(resolveTransition(jefe, 'submit', {}, def.fields)).toBeNull();
    expect(resolveTransition({ key: 'x', name: 'x', type: 'end' }, 'auto', {}, def.fields)).toBeNull();
  });
});

describe('stage helpers', () => {
  const def = WORKFLOW_EXAMPLE_PURCHASE_APPROVAL;
  it('findStage, startStage, stageOutcomes, isHumanStage', () => {
    expect(findStage(def, 'jefe')?.name).toBe('Aprobación jefe de tienda');
    expect(findStage(def, 'nope')).toBeUndefined();
    expect(startStage(def)?.key).toBe('solicitud');
    expect(stageOutcomes(findStage(def, 'jefe')!)).toEqual(['approve', 'reject']);
    expect(stageOutcomes(findStage(def, 'aprobada')!)).toEqual([]);
    expect(isHumanStage(findStage(def, 'jefe')!)).toBe(true);
    expect(isHumanStage(findStage(def, 'aprobada')!)).toBe(false);
  });
});

describe('visibleFieldKeys', () => {
  const def: WorkflowDefinitionV1 = JSON.parse(JSON.stringify(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL));
  def.fields[2].visible_when = { all: [{ field: 'monto', op: 'gt', value: 1000 }] };
  const st = findStage(def, 'solicitud')!;
  it('hides fields whose visible_when fails', () => {
    expect(visibleFieldKeys(def, st, { monto: 5000 })).toEqual(['monto', 'proveedor', 'cotizacion']);
    expect(visibleFieldKeys(def, st, { monto: 10 })).toEqual(['monto', 'proveedor']);
    expect(visibleFieldKeys(def, st, {})).toEqual(['monto', 'proveedor']);
  });
});

describe('validateFormValues', () => {
  const mk = (list: WorkflowFieldDef[]): [WorkflowDefinitionV1, any] => {
    const def: WorkflowDefinitionV1 = {
      schema: 'vendix.workflow/v1',
      key: 'k',
      name: 'K',
      fields: list,
      stages: [{ key: 'a', name: 'A', type: 'form', start: true, form: { fields: list.map((f) => f.key) } }],
    };
    return [def, def.stages[0]];
  };
  const run = (list: WorkflowFieldDef[], values: Record<string, unknown>) => {
    const [def, st] = mk(list);
    return validateFormValues(def, st, values);
  };

  it('rejects unknown keys', () => {
    const r = run([F('t', 'text')], { t: 'x', otro: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.field)).toEqual(['otro']);
  });

  it('required check', () => {
    const r = run([F('t', 'text', { required: true, label: 'Nombre' })], {});
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toEqual({ field: 't', message: 'El campo "Nombre" es obligatorio.' });
    expect(run([F('t', 'text', { required: true })], { t: '' }).ok).toBe(false);
    expect(run([F('b', 'boolean', { required: true })], { b: false }).ok).toBe(true);
  });

  it('a hidden field is rejected', () => {
    const list = [F('a', 'number'), F('h', 'text', { visible_when: { all: [{ field: 'a', op: 'gt', value: 10 }] } })];
    expect(run(list, { a: 1, h: 'x' }).ok).toBe(false);
    expect(run(list, { a: 20, h: 'x' }).ok).toBe(true);
  });

  it('a hidden required field is not demanded', () => {
    const list = [F('a', 'number'), F('h', 'text', { required: true, visible_when: { all: [{ field: 'a', op: 'gt', value: 10 }] } })];
    expect(run(list, { a: 1 }).ok).toBe(true);
  });

  it('number / money coercion', () => {
    expect(run([F('n', 'number'), F('m', 'money')], { n: '12.5', m: 100 }).values).toEqual({ n: 12.5, m: 100 });
    expect(run([F('n', 'number')], { n: 'abc' }).ok).toBe(false);
    expect(run([F('n', 'number')], { n: Infinity }).ok).toBe(false);
    expect(run([F('m', 'money')], { m: NaN }).ok).toBe(false);
  });

  it('date', () => {
    expect(run([F('d', 'date')], { d: '2026-02-28' }).ok).toBe(true);
    expect(run([F('d', 'date')], { d: '2026-02-30' }).ok).toBe(false);
    expect(run([F('d', 'date')], { d: '28/02/2026' }).ok).toBe(false);
  });

  it('boolean', () => {
    expect(run([F('b', 'boolean')], { b: 'true' }).values).toEqual({ b: true });
    expect(run([F('b', 'boolean')], { b: false }).values).toEqual({ b: false });
    expect(run([F('b', 'boolean')], { b: 'si' }).ok).toBe(false);
  });

  it('select / multiselect', () => {
    const list = [fields[6], fields[7]];
    expect(run(list, { s: 'a', ms: ['x', 'y'] }).ok).toBe(true);
    expect(run(list, { s: 'zz' }).ok).toBe(false);
    expect(run(list, { ms: ['x', 'zz'] }).ok).toBe(false);
    expect(run(list, { ms: 'x' }).ok).toBe(false);
  });

  it('email / phone', () => {
    expect(run([F('e', 'email')], { e: 'a@b.co' }).ok).toBe(true);
    expect(run([F('e', 'email')], { e: 'nope' }).ok).toBe(false);
    expect(run([F('p', 'phone')], { p: '+57 300-123 4567' }).ok).toBe(true);
    expect(run([F('p', 'phone')], { p: '123' }).ok).toBe(false);
    expect(run([F('p', 'phone')], { p: 'abc1234567' }).ok).toBe(false);
  });

  it('text and textarea length caps', () => {
    expect(run([F('t', 'text')], { t: 'x'.repeat(2000) }).ok).toBe(true);
    expect(run([F('t', 'text')], { t: 'x'.repeat(2001) }).ok).toBe(false);
    expect(run([F('t', 'textarea')], { t: 'x'.repeat(10000) }).ok).toBe(true);
    expect(run([F('t', 'textarea')], { t: 'x'.repeat(10001) }).ok).toBe(false);
    expect(run([F('t', 'text')], { t: 5 }).ok).toBe(false);
  });

  it('file ids and user ids', () => {
    expect(run([F('f', 'file')], { f: 12 }).ok).toBe(true);
    expect(run([F('f', 'file')], { f: [1, 2] }).ok).toBe(true);
    expect(run([F('f', 'file')], { f: 0 }).ok).toBe(false);
    expect(run([F('f', 'file')], { f: [1, -2] }).ok).toBe(false);
    expect(run([F('f', 'file')], { f: 'x' }).ok).toBe(false);
    expect(run([F('u', 'user')], { u: 3 }).ok).toBe(true);
    expect(run([F('u', 'user')], { u: 1.5 }).ok).toBe(false);
  });

  it('non-object values are rejected without throwing', () => {
    const [def, st] = mk([F('t', 'text')]);
    expect(validateFormValues(def, st, null as any).ok).toBe(false);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every level and is whitespace-free', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
  it('is stable regardless of insertion order and omits undefined properties', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, 'a', true, null])).toBe('[1,"a",true,null]');
    expect(canonicalJson('x')).toBe('"x"');
  });
});

describe('normalizeDefinition', () => {
  const def = WORKFLOW_EXAMPLE_PURCHASE_APPROVAL;
  it('fills defaults without mutating the input', () => {
    const before = JSON.stringify(def);
    const n = normalizeDefinition({ ...def, triggers: undefined });
    expect(JSON.stringify(def)).toBe(before);
    expect(n.triggers).toEqual([{ kind: 'manual' }]);
    const g = findStage(n, 'gerente')!;
    expect(g.assignee).toEqual({ kind: 'group', group_key: 'gerencia', strategy: 'any' });
    expect(n).not.toBe(def);
    expect(n.stages[0]).not.toBe(def.stages[0]);
  });

  it('blocks_exit defaults to true for upload and signature, keeps explicit values', () => {
    const d: WorkflowDefinitionV1 = JSON.parse(JSON.stringify(def));
    findStage(d, 'gerente')!.requirements!.push(
      { kind: 'upload', key: 'u1', label: 'U' },
      { kind: 'upload', key: 'u2', label: 'U', blocks_exit: false },
      { kind: 'signature', key: 's1', label: 'S', of: 'x' },
    );
    const reqs = findStage(normalizeDefinition(d), 'gerente')!.requirements! as any[];
    expect(reqs.find((r) => r.key === 'u1').blocks_exit).toBe(true);
    expect(reqs.find((r) => r.key === 'u2').blocks_exit).toBe(false);
    expect(reqs.find((r) => r.key === 's1').blocks_exit).toBe(true);
    expect(reqs.find((r) => r.key === 'cotizacion_adjunta').blocks_exit).toBeUndefined();
  });

  it('is idempotent and hash-stable', () => {
    const once = normalizeDefinition(def);
    expect(canonicalJson(normalizeDefinition(once))).toBe(canonicalJson(once));
  });
});

describe('resolveTokens', () => {
  const ctx = {
    fields: { monto: 1500.5, proveedor: 'ACME', ok: true, files: [1, 2], obj: { a: 1 } },
    instance: { reference: 'FLU-0001', title: 'Compra' },
    event: { order_id: 42, email: 'a@b.co' },
  };

  it('replaces fields, instance and event tokens with strings', () => {
    expect(resolveTokens('{{fields.proveedor}} · {{ fields.monto }}', ctx)).toBe('ACME · 1500.5');
    expect(resolveTokens('{{instance.reference}} {{instance.title}}', ctx)).toBe('FLU-0001 Compra');
    expect(resolveTokens('#{{event.order_id}} {{event.email}}', ctx)).toBe('#42 a@b.co');
    expect(resolveTokens('{{fields.ok}}', ctx)).toBe('true');
    expect(resolveTokens('sin tokens', ctx)).toBe('sin tokens');
  });

  it('is total: unknown paths, non-scalars, prototype keys and bad roots become empty', () => {
    expect(resolveTokens('[{{fields.ghost}}]', ctx)).toBe('[]');
    expect(resolveTokens('[{{fields.files}}][{{fields.obj}}]', ctx)).toBe('[][]');
    expect(resolveTokens('[{{fields.constructor}}][{{fields.__proto__}}]', ctx)).toBe('[][]');
    expect(resolveTokens('[{{process.env.HOME}}][{{fields}}][{{fields.a.b}}][{{}}]', ctx)).toBe('[][][][]');
    expect(resolveTokens('{{ event.order_id | upper }}', ctx)).toBe('');
    expect(resolveTokens(undefined as unknown as string, ctx)).toBe('');
    expect(resolveTokens('{{fields.proveedor}}', {})).toBe('');
  });

  it('only resolves allowed paths when a whitelist is given and never evaluates code', () => {
    const allowed = ['event.order_id'];
    expect(resolveTokens('{{event.order_id}}-{{event.email}}', { ...ctx, allowed })).toBe('42-');
    expect(resolveTokens('{{ 1+1 }} {{ require("fs") }}', ctx)).toBe(' ');
  });

  it('caps the resolved length', () => {
    const big = { fields: { x: 'a'.repeat(10000) } };
    expect(resolveTokens('{{fields.x}}', big).length).toBe(4000);
  });
});
