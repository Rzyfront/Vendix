import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { WorkflowAiStepTestDto } from '../dto/workflow-ai-step-test.dto';
import { WorkflowAiService } from '../ai/workflow-ai.service';
import { WorkflowAiStepTestService } from './workflow-ai-step-test.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';

const NOT_FOUND = Object.assign(new Error('not found'), { errorCode: 'WORKFLOW_DEFINITION_NOT_FOUND' });

const definition = {
  schema: 'vendix.workflow/v1',
  key: 'pqr',
  name: 'PQR',
  fields: [
    { key: 'detalle', type: 'textarea', label: 'Detalle' },
    {
      key: 'tipo',
      type: 'select',
      label: 'Tipo',
      options: [
        { value: 'peticion', label: 'Petición' },
        { value: 'queja', label: 'Queja' },
      ],
    },
  ],
  stages: [
    {
      key: 'inicio', name: 'Inicio', type: 'form', start: true,
      assignee: { kind: 'initiator' }, form: { fields: ['detalle'] },
      transitions: [{ to: 'ia', on: 'submit' }],
    },
    {
      key: 'ia', name: 'Clasificar', type: 'ai',
      ai: { task: 'classify', instructions: 'Clasifica.', inputs: ['detalle'], outputs: ['tipo'] },
      transitions: [{ to: 'fin', on: 'auto' }],
    },
    { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
  ],
} as unknown as WorkflowDefinitionV1;

const defs = { getDraft: jest.fn(), export: jest.fn() };
const gateway = { run: jest.fn() };
const service = new WorkflowAiStepTestService(
  defs as unknown as WorkflowDefinitionsService,
  gateway as unknown as WorkflowAiService,
);
const dto = (stage_key: string, data: Record<string, unknown>) =>
  ({ stage_key, data }) as WorkflowAiStepTestDto;
const ok = (values: Record<string, unknown>) => ({
  status: 'success',
  content: '{}',
  json: { values, confidence: 0.8, reason: 'Parece una queja.' },
  model: 'modelo-x',
  tokens: { prompt: 20, completion: 10, total: 30 },
});

describe('WorkflowAiStepTestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defs.getDraft.mockResolvedValue({ id: 5, key: 'pqr', definition });
  });

  it('hace una llamada real con propósito ai_step_test y devuelve lo que escribiría el paso', async () => {
    gateway.run.mockResolvedValue(ok({ tipo: 'queja' }));
    const r = await service.test(5, dto('ia', { detalle: 'Me cobraron dos veces' }));
    expect(r).toEqual({
      status: 'success',
      values: { tipo: 'queja' },
      confidence: 0.8,
      reason: 'Parece una queja.',
      model: 'modelo-x',
      tokens: 30,
    });
    expect(gateway.run).toHaveBeenCalledTimes(1);
    const call = gateway.run.mock.calls[0][0];
    expect(call).toMatchObject({ appKey: 'workflow_ai_step', purpose: 'ai_step_test', definitionId: 5, stageKey: 'ia' });
    expect(JSON.parse(call.messages[0].content).inputs.detalle.value).toBe('Me cobraron dos veces');
  });

  it('sin borrador usa la versión publicada', async () => {
    defs.getDraft.mockResolvedValue({ id: 5, key: 'pqr', definition: null });
    defs.export.mockResolvedValue({ source: 'published', version: 2, definition });
    gateway.run.mockResolvedValue(ok({ tipo: 'peticion' }));
    const r = await service.test(5, dto('ia', {}));
    expect(r.status).toBe('success');
  });

  it('un id ajeno es 404 y no llama a la IA', async () => {
    defs.getDraft.mockRejectedValue(NOT_FOUND);
    await expect(service.test(99, dto('ia', {}))).rejects.toBe(NOT_FOUND);
    expect(gateway.run).not.toHaveBeenCalled();
  });

  it('una etapa que no es de IA (o no existe) es WORKFLOW_AI_STAGE_INVALID', async () => {
    for (const key of ['inicio', 'nope']) {
      await expect(service.test(5, dto(key, {}))).rejects.toMatchObject({ errorCode: 'WORKFLOW_AI_STAGE_INVALID' });
    }
    defs.getDraft.mockResolvedValue({ id: 5, key: 'pqr', definition: null });
    defs.export.mockResolvedValue({ source: 'draft', version: null, definition: null });
    await expect(service.test(5, dto('ia', {}))).rejects.toMatchObject({ errorCode: 'WORKFLOW_AI_STAGE_INVALID' });
    expect(gateway.run).not.toHaveBeenCalled();
  });

  it('datos inválidos (clave no declarada, valor no escalar, demasiado grande) son WORKFLOW_AI_TEST_INVALID', async () => {
    for (const data of [
      { otro: 'x' },
      { detalle: { a: 1 } },
      { detalle: 'x'.repeat(20_001) },
    ]) {
      await expect(service.test(5, dto('ia', data))).rejects.toMatchObject({ errorCode: 'WORKFLOW_AI_TEST_INVALID' });
    }
    expect(gateway.run).not.toHaveBeenCalled();
  });

  it('sin cupo: skipped_quota con mensaje en español', async () => {
    gateway.run.mockResolvedValue({ status: 'skipped_quota', quota: { state: 'blocked' } });
    expect(await service.test(5, dto('ia', {}))).toEqual({
      status: 'skipped_quota',
      message: 'La IA no se ejecutó: el plan no tiene cupo de IA',
    });
  });

  it('falla del proveedor: failed con mensaje', async () => {
    gateway.run.mockResolvedValue({ status: 'failed', error: 'timeout', code: null, retryable: true });
    expect(await service.test(5, dto('ia', {}))).toEqual({
      status: 'failed',
      message: 'La IA no respondió tras varios intentos',
    });
  });

  it('respuesta fuera de las opciones: invalid_output con los tokens gastados', async () => {
    gateway.run.mockResolvedValue(ok({ tipo: 'sugerencia' }));
    expect(await service.test(5, dto('ia', {}))).toEqual({
      status: 'invalid_output',
      message: 'La respuesta de la IA no fue válida',
      tokens: 30,
    });
  });

  it('la ruta exige store:workflows:design', () => {
    const handler = WorkflowDefinitionsController.prototype.testAiStep;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['store:workflows:design']);
  });
});
