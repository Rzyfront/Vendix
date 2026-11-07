import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowEventsService } from '../engine/workflow-events.service';
import {
  WorkflowInstanceRow,
  WorkflowNotifyPayload,
  WorkflowTx,
} from '../engine/workflow-engine.types';
import { COMMENTS_IN_DETAIL, WorkflowInstancesService } from './workflow-instances.service';

export const COMMENT_MAX_LENGTH = 2000;
const OPEN = ['open', 'claimed'];
const SEQ_RETRIES = 3;

/** Comments on a request: visible to whoever sees the instance. */
@Injectable()
export class WorkflowCommentsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly instances: WorkflowInstancesService,
    private readonly events: WorkflowEventsService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id };
  }

  /** Last `limit` comments (oldest first); `before_id` pages further back. */
  async list(instanceId: number, opts: { limit?: number; before_id?: number } = {}) {
    const c = this.ctx();
    await this.assertVisible(instanceId);
    const limit = Math.min(100, Math.max(1, opts.limit ?? COMMENTS_IN_DETAIL));
    const rows = await this.prisma.workflow_instance_comments.findMany({
      where: {
        store_id: c.store_id,
        instance_id: instanceId,
        ...(opts.before_id ? { id: { lt: opts.before_id } } : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    const names = await this.authorNames(rows.map((r: any) => r.author_user_id));
    return [...rows].reverse().map((m: any) => this.present(m, names));
  }

  async add(instanceId: number, body: string) {
    const c = this.ctx();
    const text = (body ?? '').trim();
    if (!text || text.length > COMMENT_MAX_LENGTH) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El comentario debe tener entre 1 y ${COMMENT_MAX_LENGTH} caracteres.`,
      );
    }
    await this.assertVisible(instanceId);
    // The event `seq` is a lock: a concurrent writer of the same instance
    // collides as WORKFLOW_STALE; a comment is safe to retry.
    let last: unknown;
    for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
      try {
        const comment = await this.prisma.$transaction((tx: WorkflowTx) =>
          this.insert(tx, c, instanceId, text),
        );
        const names = await this.authorNames([c.user_id]);
        return this.present(comment, names);
      } catch (e) {
        if ((e as { errorCode?: string })?.errorCode !== ErrorCodes.WORKFLOW_STALE.code) throw e;
        last = e;
      }
    }
    throw last;
  }

  private async insert(
    tx: WorkflowTx,
    c: ReturnType<WorkflowCommentsService['ctx']>,
    instanceId: number,
    text: string,
  ) {
    const instance = (await tx.workflow_instances.findFirst({
      where: { id: instanceId, store_id: c.store_id },
    })) as WorkflowInstanceRow | null;
    if (!instance) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const comment = await tx.workflow_instance_comments.create({
      data: {
        organization_id: c.organization_id,
        store_id: c.store_id,
        instance_id: instanceId,
        author_user_id: c.user_id,
        body: text,
      },
    });
    await this.events.append(tx, {
      store_id: c.store_id,
      instance_id: instanceId,
      type: 'comment',
      actor: { type: 'user', id: c.user_id },
      payload: { comment_id: comment.id, excerpt: text.slice(0, 200) },
    });
    const participants = await this.participants(tx, instance, c.user_id);
    if (participants.user_ids.length > 0 || participants.task_ids.length > 0) {
      const payload: WorkflowNotifyPayload = {
        title: `${instance.reference} · ${instance.title}`,
        message: `Nuevo comentario: ${text.slice(0, 140)}`,
        user_ids: participants.user_ids,
        task_ids: participants.task_ids,
        exclude_user_ids: [c.user_id],
      };
      await this.events.enqueue(tx, {
        store_id: c.store_id,
        instance_id: instanceId,
        kind: 'notify',
        payload: payload as unknown as Record<string, unknown>,
      });
    }
    return comment;
  }

  /**
   * Starter, people who held or hold a task and earlier commenters; tasks of
   * the current stage expand at dispatch to the role / group members.
   */
  private async participants(tx: WorkflowTx, instance: WorkflowInstanceRow, author: number) {
    const [tasks, comments] = await Promise.all([
      tx.workflow_tasks.findMany({
        where: { store_id: instance.store_id, instance_id: instance.id },
        select: { id: true, status: true, assignee_user_id: true, completed_by_user_id: true },
      }),
      tx.workflow_instance_comments.findMany({
        where: { store_id: instance.store_id, instance_id: instance.id },
        select: { author_user_id: true },
      }),
    ]);
    const users = new Set<number>();
    if (instance.started_by_type === 'user' && instance.started_by_id) {
      users.add(instance.started_by_id);
    }
    for (const t of tasks) {
      if (t.assignee_user_id) users.add(t.assignee_user_id);
      if (t.completed_by_user_id) users.add(t.completed_by_user_id);
    }
    for (const m of comments) users.add(m.author_user_id);
    users.delete(author);
    return {
      user_ids: [...users],
      task_ids: tasks.filter((t: any) => OPEN.includes(t.status)).map((t: any) => t.id as number),
    };
  }

  private async assertVisible(instanceId: number) {
    if (!(await this.instances.canSee(instanceId))) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    }
  }

  private async authorNames(ids: number[]): Promise<Map<number, string>> {
    const wanted = [...new Set(ids)];
    const out = new Map<number, string>();
    if (!wanted.length) return out;
    const rows = await this.prisma.withoutScope().users.findMany({
      where: { id: { in: wanted } },
      select: { id: true, first_name: true, last_name: true },
    });
    for (const u of rows) out.set(u.id, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim());
    return out;
  }

  private present(m: any, names: Map<number, string>) {
    return {
      id: m.id,
      body: m.body,
      author: { id: m.author_user_id, name: names.get(m.author_user_id) ?? null },
      created_at: m.created_at,
    };
  }
}
