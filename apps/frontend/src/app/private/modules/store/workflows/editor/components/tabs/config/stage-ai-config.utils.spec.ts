import {
  WorkflowAiDef,
  WorkflowFieldDef,
  WorkflowStageDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import {
  AI_TEST_MAX_CHARS,
  aiConfigHints,
  allowedConfidenceFields,
  allowedInputFields,
  allowedOutputFields,
  buildTestData,
  coerceSample,
  confidenceText,
  formatOutputValue,
  isSingleOutputTask,
  testDataSize,
  withAiReview,
  withTask,
} from './stage-ai-config.utils';

const FIELDS: WorkflowFieldDef[] = [
  { key: 'asunto', type: 'text', label: 'Asunto' },
  { key: 'detalle', type: 'textarea', label: 'Detalle' },
  { key: 'adjunto', type: 'file', label: 'Adjunto' },
  { key: 'agente', type: 'user', label: 'Agente' },
  { key: 'tipo', type: 'select', label: 'Tipo', options: [{ value: 'queja', label: 'Queja' }] },
  { key: 'respuesta', type: 'textarea', label: 'Respuesta' },
  { key: 'monto', type: 'money', label: 'Monto' },
  { key: 'confianza', type: 'number', label: 'Confianza' },
  { key: 'total', type: 'number', label: 'Total', compute: 'monto * 2' },
];

function ai(patch: Partial<WorkflowAiDef> = {}): WorkflowAiDef {
  return { task: 'classify', instructions: 'Clasifica', inputs: ['asunto'], outputs: ['tipo'], ...patch };
}

describe('stage-ai-config.utils', () => {
  it('inputs: nunca file ni user, ni los campos que la IA escribe o puntúa', () => {
    const keys = allowedInputFields(FIELDS, ai({ confidence_field: 'confianza' })).map((f) => f.key);
    expect(keys).not.toContain('adjunto');
    expect(keys).not.toContain('agente');
    expect(keys).not.toContain('tipo');
    expect(keys).not.toContain('confianza');
    expect(keys).toContain('detalle');
  });

  it('outputs: filtra por los tipos de la tarea y excluye calculados y de lectura', () => {
    expect(allowedOutputFields(FIELDS, ai({ task: 'classify' })).map((f) => f.key)).toEqual(['tipo']);
    expect(allowedOutputFields(FIELDS, ai({ task: 'draft', inputs: ['detalle'] })).map((f) => f.key)).toEqual([
      'asunto',
      'respuesta',
    ]);
    const extract = allowedOutputFields(FIELDS, ai({ task: 'extract', inputs: ['asunto'] })).map((f) => f.key);
    expect(extract).toContain('monto');
    expect(extract).not.toContain('total');
    expect(extract).not.toContain('asunto');
  });

  it('confianza: solo campos numéricos no calculados y distintos de los que lee y escribe', () => {
    expect(allowedConfidenceFields(FIELDS, ai()).map((f) => f.key)).toEqual(['confianza']);
    expect(allowedConfidenceFields(FIELDS, ai({ inputs: ['confianza'] }))).toEqual([]);
  });

  it('todas las tareas escriben un solo campo menos extraer', () => {
    expect(isSingleOutputTask('classify')).toBeTrue();
    expect(isSingleOutputTask('decide')).toBeTrue();
    expect(isSingleOutputTask('summarize')).toBeTrue();
    expect(isSingleOutputTask('draft')).toBeTrue();
    expect(isSingleOutputTask('extract')).toBeFalse();
  });

  it('cambiar de tarea conserva solo las salidas válidas y recorta a una', () => {
    const base = ai({ task: 'extract', inputs: ['detalle'], outputs: ['tipo', 'monto', 'asunto'] });
    expect(withTask(base, 'classify', FIELDS).outputs).toEqual(['tipo']);
    expect(withTask(base, 'draft', FIELDS).outputs).toEqual(['asunto']);
    expect(withTask(ai({ outputs: ['tipo'] }), 'extract', FIELDS).outputs).toEqual(['tipo']);
    expect(withTask(base, 'draft', FIELDS).inputs).toEqual(['detalle']);
  });

  it('las pistas dicen lo que falta', () => {
    expect(aiConfigHints(ai({ instructions: '  ', inputs: [], outputs: [] }))).toEqual([
      'Escribe las instrucciones del paso.',
      'Elige al menos un campo que la IA lea.',
      'Elige el campo que escribe la IA.',
    ]);
    expect(aiConfigHints(ai({ task: 'extract', outputs: [] }))).toEqual(['Elige al menos un campo que escriba la IA.']);
    expect(aiConfigHints(ai())).toEqual([]);
  });

  it('los datos de prueba salen como escalares y vacío es null', () => {
    const data = buildTestData(FIELDS, ['asunto', 'monto', 'detalle'], { asunto: ' Hola ', monto: '1200.5' });
    expect(data).toEqual({ asunto: 'Hola', monto: 1200.5, detalle: null });
    expect(coerceSample(FIELDS[6], 'abc')).toBeNull();
    expect(coerceSample({ key: 'ok', type: 'boolean', label: 'Ok' }, true)).toBeTrue();
    expect(coerceSample({ key: 'ok', type: 'boolean', label: 'Ok' }, '')).toBeFalse();
  });

  it('mide el tamaño de los datos contra el límite del servidor', () => {
    expect(testDataSize({ a: 'hola', b: 12, c: null })).toBe(6);
    expect(AI_TEST_MAX_CHARS).toBe(20000);
  });

  it('formatea los valores y la confianza del resultado', () => {
    expect(formatOutputValue('')).toBe('(vacío)');
    expect(formatOutputValue(true)).toBe('Sí');
    expect(formatOutputValue(12)).toBe('12');
    expect(confidenceText(0.826)).toBe('83 %');
    expect(confidenceText(null)).toBeNull();
  });

  it('activar la revisión pone responsable y pasa auto a aprobar', () => {
    const stage: WorkflowStageDef = {
      key: 'clasificar',
      name: 'Clasificar',
      type: 'ai',
      ai: ai(),
      transitions: [{ on: 'auto', to: 'fin' }],
    };
    const on = withAiReview(stage, true);
    expect(on.ai?.review).toBeTrue();
    expect(on.assignee).toEqual({ kind: 'initiator' });
    expect(on.transitions).toEqual([{ on: 'approve', to: 'fin' }]);
  });

  it('desactivar la revisión quita responsable y plazo, deja auto y borra rechazar', () => {
    const stage: WorkflowStageDef = {
      key: 'redactar',
      name: 'Redactar',
      type: 'ai',
      ai: ai({ review: true }),
      assignee: { kind: 'initiator' },
      due: { hours: 4 },
      transitions: [
        { on: 'approve', to: 'fin' },
        { on: 'reject', to: 'inicio' },
      ],
    };
    const off = withAiReview(stage, false);
    expect(off.ai?.review).toBeUndefined();
    expect(off.assignee).toBeUndefined();
    expect(off.due).toBeUndefined();
    expect(off.transitions).toEqual([{ on: 'auto', to: 'fin' }]);
  });
});
