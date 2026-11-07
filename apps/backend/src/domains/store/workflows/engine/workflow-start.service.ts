import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WORKFLOW_EVENT_CATALOG,
  WORKFLOW_EVENT_TOKENS,
  WORKFLOW_GATE_OPERATIONS,
  WorkflowDefinitionV1,
  WorkflowEventSpec,
  WorkflowGateOperation,
  WorkflowStageDef,
  gateOperationTokens,
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
import { START_EVENT_TYPES } from './workflow-idempotency';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';
import { WorkflowReferenceService } from './workflow-reference.service';
import { WorkflowStageService } from './workflow-stage.service';

/** Record an event is about, from the registry (P1.1). */
function eventSubject(event: string): { type: string; key: string } | undefined {
  const spec = (WORKFLOW_EVENT_CATALOG as Record<string, WorkflowEventSpec>)[event];
  return spec?.subject;
}

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
      const prev = await this.events.replay(tx, input.idempotencyKey, {
        actor,
        types: START_EVENT_TYPES,
      });
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
    if (subject) await this.assertSubjectInStore(tx, ctx, subject);

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
    const prev = await this.events.replay(tx, input.idempotencyKey, {
      actor: { type: 'public', id: null },
      types: START_EVENT_TYPES,
    });
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
    const prev = await this.events.replay(tx, input.idempotencyKey, {
      actor: { type: 'system', id: null },
      types: START_EVENT_TYPES,
    });
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
    const subjectSpec = eventSubject(input.event);
    const subjectId = subjectSpec ? Number(input.eventContext[subjectSpec.key]) : NaN;
    const subject =
      subjectSpec &&
      definition.subject?.type === subjectSpec.type &&
      Number.isInteger(subjectId) &&
      subjectId > 0
        ? { type: subjectSpec.type, id: subjectId }
        : null;
    return this.createSystemInstance(tx, ctx, {
      def,
      definition,
      stage,
      initial: this.mapInitial(definition, trigger.map, input.eventContext, allowed),
      subject,
      idempotencyKey: input.idempotencyKey,
      started: { via: 'event', event: input.event },
    });
  }

  /**
   * Starts the request of an approval gate (P1.3, actor `system`). Closed path:
   * the gate must be pending without a request yet, and its definition must
   * still be active and still govern the operation; otherwise the caller marks
   * the gate cancelled. The data comes from `governs.map` resolved against the
   * gate context restricted to the operation's tokens; the subject is the held
   * record. The gate gets the instance id in the same transaction.
   */
  async executeGate(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    input: { gateId: number; idempotencyKey: string },
  ): Promise<WorkflowCommandResult | null> {
    const prev = await this.events.replay(tx, input.idempotencyKey, {
      actor: { type: 'system', id: null },
      types: START_EVENT_TYPES,
    });
    if (prev) return prev;
    const gate = await tx.workflow_approval_gates.findFirst({
      where: { id: input.gateId, store_id: ctx.store_id },
    });
    if (!gate || gate.status !== 'pending' || gate.instance_id !== null) return null;
    const def = await tx.workflow_definitions.findFirst({
      where: { id: gate.definition_id, store_id: ctx.store_id },
    });
    if (!def || def.status !== 'active' || !def.published_version_id) return null;
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    const governs = definition.governs;
    const stage = startStage(definition);
    if (
      !governs ||
      governs.operation !== gate.operation ||
      !stage ||
      stage.assignee?.kind === 'initiator'
    ) {
      return null;
    }
    const operation = gate.operation as WorkflowGateOperation;
    const allowed = gateOperationTokens(operation).map((k) => `event.${k}`);
    const context = (gate.context ?? {}) as Record<string, unknown>;
    const subjectType = WORKFLOW_GATE_OPERATIONS[operation].subject;
    const subject =
      subjectType !== 'none' && gate.entity_id > 0
        ? { type: subjectType, id: gate.entity_id }
        : null;
    const result = await this.createSystemInstance(tx, ctx, {
      def,
      definition,
      stage,
      initial: this.mapInitial(definition, governs.map, context, allowed),
      subject,
      idempotencyKey: input.idempotencyKey,
      started: { via: 'approval_gate', operation, gate_id: gate.id },
    });
    const linked = await tx.workflow_approval_gates.updateMany({
      where: { id: gate.id, status: 'pending', instance_id: null },
      data: { instance_id: result.instance.id },
    });
    if (linked.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
    return result;
  }

  /** Declared fields ← `map` templates resolved against a closed context. */
  private mapInitial(
    definition: WorkflowDefinitionV1,
    map: Record<string, string> | undefined,
    context: Record<string, unknown>,
    allowed: string[],
  ): Record<string, unknown> {
    const declared = new Map(definition.fields.map((f) => [f.key, f.type]));
    const initial: Record<string, unknown> = {};
    for (const [fieldKey, template] of Object.entries(map ?? {})) {
      const type = declared.get(fieldKey);
      if (!type) continue;
      const value = coerceMapped(type, resolveTokens(template, { event: context, allowed }));
      if (value !== undefined) initial[fieldKey] = value;
    }
    return initial;
  }

  /** Shared tail of the system starts (event and approval gate). */
  private async createSystemInstance(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    a: {
      def: { id: number; key: string; published_version_id: number | null };
      definition: WorkflowDefinitionV1;
      stage: WorkflowStageDef;
      initial: Record<string, unknown>;
      subject: { type: string; id: number } | null;
      idempotencyKey: string;
      started: Record<string, unknown>;
    },
  ): Promise<WorkflowCommandResult> {
    const actor: WorkflowActor = { type: 'system', id: null };
    const now = new Date();
    const reference = await this.references.next(tx, ctx.store_id);
    const title = a.definition.name.slice(0, 200);
    const enter = this.stages.applyActions(a.stage.on_enter, a.initial, {
      reference,
      title,
      subject_id: a.subject?.id ?? null,
    });
    const patch = this.stages.stagePatch(a.stage, now, 0);

    const created = (await tx.workflow_instances.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id,
        definition_id: a.def.id,
        version_id: a.def.published_version_id,
        reference,
        title,
        data: enter.data,
        subject_type: a.subject?.type ?? null,
        subject_id: a.subject?.id ?? null,
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
      to_stage_key: a.stage.key,
      actor,
      payload: {
        reference,
        definition_key: a.def.key,
        version_id: a.def.published_version_id,
        ...a.started,
      },
      idempotencyKey: a.idempotencyKey,
    });
    await this.events.emitWebhook(tx, created, 'workflow.instance.started', {
      title: created.title,
      stage_key: a.stage.key,
      definition_key: a.def.key,
      via: a.started.via,
    });
    await this.stages.afterEnter(tx, {
      definition: a.definition,
      instance: created,
      stage: a.stage,
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
      to_stage_key: a.stage.key,
    };
  }

  /** A subject id from the caller must belong to this store: 404 otherwise. */
  private async assertSubjectInStore(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    subject: { type: string; id?: number | null },
  ) {
    const id = subject.id ?? null;
    if (id === null) return;
    const select = { select: { id: true } };
    let found: unknown = null;
    switch (subject.type) {
      case 'order':
        found = await tx.orders.findFirst({
          where: { id, store_id: ctx.store_id },
          ...select,
        });
        break;
      case 'purchase_order':
        found = await tx.purchase_orders.findFirst({
          where: {
            id,
            organization_id: ctx.organization_id,
            location: { store_id: ctx.store_id },
          },
          ...select,
        });
        break;
      case 'supplier':
        // A supplier without a store is shared across the organization.
        found = await tx.suppliers.findFirst({
          where: {
            id,
            organization_id: ctx.organization_id,
            OR: [{ store_id: null }, { store_id: ctx.store_id }],
          },
          ...select,
        });
        break;
      case 'employee':
        found = await tx.employees.findFirst({
          where: { id, organization_id: ctx.organization_id },
          ...select,
        });
        break;
      case 'customer':
        found = await tx.store_users.findFirst({
          where: { user_id: id, store_id: ctx.store_id },
          ...select,
        });
        break;
      default:
        throw new VendixHttpException(ErrorCodes.WORKFLOW_SUBJECT_NOT_FOUND);
    }
    if (!found) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_SUBJECT_NOT_FOUND);
    }
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
