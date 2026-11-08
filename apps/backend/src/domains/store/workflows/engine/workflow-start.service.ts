import { Injectable, Optional } from '@nestjs/common';
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
  WORKFLOW_INSTANCE_TOKENS,
  WORKFLOW_LIMITS,
} from '@common/workflows/contract';
import { DossiersService } from '../../documents/dossiers.service';
import {
  StartExternalWorkflowInput,
  StartPublicWorkflowInput,
  StartSystemWorkflowInput,
  StartWorkflowInput,
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowInstanceRow,
  WorkflowTx,
} from './workflow-engine.types';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { START_EVENT_TYPES, systemIdempotencyKey } from './workflow-idempotency';
import { firedGuard } from './workflow-guards';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';
import { heldRoleNames, seesFlow } from '../access/workflow-access.policy';
import { readWorkflowAccess } from '../access/workflow-access.types';
import { WorkflowLimitsService } from '../limits/workflow-limits.service';
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

/**
 * P7.1: how a start counts against the plan's monthly requests. `person` (a
 * user, 402 with the plan details) and `outsider` (public form or inbound
 * webhook, neutral refusal) are refused over the cap; `system` (event,
 * schedule, email, record date) is refused and the owners are told once a
 * month; `exempt` (approval gates, subflow children) counts and never stops.
 */
