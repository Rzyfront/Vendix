import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WORKFLOW_EVENT_TOKENS,
  WorkflowDefinitionV1,
  WorkflowFieldType,
  WorkflowTriggerEvent,
  resolveTokens,
  resolveTransition,
  startStage,
  validateFormValues,
} from '@common/workflows/contract';
import { DossiersService } from '../../documents/dossiers.service';
import {
  StartPublicWorkflowInput,
  StartSystemWorkflowInput,
  StartWorkflowInput,
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowInstanceRow,
  WorkflowTx,
} from './workflow-engine.types';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';
import { WorkflowReferenceService } from './workflow-reference.service';
import { WorkflowStageService } from './workflow-stage.service';

/** Events that identify a business record the flow can be about. */
const EVENT_SUBJECT: Record<string, { type: string; key: string }> = {
  'order.created': { type: 'order', key: 'order_id' },
  'order.paid': { type: 'order', key: 'order_id' },
  'purchase_order.received': { type: 'purchase_order', key: 'purchase_order_id' },
  'customer.created': { type: 'customer', key: 'customer_id' },
};

/** Event values arrive as strings; coerce to the declared field type or drop. */
function coerceMapped(type: WorkflowFieldType, raw: string): unknown {
  if (raw === '') return undefined;
  switch (type) {
    case 'number':
    case 'money': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'user': {
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    }
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'text':
      return raw.slice(0, 2000);
    case 'textarea':
      return raw.slice(0, 10000);
    case 'email':
    case 'phone':
    case 'date':
    case 'select':
      return raw;
    default:
      return undefined;
  }
}

/** `start` inside the engine transaction. */
@Injectable()
export class WorkflowStartService {
  constructor(
    private readonly loader: WorkflowLoaderService,
    private readonly stages: WorkflowStageService,
    private readonly events: WorkflowEventsService,
    private readonly references: WorkflowReferenceService,
    private readonly dossiers: DossiersService,
    private readonly advancer: WorkflowAdvanceService,
  ) {}

  async execute(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    actor: WorkflowActor,
    input: StartWorkflowInput,
  ): Promise<WorkflowCommandResult> {
    if (input.idempotencyKey) {
      const prev = await this.events.replay(tx, input.idempotencyKey);
      if (prev) return prev;
    }
    const def = await tx.workflow_definitions.findFirst({
      where: input.definitionId
        ? { id: input.definitionId, store_id: ctx.store_id }
        : { key: input.definitionKey, store_id: ctx.store_id },
    });
    if (!def) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    if (def.status !== 'active' || !def.published_version_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    await this.assertMayStart(tx, ctx, definition);
    const stage = startStage(definition);
    if (!stage) throw new VendixHttpException(ErrorCodes.WORKFLOW_STAGE_NOT_FOUND);

    const declared = new Set(definition.fields.map((f) => f.key));
    const initial: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.data ?? {})) {
      if (declared.has(k)) initial[k] = v;
    }
    const now = new Date();
    const reference = await this.references.next(tx, ctx.store_id);
    const title = (input.title?.trim() || definition.name).slice(0, 200);
    const enter = this.stages.applyActions(stage.on_enter, initial, { reference, title });
    const patch = this.stages.stagePatch(stage, now, 0);
    const subject =
      input.subject && input.subject.type !== 'none' ? input.subject : null;

