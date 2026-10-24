import { BadRequestException, Injectable } from '@nestjs/common';
import { isHistoricalObjectiveArtifact } from './agent-artifact-safety';
import { AgentObjectiveRepository } from './agent-objective.repository';
import type { AgentToolResult } from './interfaces/agent-objective.interface';

@Injectable()
export class AgentEvidenceService {
  constructor(private readonly objectives: AgentObjectiveRepository) {}

  /** Text and model-authored IDs are not evidence: resolve a stored, owned call artifact. */
  async resolve(
    objectiveId: string,
    reference: string,
    expected?: {
      tool_call_id?: string;
      task_id?: number;
      resource_id?: string | number;
    },
  ): Promise<AgentToolResult> {
    const match = /^agent-result:([a-f0-9-]{36})$/i.exec(reference);
    if (!match)
      throw new BadRequestException(
        'A stored call artifact reference is required',
      );
    const result = await this.objectives.getResult(objectiveId, match[1]);
    if (
      (expected?.tool_call_id &&
        result.tool_call_id !== expected.tool_call_id) ||
      (expected?.task_id !== undefined &&
        result.task_id !== expected.task_id) ||
      (expected?.resource_id !== undefined &&
        !Object.values(result.resource_ids).includes(expected.resource_id))
    )
      throw new BadRequestException('Evidence provenance mismatch');
    return result;
  }

  isObserved(result: AgentToolResult): boolean {
    return (
      !result.stale_lease &&
      !isHistoricalObjectiveArtifact(result.data) &&
      result.receipt.status === 'ok' &&
      result.freshness === 'observed' &&
      Object.keys(result.resource_ids).length > 0
    );
  }
  isCompleteDataset(result: AgentToolResult): boolean {
    return (
      this.isObserved(result) &&
      result.pagination?.complete === true &&
      result.pagination.has_more !== true
    );
  }
}