type StartLimitMode = 'person' | 'outsider' | 'system' | 'exempt';

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
    // Optional so the engine specs that wire the starter by hand keep working;
    // Nest always provides it (WorkflowsModule).
    @Optional() private readonly limits?: WorkflowLimitsService,
  ) {}

  /**
   * P7.1: counts this request in the month, inside the start transaction and
   * right before the instance insert (after every check), so the counter row
   * stays locked as short as possible and rolls back with a failed start.
   * Replays never get here: they return before any write.
   */
  private async countStart(tx: WorkflowTx, ctx: WorkflowCallContext, mode: StartLimitMode): Promise<void> {
    if (!this.limits) return;
    const use = await this.limits.consume(ctx.store_id, 'monthly_instances', {
      tx,
      enforce: mode !== 'exempt',
    });
    if (use.allowed) return;
    if (mode !== 'person') {
      await this.limits.noticeOnce(ctx.store_id, use, mode === 'outsider');
    }
    throw this.limits.refusal(use, mode === 'outsider' ? 'outsider' : 'staff');
  }

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
    const definition = def.published_version_id
      ? await this.loader.loadDefinition(tx, def.published_version_id)
      : null;
    // P7.3: before any other answer, so a hidden flow reads as a missing one.
    await this.assertSeesFlow(tx, ctx, def.access, definition?.start_roles ?? []);
    if (def.status !== 'active' || !definition) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }
    // P2.11: a switched-off flow starts nothing new.
    if (def.is_enabled === false) throw new VendixHttpException(ErrorCodes.WORKFLOW_DISABLED);
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
    if (subject) {
      await this.assertSubjectInStore(tx, ctx, subject, definition.subject?.collection);
    }

    const locationId = input.locationId
      ? await this.storeLocationId(tx, ctx.store_id, input.locationId, true)
      : null;

    await this.countStart(tx, ctx, 'person');
    const created = (await tx.workflow_instances.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id,
        definition_id: def.id,
        version_id: def.published_version_id,
        reference,
        title,
        data: await this.stages.computeFields(definition, enter.data, ctx.store_id),
        subject_type: subject?.type ?? null,
        subject_id: subject?.id ?? null,
        location_id: locationId,
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
    if (
      !def ||
      def.status !== 'active' ||
      !def.published_version_id ||
      def.is_enabled === false
    ) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    }
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    const stage = startStage(definition);
    const trigger = (definition.triggers ?? []).some((t) => t.kind === 'public_form');
    if (!stage || !trigger || stage.type !== 'form') {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_PUBLIC_NOT_FOUND);
    }

    // P3.4: file fields never travel in the values; the caller passes the
    // ones with a completed upload of this link (they join the dossier after
    // the start), and a required one without its upload fails like any field.
    const fileKeys = new Set(
      definition.fields.filter((f) => f.type === 'file').map((f) => f.key),
    );
    const submitted = Object.fromEntries(
      Object.entries(input.values ?? {}).filter(([k]) => !fileKeys.has(k)),
    );
    const uploaded = new Set(input.fileFields ?? []);
    const form = validateFormValues(
      definition,
      {
        ...stage,
        form: stage.form
          ? { ...stage.form, fields: stage.form.fields.filter((k) => !fileKeys.has(k)) }
          : stage.form,
      },
      submitted,
    );
    for (const key of stage.form?.fields ?? []) {
      const f = definition.fields.find((x) => x.key === key);
      if (f?.type === 'file' && f.required && !uploaded.has(key)) {
        form.ok = false;
        form.errors.push({ field: key, message: `El campo "${f.label}" es obligatorio.` });
      }
    }
    if (!form.ok) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_FORM_INVALID, undefined, {
        errors: form.errors,
      });
    }
    const now = new Date();
    const reference = await this.references.next(tx, ctx.store_id);
    const title = `${definition.name} · ${input.contact.name}`.slice(0, 200);
    const enter = this.stages.applyActions(stage.on_enter, form.values, { reference, title });
    const data = await this.stages.computeFields(definition, enter.data, ctx.store_id);
    const guard = firedGuard(stage, 'submit', data, definition.fields);
    if (guard && !guard.redirect_to) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_GUARD_BLOCKED, guard.message);
    }
    const transition = guard?.redirect_to
      ? { to: guard.redirect_to, require_comment: false }
      : resolveTransition(stage, 'submit', data, definition.fields);
    if (!transition) throw new VendixHttpException(ErrorCodes.WORKFLOW_NO_TRANSITION);
    if (transition.require_comment) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_COMMENT_REQUIRED);
    }
    const actor: WorkflowActor = { type: 'public', id: null };
    const patch = this.stages.stagePatch(stage, now, 0);
    await this.countStart(tx, ctx, 'outsider');
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
      resolved: { submitted: true },
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
    if (def.is_enabled === false) throw new VendixHttpException(ErrorCodes.WORKFLOW_DISABLED);
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
      locationId: await this.storeLocationId(
        tx,
        ctx.store_id,
        Number(input.eventContext.location_id),
        false,
      ),
      idempotencyKey: input.idempotencyKey,
      started: { via: 'event', event: input.event },
    });
  }

  /**
   * P3.1 / P3.3 / P3.6: starts an instance from outside Vendix (actor
   * `system`): an inbound webhook, an email to the flow's mailbox or the date
   * of a custom record. Closed path: the store's active, switched-on
   * definition must declare a trigger of that kind (and, for `record_date`,
   * on that field); the start stage cannot belong to "the initiator". Webhook
   * values go through the form rules over every declared non-file field
   * (422 with the field errors); email and record data only reach fields
   * through the trigger `map`. The start form is not auto-submitted.
   */
  async executeExternal(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    input: StartExternalWorkflowInput,
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
    if (def.is_enabled === false) throw new VendixHttpException(ErrorCodes.WORKFLOW_DISABLED);
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    const trigger = (definition.triggers ?? []).find(
      (t) =>
        t.kind === input.kind &&
        (t.kind !== 'record_date' || t.field === input.recordField),
    );
    const stage = startStage(definition);
    if (!trigger || !stage || stage.assignee?.kind === 'initiator') {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }

    let initial: Record<string, unknown> = {};
    if (trigger.kind === 'webhook') {
      const accepted = definition.fields
        .filter((f) => f.type !== 'file' && typeof f.compute !== 'string')
        .map((f) => f.key);
      const form = validateFormValues(
        definition,
        { ...stage, form: { fields: accepted } },
        input.values ?? {},
      );
      if (!form.ok) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_FORM_INVALID, undefined, {
          errors: form.errors,
        });
      }
      initial = form.values;
    } else if (trigger.kind === 'email' || trigger.kind === 'record_date') {
      const root = trigger.kind === 'email' ? 'email' : 'record';
      const context = input.context ?? {};
      const map = Object.fromEntries(
        Object.entries(trigger.map ?? {}).map(([field, template]) => [
          field,
          template.replace(new RegExp(`\\{\\{\\s*${root}\\.`, 'g'), '{{event.'),
        ]),
      );
      initial = this.mapInitial(
        definition,
        map,
        context,
        Object.keys(context).map((k) => `event.${k}`),
      );
    }

    const subject =
      input.subject && definition.subject?.type === input.subject.type
        ? input.subject
        : null;
    if (subject) {
      await this.assertSubjectInStore(tx, ctx, subject, definition.subject?.collection);
    }
    return this.createSystemInstance(tx, ctx, {
      def,
      definition,
      stage,
      initial,
      subject,
      idempotencyKey: input.idempotencyKey,
      started: { ...(input.started ?? {}), via: input.kind },
      title: input.title,
      limit: input.kind === 'webhook' ? 'outsider' : 'system',
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
    if (
      !def ||
      def.status !== 'active' ||
      !def.published_version_id ||
      def.is_enabled === false
    ) {
      return null;
    }
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
      limit: 'exempt',
    });
    const linked = await tx.workflow_approval_gates.updateMany({
      where: { id: gate.id, status: 'pending', instance_id: null },
      data: { instance_id: result.instance.id },
    });
    if (linked.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
    return result;
  }

  /**
   * P2.10: a cron trigger fired for `fireAt` (minute precision). The key makes
   * each fire start exactly one request even with several workers or a replay
   * of the same minute.
   */
  async executeSchedule(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    input: { definitionId: number; cron: string; fireAt: string },
  ): Promise<WorkflowCommandResult | null> {
    const idempotencyKey = systemIdempotencyKey(
      `schedule:${input.definitionId}:${input.fireAt}`,
    );
    const prev = await this.events.replay(tx, idempotencyKey, {
      actor: { type: 'system', id: null },
      types: START_EVENT_TYPES,
    });
    if (prev) return prev;
    const def = await tx.workflow_definitions.findFirst({
      where: { id: input.definitionId, store_id: ctx.store_id },
    });
    if (!def || def.status !== 'active' || !def.published_version_id || def.is_enabled === false) {
      return null;
    }
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    const stage = startStage(definition);
    const declared = (definition.triggers ?? []).some(
      (t) => t.kind === 'schedule' && t.cron === input.cron,
    );
    if (!declared || !stage || stage.assignee?.kind === 'initiator') return null;
    try {
      return await this.createSystemInstance(tx, ctx, {
        def,
        definition,
        stage,
        initial: {},
        subject: null,
        idempotencyKey,
        started: { via: 'schedule', cron: input.cron, fire_at: input.fireAt },
      });
    } catch (e) {
      // P7.1: over the plan's monthly requests the fire simply does not start
      // (the owners were told); nothing was written yet.
      if (e instanceof VendixHttpException && e.errorCode === 'WORKFLOW_PLAN_LIMIT_REACHED') return null;
      throw e;
    }
  }

  /**
   * P2.2: starts child `index` of the parent's subflow stage. Returns the
   * reason when it cannot start (the caller resolves the parent `rejected`);
   * null when the parent already moved on (nothing to do).
   */
  async executeChild(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    input: { parentId: number; stageKey: string; entrySeq: number; index: number },
  ): Promise<
    { started: WorkflowCommandResult; flowKey: string } | { error: string; flowKey: string } | null
  > {
    const idempotencyKey = systemIdempotencyKey(
      `subflow:${input.parentId}:${input.entrySeq}:${input.index}`,
    );
    const prev = await this.events.replay(tx, idempotencyKey, {
      actor: { type: 'system', id: null },
      types: START_EVENT_TYPES,
    });
    if (prev) return { started: prev, flowKey: '' };
    const parent = (await tx.workflow_instances.findFirst({
      where: { id: input.parentId, store_id: ctx.store_id },
    })) as WorkflowInstanceRow | null;
    if (!parent) return null;
    const parentDef = await this.loader.loadDefinition(tx, parent.version_id);
    const subflow = parentDef.stages.find((s) => s.key === input.stageKey)?.subflow;
    // A stage that does not wait moved the parent on in the same batch: its
    // children still start (the idempotency key above prevents duplicates).
    // A waiting stage only starts children while the parent is still there.
    const stillThere =
      parent.status === 'active' &&
      parent.current_stage_key === input.stageKey &&
      parent.stage_entry_seq === input.entrySeq;
    if (!stillThere && (subflow?.wait !== false || parent.stage_entry_seq < input.entrySeq)) {
      return null;
    }
    const child = subflow?.flows[input.index];
    if (!child) return null;
    const fail = (error: string) => ({ error, flowKey: child.flow_key });

    let depth = 1;
    let cursor: number | null | undefined = parent.parent_instance_id;
    while (cursor) {
      depth++;
      if (depth >= WORKFLOW_LIMITS.maxSubflowDepth) {
        return fail(`Se superó el máximo de ${WORKFLOW_LIMITS.maxSubflowDepth} niveles de subflujos.`);
      }
      const up: { parent_instance_id: number | null } | null =
        await tx.workflow_instances.findFirst({
          where: { id: cursor, store_id: ctx.store_id },
          select: { parent_instance_id: true },
        });
      cursor = up?.parent_instance_id ?? null;
    }
    const def = await tx.workflow_definitions.findFirst({
      where: { key: child.flow_key, store_id: ctx.store_id },
    });
    if (!def || def.status !== 'active' || !def.published_version_id) {
      return fail(`El flujo "${child.flow_key}" no está publicado y activo.`);
    }
    if (def.is_enabled === false) return fail(`El flujo "${child.flow_key}" está apagado.`);
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    const stage = startStage(definition);
    if (!stage) return fail(`El flujo "${child.flow_key}" no tiene etapa inicial.`);
    if (stage.assignee?.kind === 'initiator' && parent.started_by_type !== 'user') {
      return fail(
        `La etapa inicial de "${child.flow_key}" es de quien inicia y la solicitud padre no la inició una persona.`,
      );
    }
    const parentTokens = [
      ...parentDef.fields.map((f) => `fields.${f.key}`),
      ...WORKFLOW_INSTANCE_TOKENS,
    ];
    const declared = new Map(definition.fields.map((f) => [f.key, f.type]));
    const initial: Record<string, unknown> = {};
    for (const [fieldKey, template] of Object.entries(child.map ?? {})) {
      const type = declared.get(fieldKey);
      if (!type) continue;
      const value = coerceMapped(
        type,
        resolveTokens(template, {
          fields: parent.data ?? {},
          instance: {
            reference: parent.reference,
            title: parent.title,
            subject_id: parent.subject_id,
          },
          allowed: parentTokens,
        }),
      );
      if (value !== undefined) initial[fieldKey] = value;
    }
    const started = await this.createSystemInstance(tx, ctx, {
      def,
      definition,
      stage,
      initial,
      subject: null,
      idempotencyKey,
      started: {
        via: 'subflow',
        parent_id: parent.id,
        parent_reference: parent.reference,
      },
      startedBy: { type: parent.started_by_type, id: parent.started_by_id },
      parent: { id: parent.id, stage_key: input.stageKey, entry_seq: input.entrySeq },
      limit: 'exempt',
    });
    return { started, flowKey: child.flow_key };
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

  /**
   * A branch of this very store. `strict` (manual start) rejects a foreign or
   * unknown id; otherwise (event context) it quietly yields `null`.
   */
  private async storeLocationId(
    tx: WorkflowTx,
    storeId: number,
    id: number,
    strict: boolean,
  ): Promise<number | null> {
    if (Number.isInteger(id) && id > 0) {
      const row = await tx.inventory_locations.findFirst({
        where: { id, store_id: storeId },
        select: { id: true },
      });
      if (row) return row.id as number;
    }
    if (strict) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    return null;
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
      /** P5.5: branch of the request (already checked against the store). */
      locationId?: number | null;
      idempotencyKey: string;
      started: Record<string, unknown>;
      /** P3: title given by the caller (default: the flow name). */
      title?: string;
      /** P2.2: a child keeps the parent's starter, so `initiator` still means someone. */
      startedBy?: { type: WorkflowActor['type']; id: number | null };
      parent?: { id: number; stage_key: string; entry_seq: number };
      /** P7.1: how the start counts against the plan (default `system`). */
      limit?: StartLimitMode;
    },
  ): Promise<WorkflowCommandResult> {
    const actor: WorkflowActor = { type: 'system', id: null };
    const now = new Date();
    const reference = await this.references.next(tx, ctx.store_id);
    const title = (a.title?.trim() || a.definition.name).slice(0, 200);
    const enter = this.stages.applyActions(a.stage.on_enter, a.initial, {
      reference,
      title,
      subject_id: a.subject?.id ?? null,
    });
    const patch = this.stages.stagePatch(a.stage, now, 0);

    await this.countStart(tx, ctx, a.limit ?? 'system');
    const created = (await tx.workflow_instances.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id,
        definition_id: a.def.id,
        version_id: a.def.published_version_id,
        reference,
        title,
        data: await this.stages.computeFields(a.definition, enter.data, ctx.store_id),
        subject_type: a.subject?.type ?? null,
        subject_id: a.subject?.id ?? null,
        location_id: a.locationId ?? null,
        started_by_type: a.startedBy?.type ?? actor.type,
        started_by_id: a.startedBy?.id ?? null,
        ...(a.parent
          ? {
              parent_instance_id: a.parent.id,
              parent_stage_key: a.parent.stage_key,
              parent_entry_seq: a.parent.entry_seq,
            }
          : {}),
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
    /** P3.6: a custom record must belong to the flow's collection. */
    collection?: string,
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
      case 'custom_record':
        found = collection
          ? await tx.workflow_records.findFirst({
              where: {
                id,
                store_id: ctx.store_id,
                archived_at: null,
                collection: { key: collection, store_id: ctx.store_id },
              },
              ...select,
            })
          : null;
        break;
      default:
        throw new VendixHttpException(ErrorCodes.WORKFLOW_SUBJECT_NOT_FOUND);
    }
    if (!found) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_SUBJECT_NOT_FOUND);
    }
  }

  /**
   * "Quién ve" of the flow (P7.3) for a person starting it: the same rule as
   * `WorkflowAccessPolicy`, read inside the start transaction. Owner,
   * superadmin and `store:workflows:manage` pass; calls without a user are
   * not restricted.
   */
  private async assertSeesFlow(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    rawAccess: unknown,
    startRoles: readonly string[],
  ) {
    const access = readWorkflowAccess(rawAccess);
    if (!access || ctx.user_id === null) return;
    if (ctx.is_owner || ctx.is_super_admin || ctx.permissions.includes('store:workflows:manage')) {
      return;
    }
    const roles = await heldRoleNames(tx, ctx.user_id, ctx.store_id, ctx.organization_id);
    if (!seesFlow(access, startRoles, ctx.user_id, roles)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
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
