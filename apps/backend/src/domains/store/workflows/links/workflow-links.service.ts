import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import {
  WORKFLOW_GATE_OPERATIONS,
  WorkflowDefinitionV1,
  WorkflowGateOperation,
  findStage,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { storeAllowsFlows } from '../engine/workflow-industry';

export interface WorkflowLinkInstance {
  id: number;
  reference: string;
  status: string;
  stage_name: string | null;
}

export interface WorkflowLinkGate {
  id: number;
  operation: string;
  operation_label: string;
  status: string;
  reason: string | null;
  amount: string | null;
  created_at: Date;
  resolved_at: Date | null;
  instance: WorkflowLinkInstance | null;
}

export interface WorkflowLinks {
  pending: boolean;
  gates: WorkflowLinkGate[];
  // No `title`: it may carry request data, and any member of the store
  // reads this answer (see the controller).
  instances: Array<WorkflowLinkInstance & { definition_name: string }>;
}

const EMPTY: WorkflowLinks = { pending: false, gates: [], instances: [] };
const MAX_ROWS = 20;

/**
 * P1.4: the requests linked to a Vendix record, for the badge on the record's
 * own screen ("Solicitud FLU-000123 · etapa X"). Read-only and minimal: the
 * reference, status and stage name, never the request data. Stores without
 * the administration industry get an empty answer (the badge renders nothing)
 * instead of a 403, because the record screens exist in every industry.
 */
@Injectable()
export class WorkflowLinksService {
  constructor(private readonly prisma: StorePrismaService) {}

  async forEntity(entityType: string, entityId: number): Promise<WorkflowLinks> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return EMPTY;
    if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, storeId))) {
      return EMPTY;
    }
    const [gates, subjectInstances] = await Promise.all([
      this.prisma.workflow_approval_gates.findMany({
        where: { store_id: storeId, entity_type: entityType, entity_id: entityId },
        orderBy: { id: 'desc' },
        take: MAX_ROWS,
      }),
      this.prisma.workflow_instances.findMany({
        where: { store_id: storeId, subject_type: entityType, subject_id: entityId },
        orderBy: { id: 'desc' },
        take: MAX_ROWS,
        select: {
          id: true,
          reference: true,
          status: true,
          current_stage_key: true,
          version_id: true,
          definition: { select: { name: true } },
        },
      }),
    ]);
    const gateInstanceIds = gates
      .map((g) => g.instance_id)
      .filter((id): id is number => id !== null);
    const gateInstances = gateInstanceIds.length
      ? await this.prisma.workflow_instances.findMany({
          where: { store_id: storeId, id: { in: gateInstanceIds } },
          select: { id: true, reference: true, status: true, current_stage_key: true, version_id: true },
        })
      : [];
    const versionIds = [
      ...new Set([...subjectInstances, ...gateInstances].map((i) => i.version_id)),
    ];
    const versions = versionIds.length
      ? await this.prisma.workflow_versions.findMany({
          where: { store_id: storeId, id: { in: versionIds } },
          select: { id: true, definition: true },
        })
      : [];
    const defByVersion = new Map(
      versions.map((v) => [v.id, v.definition as unknown as WorkflowDefinitionV1]),
    );
    const stageName = (i: { version_id: number; current_stage_key: string }) =>
      findStage(defByVersion.get(i.version_id) as WorkflowDefinitionV1, i.current_stage_key)
        ?.name ?? null;
    const linkOf = (i: {
      id: number;
      reference: string;
      status: string;
      version_id: number;
      current_stage_key: string;
    }): WorkflowLinkInstance => ({
      id: i.id,
      reference: i.reference,
      status: i.status,
      stage_name: stageName(i),
    });
    const byId = new Map(gateInstances.map((i) => [i.id, linkOf(i)]));

    return {
      pending: gates.some((g) => g.status === 'pending'),
      gates: gates.map((g) => ({
        id: g.id,
        operation: g.operation,
        operation_label:
          WORKFLOW_GATE_OPERATIONS[g.operation as WorkflowGateOperation]?.label ??
          g.operation,
        status: g.status,
        reason: g.reason,
        amount: g.amount === null ? null : String(g.amount),
        created_at: g.created_at,
        resolved_at: g.resolved_at,
        instance: g.instance_id === null ? null : (byId.get(g.instance_id) ?? null),
      })),
      instances: subjectInstances.map((i) => ({
        ...linkOf(i),
        definition_name: i.definition?.name ?? '',
      })),
    };
  }
}
