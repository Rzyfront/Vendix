import {
  normalizeToolResult,
  toolReceipt,
} from '../tools/tool-result.normalizer';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AgentObjectiveRepository } from './agent-objective.repository';
import { AgentEvidenceService } from './agent-evidence.service';
import type { AgentToolResult } from './interfaces/agent-objective.interface';

const objectiveId = '00000000-0000-4000-8000-000000000001';
const resultId = '00000000-0000-4000-8000-000000000002';
const reference = `agent-result:${resultId}`;
const result = () =>
  ({
    id: resultId,
    objective_id: objectiveId,
    store_id: 10,
    organization_id: 20,
    user_id: 30,
    tool_call_id: 'call-1',
    task_id: 7,
    tool_name: 'read_product',
    tool_version: '1',
    args_hash: 'a'.repeat(64),
    evidence_refs: [reference],
    lease_generation: 1,
    created_at: new Date('2026-10-17T00:00:00Z'),
    resource_ids: { product_id: 55 },
    receipt: toolReceipt(normalizeToolResult({ id: 55 })),
    freshness: 'observed',
    stale_lease: false,
    pagination: { complete: true, has_more: false },
    data: { id: 55 },
  }) satisfies AgentToolResult;

describe('AgentEvidenceService', () => {
  let getResult: jest.Mock;
  let evidence: AgentEvidenceService;
  beforeEach(() => {
    getResult = jest.fn().mockResolvedValue(result());
    evidence = new AgentEvidenceService({
      getResult,
    } as unknown as AgentObjectiveRepository);
  });
  it('resolves only a persisted artifact linked to owned objective/call/task/resource', async () => {
    expect(
      await evidence.resolve(objectiveId, reference, {
        tool_call_id: 'call-1',
        task_id: 7,
        resource_id: 55,
      }),
    ).toEqual(result());
    expect(getResult).toHaveBeenCalledWith(objectiveId, resultId);
  });
  it.each([
    'Ya quedó creado el producto 55',
    '55',
    'https://example.com/55',
    'agent-result:inventado',
  ])('does not accept invented prose/IDs as proof: %s', async (text) => {
    await expect(evidence.resolve(objectiveId, text)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(getResult).not.toHaveBeenCalled();
  });
  it('preserves the repository indistinguishable foreign-owner/tenant 404', async () => {
    getResult.mockRejectedValue(new NotFoundException('Objective not found'));
    await expect(
      evidence.resolve(objectiveId, reference),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([{ tool_call_id: 'other' }, { task_id: 8 }, { resource_id: 56 }])(
    'rejects mismatched provenance %j',
    async (expected) => {
      await expect(
        evidence.resolve(objectiveId, reference, expected),
      ).rejects.toThrow('provenance');
    },
  );
  it('a call result is not proof when stale, ambiguous or truncated', () => {
    expect(evidence.isObserved(result())).toBe(true);
    expect(evidence.isObserved({ ...result(), stale_lease: true })).toBe(false);
    expect(evidence.isObserved({ ...result(), freshness: 'unknown' })).toBe(
      false,
    );
    expect(evidence.isObserved({ ...result(), freshness: 'truncated' })).toBe(
      false,
    );
    expect(evidence.isObserved({ ...result(), resource_ids: {} })).toBe(false);
    expect(
      evidence.isObserved({
        ...result(),
        receipt: { ...result().receipt, status: 'unknown_effect' },
      }),
    ).toBe(false);
  });
  it.each([
    { artifact: true, reusable_for_write: false },
    { data: { artifact: true } },
    { body: { response: { artifact: true } } },
  ])(
    'historical artifact reread never proves a fresh postcondition: %j',
    (data) => {
      expect(evidence.isObserved({ ...result(), data })).toBe(false);
      expect(evidence.isCompleteDataset({ ...result(), data })).toBe(false);
    },
  );
  it('does not classify a prose substring or unrelated field as an artifact envelope', () => {
    expect(
      evidence.isObserved({
        ...result(),
        data: { note: 'artifact:true', artifact_name: 'report' },
      }),
    ).toBe(true);
  });
  it('a complete artifacts-list page does not make a partial dataset complete', () => {
    expect(evidence.isCompleteDataset(result())).toBe(true);
    expect(
      evidence.isCompleteDataset({
        ...result(),
        pagination: { complete: false, has_more: true, next_cursor: 2 },
      }),
    ).toBe(false);
    expect(evidence.isCompleteDataset({ ...result(), pagination: null })).toBe(
      false,
    );
  });
});
