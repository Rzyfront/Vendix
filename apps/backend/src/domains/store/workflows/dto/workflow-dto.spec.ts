import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { requireIdempotencyKey } from './idempotency-key';
import {
  CancelWorkflowInstanceDto,
  CompleteWorkflowTaskDto,
  ForceTransitionDto,
  StartWorkflowDto,
  WorkflowInstancesQueryDto,
} from './workflow-instance.dto';
import { CreateWorkflowDefinitionDto, SaveWorkflowDraftDto } from './workflow-definition.dto';
import { CreateWorkGroupDto } from './work-group.dto';

const errorsOf = async (cls: any, plain: object) =>
  (await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

describe('DTOs de Flujos', () => {
  it('start: exige definition_id o definition_key y valida el sujeto', async () => {
    expect(await errorsOf(StartWorkflowDto, {})).toEqual(expect.arrayContaining(['definition_id', 'definition_key']));
    expect(await errorsOf(StartWorkflowDto, { definition_id: 3 })).toEqual([]);
    expect(await errorsOf(StartWorkflowDto, { definition_key: 'purchase', data: { a: 1 } })).toEqual([]);
    expect(await errorsOf(StartWorkflowDto, { definition_id: 3, subject: { type: 'order', id: 'x' } })).toEqual(['subject']);
    expect(await errorsOf(StartWorkflowDto, { definition_id: 3, data: 'texto' })).toEqual(['data']);
    expect(await errorsOf(StartWorkflowDto, { definition_id: 3, extra: 1 })).toEqual(['extra']);
  });

  it('complete: outcome y expected_row_version son obligatorios', async () => {
    expect(await errorsOf(CompleteWorkflowTaskDto, {})).toEqual(expect.arrayContaining(['outcome', 'expected_row_version']));
    expect(await errorsOf(CompleteWorkflowTaskDto, { outcome: 'approve', expected_row_version: 0 })).toEqual([]);
    expect(
      await errorsOf(CompleteWorkflowTaskDto, { outcome: 'submit', values: { a: 1 }, comment: 'ok', expected_row_version: 2 }),
    ).toEqual([]);
    expect(await errorsOf(CompleteWorkflowTaskDto, { outcome: 'approve', expected_row_version: -1 })).toEqual(['expected_row_version']);
    expect(await errorsOf(CompleteWorkflowTaskDto, { outcome: 'approve', expected_row_version: 1, values: [] })).toEqual(['values']);
  });

  it('cancel y force-transition exigen motivo', async () => {
    expect(await errorsOf(CancelWorkflowInstanceDto, { reason: '' })).toEqual(['reason']);
    expect(await errorsOf(CancelWorkflowInstanceDto, { reason: 'duplicada' })).toEqual([]);
    expect(await errorsOf(ForceTransitionDto, { to: 'done' })).toEqual(['reason']);
    expect(await errorsOf(ForceTransitionDto, { to: 'done', reason: 'x', expected_row_version: 1 })).toEqual([]);
  });

  it('consultas y definiciones', async () => {
    expect(await errorsOf(WorkflowInstancesQueryDto, { limit: '500' })).toEqual(['limit']);
    expect(await errorsOf(WorkflowInstancesQueryDto, { limit: '20', overdue: 'true', status: 'active' })).toEqual([]);
    expect(await errorsOf(WorkflowInstancesQueryDto, { status: 'nope' })).toEqual(['status']);
    expect(await errorsOf(CreateWorkflowDefinitionDto, { name: 'x', key: 'Mala Clave' })).toEqual(['key']);
    expect(await errorsOf(SaveWorkflowDraftDto, { definition: [] })).toEqual(['definition']);
    expect(await errorsOf(CreateWorkGroupDto, { key: 'ventas', name: 'Ventas' })).toEqual([]);
  });

  it('Idempotency-Key: obligatorio y de máximo 80 caracteres', () => {
    expect(requireIdempotencyKey('abc')).toBe('abc');
    expect(requireIdempotencyKey('x'.repeat(80))).toHaveLength(80);
    for (const bad of [undefined, '', '   ', 'x'.repeat(81)]) {
      try {
        requireIdempotencyKey(bad);
        throw new Error('should fail');
      } catch (e: any) {
        expect(e.errorCode).toBe('WORKFLOW_IDEMPOTENCY_KEY_REQUIRED');
        expect(e.getStatus()).toBe(400);
      }
    }
  });
});