    const created = (await tx.workflow_instances.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id,
        definition_id: def.id,
        version_id: def.published_version_id,
        reference,
        title,
        data: enter.data,
        subject_type: subject?.type ?? null,
        subject_id: subject?.id ?? null,
        started_by_type: actor.type,
        started_by_id: actor.id,
        row_version: 0,
        ...patch,
        status: patch.status ?? 'active',
      },
    })) as WorkflowInstanceRow;

    // One dossier per request, in the same transaction as the instance.
    await this.dossiers.createForInstance(tx, created);
    await this.events.append(tx, {
      store_id: ctx.store_id,
      instance_id: created.id,
      type: 'started',
      to_stage_key: stage.key,
      actor,
      payload: { reference, definition_key: def.key, version_id: def.published_version_id },
      idempotencyKey: input.idempotencyKey ?? null,
    });
    await this.events.emitWebhook(tx, created, 'workflow.instance.started', {
      title: created.title,
      stage_key: stage.key,
      definition_key: def.key,
    });
    await this.stages.afterEnter(tx, {
      definition,
      instance: created,
      stage,
      actor,
      notifies: enter.notifies,
      vendix: enter.vendix,
    });
    return {
      instance: created,
      task: null,
      advanced: true,
      replayed: false,
      from_stage_key: null,
      to_stage_key: stage.key,
    };
  }

  /**
   * Public form submission: starts the instance as actor `public` and completes
   * the start form in the same transaction, so it lands in the next stage. The
   * link is re-verified here (active, not expired, same store and flow), which
   * keeps this path closed to anyone who does not hold a valid link.
   */
  async executePublic(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    input: StartPublicWorkflowInput,
  ): Promise<WorkflowCommandResult> {
    const prev = await this.events.replay(tx, input.idempotencyKey);
    if (prev) return prev;

    const link = await tx.workflow_public_links.findFirst({
      where: {
        id: input.linkId,
        store_id: ctx.store_id,
        definition_id: input.definitionId,
        is_active: true,
      },
    });
    if (!link || (link.expires_at && new Date(link.expires_at).getTime() <= Date.now())) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    }
    const def = await tx.workflow_definitions.findFirst({
      where: { id: input.definitionId, store_id: ctx.store_id },
    });
    if (!def || def.status !== 'active' || !def.published_version_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    }
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    const stage = startStage(definition);
    const trigger = (definition.triggers ?? []).some((t) => t.kind === 'public_form');
    if (!stage || !trigger || stage.type !== 'form') {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    }

    // Public uploads are out of scope: file fields are never accepted here.
    const fileKeys = new Set(
      definition.fields.filter((f) => f.type === 'file').map((f) => f.key),
    );
    const submitted = Object.fromEntries(
      Object.entries(input.values ?? {}).filter(([k]) => !fileKeys.has(k)),
    );
    const form = validateFormValues(definition, stage, submitted);
    if (!form.ok) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_FORM_INVALID, undefined, {
        errors: form.errors,
      });
    }
    const now = new Date();
    const reference = await this.references.next(tx, ctx.store_id);
    const title = `${definition.name} · ${input.contact.name}`.slice(0, 200);
    const enter = this.stages.applyActions(stage.on_enter, form.values, { reference, title });
    const data = enter.data;
    const transition = resolveTransition(stage, 'submit', data, definition.fields);
    if (!transition) throw new VendixHttpException(ErrorCodes.WORKFLOW_NO_TRANSITION);
    if (transition.require_comment) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_COMMENT_REQUIRED);
    }
    const actor: WorkflowActor = { type: 'public', id: null };
    const patch = this.stages.stagePatch(stage, now, 0);
    const created = (await tx.workflow_instances.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id,
        definition_id: def.id,
        version_id: def.published_version_id,
        reference,
        title,
        data,
        started_by_type: actor.type,
        started_by_id: null,
        row_version: 0,
        ...patch,
        status: patch.status ?? 'active',
      },
    })) as WorkflowInstanceRow;
    await this.dossiers.createForInstance(tx, created);
    await this.events.append(tx, {
      store_id: ctx.store_id,
      instance_id: created.id,
      type: 'started',
      to_stage_key: stage.key,
      actor,
      payload: {
        reference,
        definition_key: def.key,
        version_id: def.published_version_id,
        via: 'public_form',
        contact: {
          name: input.contact.name,
          email: input.contact.email ?? null,
          phone: input.contact.phone ?? null,
        },
      },
      idempotencyKey: input.idempotencyKey,
    });
    for (const payload of enter.notifies) {
      await this.events.enqueue(tx, {
        store_id: ctx.store_id,
        instance_id: created.id,
        kind: 'notify',
        payload: payload as unknown as Record<string, unknown>,
      });
    }
    await this.stages.enqueueVendixActions(tx, created, stage.key, enter.vendix);
    await this.events.emitWebhook(tx, created, 'workflow.instance.started', {
      title: created.title,
      stage_key: stage.key,
      definition_key: def.key,
    });
    const updated = await this.advancer.advance({
      tx,
      instance: created,
      definition,
      fromStage: stage,
      toStageKey: transition.to,
      data,
      actor,
      expectedRowVersion: created.row_version,
      runExitHooks: true,
      event: { type: 'submitted', payload: { outcome: 'submit', via: 'public_form' } },
    });
    await tx.workflow_public_links.updateMany({
      where: { id: link.id, store_id: ctx.store_id },
      data: { last_used_at: now },
    });
    return {
      instance: updated,
      task: null,
      advanced: true,
      replayed: false,
      from_stage_key: stage.key,
      to_stage_key: transition.to,
    };
  }

  /**
   * Starts an instance because a business event happened (actor `system`).
   * Closed path: it only works for a store's active definition whose published
   * version declares an `event` trigger for this very event. The data comes
   * from the trigger's `map` resolved against the event context restricted to
   * the event's token catalog; the start form is NOT auto-submitted, the
   * instance waits at the start stage for whoever the stage assigns it to.
   */
  async executeSystem(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    input: StartSystemWorkflowInput,
  ): Promise<WorkflowCommandResult> {
    const prev = await this.events.replay(tx, input.idempotencyKey);
    if (prev) return prev;

    const def = await tx.workflow_definitions.findFirst({
      where: { id: input.definitionId, store_id: ctx.store_id },
    });
    if (!def) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    if (def.status !== 'active' || !def.published_version_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    const trigger = (definition.triggers ?? []).find(
      (t) => t.kind === 'event' && t.event === input.event,
    );
    const stage = startStage(definition);
    if (
      !trigger ||
      trigger.kind !== 'event' ||
      !stage ||
      stage.assignee?.kind === 'initiator'
    ) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }

    const allowed = (WORKFLOW_EVENT_TOKENS[trigger.event as WorkflowTriggerEvent] ?? []).map(
      (k) => `event.${k}`,
    );
    const declared = new Map(definition.fields.map((f) => [f.key, f.type]));
    const initial: Record<string, unknown> = {};
    for (const [fieldKey, template] of Object.entries(trigger.map ?? {})) {
      const type = declared.get(fieldKey);
      if (!type) continue;
      const value = coerceMapped(
        type,
        resolveTokens(template, { event: input.eventContext, allowed }),
      );
      if (value !== undefined) initial[fieldKey] = value;
    }

    const actor: WorkflowActor = { type: 'system', id: null };
    const now = new Date();
    const reference = await this.references.next(tx, ctx.store_id);
    const title = definition.name.slice(0, 200);
    const enter = this.stages.applyActions(stage.on_enter, initial, { reference, title });
    const patch = this.stages.stagePatch(stage, now, 0);
    const subjectSpec = EVENT_SUBJECT[input.event];
    const subjectId = subjectSpec ? Number(input.eventContext[subjectSpec.key]) : NaN;
    const subject =
      subjectSpec &&
      definition.subject?.type === subjectSpec.type &&
      Number.isInteger(subjectId) &&
      subjectId > 0
        ? { type: subjectSpec.type, id: subjectId }
        : null;

    const created = (await tx.workflow_instances.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id,
        definition_id: def.id,
        version_id: def.published_version_id,
        reference,
        title,
        data: enter.data,
        subject_type: subject?.type ?? null,
        subject_id: subject?.id ?? null,
        started_by_type: actor.type,
        started_by_id: null,
        row_version: 0,
        ...patch,
        status: patch.status ?? 'active',
      },
    })) as WorkflowInstanceRow;
    await this.dossiers.createForInstance(tx, created);
    await this.events.append(tx, {
      store_id: ctx.store_id,
      instance_id: created.id,
      type: 'started',
      to_stage_key: stage.key,
      actor,
      payload: {
        reference,
        definition_key: def.key,
        version_id: def.published_version_id,
        via: 'event',
        event: input.event,
      },
      idempotencyKey: input.idempotencyKey,
    });
    await this.events.emitWebhook(tx, created, 'workflow.instance.started', {
      title: created.title,
      stage_key: stage.key,
      definition_key: def.key,
      via: 'event',
    });
    await this.stages.afterEnter(tx, {
      definition,
      instance: created,
      stage,
      actor,
      notifies: enter.notifies,
      vendix: enter.vendix,
    });
    return {
      instance: created,
      task: null,
      advanced: true,
      replayed: false,
      from_stage_key: null,
      to_stage_key: stage.key,
    };
  }

  private async assertMayStart(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    definition: WorkflowDefinitionV1,
  ) {
    const allowed = definition.start_roles ?? [];
    if (allowed.length === 0 || ctx.is_owner || ctx.is_super_admin) return;
    const rows: Array<{
      roles: { name: string; organization_id: number | null } | null;
    }> =
      ctx.user_id === null
        ? []
        : await tx.user_roles.findMany({
            where: {
              user_id: ctx.user_id,
              OR: [{ store_id: ctx.store_id }, { store_id: null }],
            },
            select: {
              roles: { select: { name: true, organization_id: true } },
            },
          });
    // Only system roles or roles of this organization count.
    const holds = rows.some(
      (r) =>
        r.roles &&
        allowed.includes(r.roles.name) &&
        (r.roles.organization_id === null ||
          r.roles.organization_id === ctx.organization_id),
    );
    if (!holds) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_START_FORBIDDEN);
    }
  }
}
