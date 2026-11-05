import {
  WORKFLOW_EXAMPLE_PURCHASE_APPROVAL,
  WORKFLOW_ISSUE_CODES,
  WORKFLOW_LIMITS,
  WORKFLOW_V1_JSON_SCHEMA,
  WorkflowDefinitionV1,
  WorkflowStageDef,
  formatWorkflowIssues,
  validateWorkflowDefinition,
} from './index';

type Mut = (d: any) => void;
const ex = (): any => JSON.parse(JSON.stringify(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL));
const stage = (d: any, key: string): any => d.stages.find((s: any) => s.key === key);
const run = (m?: Mut, ctx?: any) => {
  const d = ex();
  m?.(d);
  return validateWorkflowDefinition(d, ctx);
};
const errCodes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);
const has = (r: any, code: string) => errCodes(r).includes(code);

describe('validateWorkflowDefinition — example and basics', () => {
  it('the example is valid with no errors or warnings', () => {
    const r = validateWorkflowDefinition(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL);
    expect(r).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('exports the code list and a JSON schema with $id', () => {
    expect(WORKFLOW_ISSUE_CODES).toContain('UNREACHABLE_STAGE');
    expect(WORKFLOW_ISSUE_CODES).toContain('OUTCOME_UNREACHABLE');
    expect(WORKFLOW_V1_JSON_SCHEMA.$id).toBe(
      'https://vendix.com/schemas/vendix.workflow/v1.json',
    );
  });

  it('a cycle that contains a human stage is allowed', () => {
    const r = run((d) => {
      stage(d, 'gerente').transitions[1] = { to: 'solicitud', on: 'reject' };
    });
    expect(r.valid).toBe(true);
  });

  it('SCHEMA_MISMATCH', () => {
    expect(has(run((d) => (d.schema = 'x/v2')), 'SCHEMA_MISMATCH')).toBe(true);
  });

  it('KEY_INVALID for definition, stage and field keys', () => {
    expect(has(run((d) => (d.key = 'Bad Key')), 'KEY_INVALID')).toBe(true);
    expect(has(run((d) => (d.stages[0].key = 'A B')), 'KEY_INVALID')).toBe(true);
    expect(has(run((d) => (d.fields[0].key = '1x')), 'KEY_INVALID')).toBe(true);
  });

  it('DUPLICATE_KEY for stages, fields and requirements', () => {
    expect(has(run((d) => (d.stages[1].key = 'solicitud')), 'DUPLICATE_KEY')).toBe(true);
    expect(has(run((d) => (d.fields[1].key = 'monto')), 'DUPLICATE_KEY')).toBe(true);
    expect(
      has(
        run((d) => {
          const g = stage(d, 'gerente');
          g.requirements.push({ ...g.requirements[0] });
        }),
        'DUPLICATE_KEY',
      ),
    ).toBe(true);
  });

  it('SHAPE_INVALID for unknown properties and bad types', () => {
    expect(has(run((d) => (d.extra = 1)), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (d.name = 5)), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (d.stages = 'x')), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (d.fields[0].type = 'blob')), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (d.stages[1].type = 'weird')), 'SHAPE_INVALID')).toBe(true);
  });
});

describe('validateWorkflowDefinition — totality over garbage', () => {
  const circular: any = { schema: 'vendix.workflow/v1' };
  circular.self = circular;
  const garbage: unknown[] = [
    null,
    undefined,
    [],
    'x',
    42,
    true,
    {},
    { stages: null, fields: null },
    { schema: 'vendix.workflow/v1', stages: [null, 1, 'a', []], fields: [null, {}] },
    { schema: 'vendix.workflow/v1', key: 'a', name: 'a', fields: [], stages: [{ transitions: 5 }] },
    circular,
  ];
  it.each(garbage.map((g, i) => [i, g] as const))('garbage #%s never throws', (_i, g) => {
    let r: any;
    expect(() => (r = validateWorkflowDefinition(g))).not.toThrow();
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('non-object root reports SHAPE_INVALID with a path', () => {
    const r = validateWorkflowDefinition(null);
    expect(r.errors[0]).toMatchObject({ code: 'SHAPE_INVALID' });
    expect(typeof r.errors[0].path).toBe('string');
  });
});

describe('validateWorkflowDefinition — graph rules', () => {
  it('START_COUNT: none, two, or on an end stage', () => {
    expect(has(run((d) => delete d.stages[0].start), 'START_COUNT')).toBe(true);
    expect(has(run((d) => (d.stages[1].start = true)), 'START_COUNT')).toBe(true);
    expect(
      has(
        run((d) => {
          delete d.stages[0].start;
          stage(d, 'aprobada').start = true;
        }),
        'START_COUNT',
      ),
    ).toBe(true);
  });

  it('END_MISSING (and DEAD_END) when there is no end stage', () => {
    const r = run((d) => {
      d.stages = [
        {
          key: 'solicitud',
          name: 'Solicitud',
          type: 'form',
          start: true,
          assignee: { kind: 'initiator' },
          transitions: [{ to: 'solicitud', on: 'submit' }],
        },
      ];
    });
    expect(has(r, 'END_MISSING')).toBe(true);
    expect(has(r, 'DEAD_END')).toBe(true);
  });

  it('UNREACHABLE_STAGE names the stage', () => {
    const r = run((d) =>
      d.stages.push({ key: 'huerfana', name: 'Etapa huérfana', type: 'end', outcome: 'cancelled' }),
    );
    expect(has(r, 'UNREACHABLE_STAGE')).toBe(true);
    const issue = r.errors.find((e) => e.code === 'UNREACHABLE_STAGE')!;
    expect(issue.stage_key).toBe('huerfana');
    expect(issue.message).toContain('Etapa huérfana');
  });

  it('DEAD_END: a reachable stage from which no end is reachable', () => {
    const r = run((d) => {
      d.stages.push({
        key: 'bucle',
        name: 'Bucle sin salida',
        type: 'form',
        assignee: { kind: 'initiator' },
        transitions: [{ to: 'bucle', on: 'submit' }],
      });
      stage(d, 'gerente').transitions[1] = { to: 'bucle', on: 'reject' };
    });
    const issue = r.errors.find((e) => e.code === 'DEAD_END')!;
    expect(issue.stage_key).toBe('bucle');
    expect(issue.message).toContain('Bucle sin salida');
  });

  it('TRANSITION_TARGET_UNKNOWN with path', () => {
    const r = run((d) => (stage(d, 'jefe').transitions[1].to = 'nada'));
    const issue = r.errors.find((e) => e.code === 'TRANSITION_TARGET_UNKNOWN')!;
    expect(issue.path).toBe('stages[1].transitions[1].to');
  });

  it('OUTCOME_INVALID: outcome not in the stage type set', () => {
    expect(has(run((d) => (stage(d, 'jefe').transitions[2].on = 'submit')), 'OUTCOME_INVALID')).toBe(true);
    expect(has(run((d) => (stage(d, 'solicitud').transitions[0].on = 'approve')), 'OUTCOME_INVALID')).toBe(true);
  });

  it('END_HAS_TRANSITIONS and END_OUTCOME_MISSING', () => {
    expect(
      has(run((d) => (stage(d, 'aprobada').transitions = [{ to: 'jefe', on: 'auto' }])), 'END_HAS_TRANSITIONS'),
    ).toBe(true);
    expect(has(run((d) => delete stage(d, 'aprobada').outcome), 'END_OUTCOME_MISSING')).toBe(true);
    expect(has(run((d) => (stage(d, 'aprobada').outcome = 'nope')), 'END_OUTCOME_MISSING')).toBe(true);
  });

  it('DEFAULT_BRANCH_MISSING when a conditional branch has no default', () => {
    const r = run((d) => stage(d, 'jefe').transitions.splice(1, 1));
    expect(has(r, 'DEFAULT_BRANCH_MISSING')).toBe(true);
  });

  it('DEFAULT_BRANCH_MISSING for an automatic stage without auto default', () => {
    const r = run((d) => {
      d.stages.splice(3, 0, { key: 'auto1', name: 'Paso automático', type: 'automatic', transitions: [] });
      stage(d, 'jefe').transitions[1].to = 'auto1';
    });
    expect(has(r, 'DEFAULT_BRANCH_MISSING')).toBe(true);
  });

  it('DEFAULT_BRANCH_NOT_LAST when the default precedes a conditional branch', () => {
    const r = run((d) => {
      const t = stage(d, 'jefe').transitions;
      [t[0], t[1]] = [t[1], t[0]];
    });
    expect(has(r, 'DEFAULT_BRANCH_NOT_LAST')).toBe(true);
  });

  it('AUTOMATIC_LOOP: a cycle made only of automatic stages', () => {
    const r = run((d) => {
      d.stages.push(
        { key: 'a1', name: 'Auto uno', type: 'automatic', transitions: [{ to: 'a2', on: 'auto' }] },
        { key: 'a2', name: 'Auto dos', type: 'automatic', transitions: [{ to: 'a1', on: 'auto' }] },
      );
      stage(d, 'jefe').transitions[1].to = 'a1';
    });
    expect(has(r, 'AUTOMATIC_LOOP')).toBe(true);
  });

  it('OUTCOME_UNREACHABLE is a warning, not an error', () => {
    const r = run((d) => stage(d, 'gerente').transitions.splice(1, 1));
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('OUTCOME_UNREACHABLE');
    const w = r.warnings.find((x) => x.code === 'OUTCOME_UNREACHABLE')!;
    expect(w.message).toContain('Aprobación gerencia');
  });
});

describe('validateWorkflowDefinition — assignees, quorum, due', () => {
  it('ASSIGNEE_MISSING names the stage in Spanish', () => {
    const r = run((d) => delete stage(d, 'jefe').assignee);
    const i = r.errors.find((e) => e.code === 'ASSIGNEE_MISSING')!;
    expect(i.message).toBe('La etapa "Aprobación jefe de tienda" no tiene responsable.');
  });

  it('ASSIGNEE_NOT_ALLOWED on automatic and end stages', () => {
    expect(has(run((d) => (stage(d, 'aprobada').assignee = { kind: 'initiator' })), 'ASSIGNEE_NOT_ALLOWED')).toBe(true);
  });

  it('ROLE_UNKNOWN / GROUP_UNKNOWN / USER_UNKNOWN with context', () => {
    const r = run(
      (d) => (stage(d, 'solicitud').assignee = { kind: 'user', user_id: 77 }),
      { roleKeys: ['owner'], groupKeys: ['otro'], userIds: [1, 2] },
    );
    expect(has(r, 'ROLE_UNKNOWN')).toBe(true);
    expect(has(r, 'GROUP_UNKNOWN')).toBe(true);
    expect(has(r, 'USER_UNKNOWN')).toBe(true);
  });

  it('structural mode (no context lists) skips existence checks', () => {
    const r = validateWorkflowDefinition(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL, {});
    expect(r.valid).toBe(true);
  });

  it('existing role and group pass with context', () => {
    const r = validateWorkflowDefinition(WORKFLOW_EXAMPLE_PURCHASE_APPROVAL, {
      roleKeys: ['store_manager'],
      groupKeys: ['gerencia'],
      userIds: [],
    });
    expect(r.valid).toBe(true);
  });

  it('start_roles must exist when roleKeys is given', () => {
    const d = ex();
    d.start_roles = ['ghost'];
    expect(has(validateWorkflowDefinition(d, { roleKeys: ['owner'] }), 'ROLE_UNKNOWN')).toBe(true);
    expect(validateWorkflowDefinition(d).valid).toBe(true);
  });

  it('escalate_to is validated as an assignee', () => {
    const r = run((d) => (stage(d, 'jefe').due.on_overdue.escalate_to = { kind: 'role', role_key: 'zzz' }), {
      roleKeys: ['store_manager'],
    });
    expect(has(r, 'ROLE_UNKNOWN')).toBe(true);
  });

  it('field assignee must be a declared user field', () => {
    const bad = run((d) => (stage(d, 'jefe').assignee = { kind: 'field', field: 'monto' }));
    expect(has(bad, 'FIELD_TYPE_MISMATCH')).toBe(true);
    const unk = run((d) => (stage(d, 'jefe').assignee = { kind: 'field', field: 'zz' }));
    expect(has(unk, 'FIELD_UNKNOWN')).toBe(true);
    const ok = run((d) => {
      d.fields.push({ key: 'resp', type: 'user', label: 'Responsable' });
      stage(d, 'jefe').assignee = { kind: 'field', field: 'resp' };
    });
    expect(ok.valid).toBe(true);
  });

  it('QUORUM_INVALID: bad number, non-approval, non role/group assignee', () => {
    expect(has(run((d) => (stage(d, 'gerente').quorum = { required: 0 })), 'QUORUM_INVALID')).toBe(true);
    expect(has(run((d) => (stage(d, 'gerente').quorum = { required: 1.5 })), 'QUORUM_INVALID')).toBe(true);
    expect(has(run((d) => (stage(d, 'solicitud').quorum = { required: 1 })), 'QUORUM_INVALID')).toBe(true);
    expect(has(run((d) => (stage(d, 'gerente').assignee = { kind: 'initiator' })), 'QUORUM_INVALID')).toBe(true);
  });

  it('due hours out of range', () => {
    expect(has(run((d) => (stage(d, 'jefe').due.hours = 0)), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (stage(d, 'jefe').due.hours = 9000)), 'SHAPE_INVALID')).toBe(true);
  });
});

describe('validateWorkflowDefinition — conditions', () => {
  const setWhen = (when: any) => (d: any) => (stage(d, 'jefe').transitions[0].when = when);

  it('FIELD_UNKNOWN in a condition', () => {
    expect(has(run(setWhen({ all: [{ field: 'nope', op: 'eq', value: 1 }] })), 'FIELD_UNKNOWN')).toBe(true);
  });

  it('CONDITION_OP_INVALID: operator not allowed for the field type', () => {
    expect(has(run(setWhen({ all: [{ field: 'monto', op: 'contains', value: '1' }] })), 'CONDITION_OP_INVALID')).toBe(true);
    expect(has(run(setWhen({ all: [{ field: 'monto', op: 'is_true' }] })), 'CONDITION_OP_INVALID')).toBe(true);
  });

  it('CONDITION_VALUE_INVALID: missing, forbidden, wrong type', () => {
    expect(has(run(setWhen({ all: [{ field: 'monto', op: 'gt' }] })), 'CONDITION_VALUE_INVALID')).toBe(true);
    expect(has(run(setWhen({ all: [{ field: 'monto', op: 'gt', value: 'abc' }] })), 'CONDITION_VALUE_INVALID')).toBe(true);
    expect(has(run(setWhen({ all: [{ field: 'monto', op: 'is_empty', value: 1 }] })), 'CONDITION_VALUE_INVALID')).toBe(true);
    expect(has(run(setWhen({ all: [{ field: 'proveedor', op: 'in', value: 'a' }] })), 'CONDITION_VALUE_INVALID')).toBe(true);
    expect(has(run(setWhen({ all: [{ field: 'proveedor', op: 'in', value: ['a', 'b'] }] })), 'CONDITION_VALUE_INVALID')).toBe(false);
  });

  it('date values must be YYYY-MM-DD', () => {
    const mk = (value: any) => (d: any) => {
      d.fields.push({ key: 'fecha', type: 'date', label: 'Fecha' });
      stage(d, 'jefe').transitions[0].when = { all: [{ field: 'fecha', op: 'gte', value }] };
    };
    expect(has(run(mk('2026-13-45')), 'CONDITION_VALUE_INVALID')).toBe(true);
    expect(has(run(mk('05/11/2026')), 'CONDITION_VALUE_INVALID')).toBe(true);
    expect(has(run(mk('2026-11-05')), 'CONDITION_VALUE_INVALID')).toBe(false);
  });

  it('CONDITION_TOO_DEEP beyond depth 3, nested within is fine', () => {
    const leaf = { field: 'monto', op: 'gt', value: 1 };
    const d3 = { all: [{ any: [{ all: [leaf] }] }] };
    const d4 = { all: [{ any: [{ all: [{ any: [leaf] }] }] }] };
    expect(run(setWhen(d3)).valid).toBe(true);
    expect(has(run(setWhen(d4)), 'CONDITION_TOO_DEEP')).toBe(true);
  });

  it('LIMIT_EXCEEDED on more than 30 rules in a condition', () => {
    const rules = Array.from({ length: 31 }, () => ({ field: 'monto', op: 'gt', value: 1 }));
    expect(has(run(setWhen({ all: rules })), 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('visible_when references declared fields, not itself', () => {
    const ok = run((d) => (d.fields[2].visible_when = { all: [{ field: 'monto', op: 'gt', value: 5 }] }));
    expect(ok.valid).toBe(true);
    const self = run((d) => (d.fields[2].visible_when = { all: [{ field: 'cotizacion', op: 'is_empty' }] }));
    expect(has(self, 'FIELD_UNKNOWN')).toBe(true);
    const unk = run((d) => (d.fields[2].visible_when = { all: [{ field: 'zz', op: 'is_empty' }] }));
    expect(has(unk, 'FIELD_UNKNOWN')).toBe(true);
  });

  it('form.fields reference declared fields without duplicates', () => {
    expect(has(run((d) => (stage(d, 'solicitud').form.fields.push('zz')), undefined), 'FIELD_UNKNOWN')).toBe(true);
    expect(has(run((d) => (stage(d, 'solicitud').form.fields.push('monto'))), 'DUPLICATE_KEY')).toBe(true);
  });

  it('select fields need options; file-only props rejected elsewhere', () => {
    expect(has(run((d) => d.fields.push({ key: 's', type: 'select', label: 'S' })), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (d.fields[0].accept = ['image/*'])), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (d.fields[2].max_size_mb = 99)), 'SHAPE_INVALID')).toBe(true);
  });
});

describe('validateWorkflowDefinition — actions and requirements', () => {
  it('ACTION_UNKNOWN outside the whitelist', () => {
    const r = run((d) => stage(d, 'rechazada').on_enter.push({ action: 'http_call', url: 'x' }));
    expect(has(r, 'ACTION_UNKNOWN')).toBe(true);
  });

  it('notify message length and set_field field', () => {
    expect(has(run((d) => (stage(d, 'rechazada').on_enter[0].message = 'x'.repeat(501))), 'SHAPE_INVALID')).toBe(true);
    expect(has(run((d) => (stage(d, 'rechazada').on_enter[0].message = '')), 'SHAPE_INVALID')).toBe(true);
    expect(
      has(run((d) => stage(d, 'rechazada').on_exit = [{ action: 'set_field', field: 'zz', value: 1 }]), 'FIELD_UNKNOWN'),
    ).toBe(true);
    expect(
      run((d) => (stage(d, 'rechazada').on_exit = [{ action: 'set_field', field: 'proveedor', value: 'x' }])).valid,
    ).toBe(true);
  });

  it('REQUIREMENT_INVALID: unknown kind, signature.of missing', () => {
    expect(
      has(run((d) => stage(d, 'gerente').requirements.push({ kind: 'magic', key: 'm', label: 'M' })), 'REQUIREMENT_INVALID'),
    ).toBe(true);
    expect(
      has(
        run((d) => stage(d, 'gerente').requirements.push({ kind: 'signature', key: 'firma', label: 'Firma', of: 'nada' })),
        'REQUIREMENT_INVALID',
      ),
    ).toBe(true);
  });

  it('file_field must point to a declared file field', () => {
    expect(has(run((d) => (stage(d, 'gerente').requirements[0].field = 'proveedor')), 'FIELD_TYPE_MISMATCH')).toBe(true);
    expect(has(run((d) => (stage(d, 'gerente').requirements[0].field = 'zz')), 'FIELD_UNKNOWN')).toBe(true);
  });

  it('TEMPLATE_NOT_PUBLISHED fails closed; published templates pass; signature of issued_document', () => {
    const mut = (d: any) =>
      stage(d, 'gerente').requirements.push(
        { kind: 'issued_document', key: 'acta', label: 'Acta', template_key: 'acta-compra' },
        { kind: 'signature', key: 'firma', label: 'Firma', of: 'acta' },
      );
    expect(has(run(mut), 'TEMPLATE_NOT_PUBLISHED')).toBe(true);
    expect(has(run(mut, { publishedTemplateKeys: [] }), 'TEMPLATE_NOT_PUBLISHED')).toBe(true);
    expect(has(run(mut, { publishedTemplateKeys: ['otra'] }), 'TEMPLATE_NOT_PUBLISHED')).toBe(true);
    expect(run(mut, { publishedTemplateKeys: ['acta-compra'] }).valid).toBe(true);
  });
});

describe('validateWorkflowDefinition — limits', () => {
  const mkStage = (i: number): WorkflowStageDef => ({
    key: `e${i}`,
    name: `Fin ${i}`,
    type: 'end',
    outcome: 'completed',
  });

  it('LIMIT_EXCEEDED: 61 stages', () => {
    const r = run((d) => {
      for (let i = 0; i < WORKFLOW_LIMITS.maxStages; i++) d.stages.push(mkStage(i));
    });
    expect(has(r, 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('LIMIT_EXCEEDED: 151 fields', () => {
    const r = run((d) => {
      for (let i = 0; i < WORKFLOW_LIMITS.maxFields; i++) d.fields.push({ key: `f${i}`, type: 'text', label: 'F' });
    });
    expect(has(r, 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('LIMIT_EXCEEDED: 21 transitions in a stage', () => {
    const r = run((d) => {
      const t = stage(d, 'gerente').transitions;
      while (t.length < 21) t.push({ to: 'aprobada', on: 'approve' });
    });
    expect(has(r, 'LIMIT_EXCEEDED')).toBe(true);
  });

  it('LIMIT_EXCEEDED: more than 10 actions and 20 requirements', () => {
    expect(
      has(
        run((d) => {
          const a = stage(d, 'rechazada').on_enter;
          while (a.length < 11) a.push({ ...a[0] });
        }),
        'LIMIT_EXCEEDED',
      ),
    ).toBe(true);
    expect(
      has(
        run((d) => {
          const q = stage(d, 'gerente').requirements;
          for (let i = 0; i < 20; i++) q.push({ kind: 'file_field', key: `r${i}`, label: 'R', field: 'cotizacion' });
        }),
        'LIMIT_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('LIMIT_EXCEEDED: JSON over 256 KB', () => {
    const r = run((d) => (d.description = 'x'.repeat(WORKFLOW_LIMITS.maxJsonBytes + 10)));
    expect(has(r, 'LIMIT_EXCEEDED')).toBe(true);
    expect(r.valid).toBe(false);
  });

  it('exactly at the limits is accepted (60 stages)', () => {
    const d = ex();
    // chain 54 extra automatic... use human form stages looping to end
    d.stages = [];
    d.stages.push({
      key: 's0', name: 'S0', type: 'form', start: true, assignee: { kind: 'initiator' },
      transitions: [{ to: 's1', on: 'submit' }],
    });
    for (let i = 1; i < 59; i++)
      d.stages.push({
        key: `s${i}`, name: `S${i}`, type: 'form', assignee: { kind: 'initiator' },
        transitions: [{ to: `s${i + 1}`, on: 'submit' }],
      });
    d.stages.push({ key: 's59', name: 'S59', type: 'end', outcome: 'completed' });
    expect(d.stages).toHaveLength(60);
    d.fields = [];
    expect(validateWorkflowDefinition(d).valid).toBe(true);
  });
});

describe('formatWorkflowIssues', () => {
  it('returns one Spanish line per error', () => {
    const r = run((d) => delete stage(d, 'jefe').assignee);
    const lines = formatWorkflowIssues(r);
    expect(lines).toHaveLength(r.errors.length);
    expect(lines[0]).toContain('La etapa "Aprobación jefe de tienda" no tiene responsable.');
  });

  it('returns nothing for a valid definition', () => {
    expect(formatWorkflowIssues(validateWorkflowDefinition(ex() as WorkflowDefinitionV1))).toEqual([]);
  });
});
