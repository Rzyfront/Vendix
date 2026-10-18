import { ProceduralMemoryService } from '../memory/procedural-memory.service';
import { Optional, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RequestContextService } from '../../common/context/request-context.service';
import { canonicalJson } from '../../domains/store/vexi/vexi-confirmation.service';
import { PlaybookLoaderService } from '../playbooks/playbook-loader.service';
import type {
  PlaybookDocument,
  PlaybookObservation,
  PlaybookStep,
} from '../playbooks/playbook.interface';
import {
  PLAYBOOK_VERIFIERS,
  verifyPlaybook,
} from '../playbooks/playbook-verifiers';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import type { ToolExecutionResult } from '../tools/interfaces/tool.interface';
import { isHistoricalObjectiveArtifact } from './agent-artifact-safety';
import { agentDeadlineContext } from './agent-deadline';
import {
  AgentDurableSession,
  objectiveArgsHash,
} from './agent-durable-session.service';
import { robustExecutionEnabled } from './agent-execution-flags';
import {
  AgentObjectiveRepository,
  requireObjectiveScope,
} from './agent-objective.repository';
import {
  agentVerificationContractsHash,
  issueAgentVerification,
  type AgentVerificationCapability,
} from './agent-verification-capability';
import type {
  AgentEffect,
  AgentToolResult,
  ObjectiveScope,
} from './interfaces/agent-objective.interface';
import { durableObjectivesEnabled } from './interfaces/agent-objective.interface';

type Data = Record<string, unknown>;
const record = (v: unknown): Data =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {};
const same = (a: unknown, b: unknown): boolean =>
  a != null && b != null && String(a) === String(b);
const proposalHash = (tool: string, args: Data): string =>
  createHash('sha256')
    .update(`${tool}|${canonicalJson(args)}`)
    .digest('hex');
const MAX_RESULT_SCAN = 500;
const MAX_PREFLIGHT_AGE_MS = 5 * 60_000;
const MAX_VERIFICATION_READ_AGE_MS = 30_000;
// C's stock projection contains quantities/product names but no location/variant
// IDs or causal movement reference. A correct quantity is not that missing proof.
const WORKFLOW_GAPS: Readonly<Record<string, string>> = Object.freeze({
  'recibir-compra': 'inventory_movement_identity',
  'trasladar-inventario': 'inventory_movement_identity',
  'devolucion-reembolso': 'refund_operation_identity',
  'venta-cobro': 'sale_payment_stock_identity',
});

/** A release-owned observation plan, not model-selected tools/endpoints/predicates. */
const READ_STEPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'reponer-inventario': ['stock', 'supplier', 'verify'],
  'facturar-venta': ['order-verify', 'verify'],
  'cerrar-caja': ['verify'],
  'compra-proveedor': ['verify'],
  'recibir-compra': ['stock', 'verify'],
  'pagar-proveedor': ['verify'],
  'crear-cliente': ['verify'],
  'venta-cobro': ['verify'],
  'cobrar-cartera': ['verify'],
  'trasladar-inventario': ['stock', 'verify'],
  'devolucion-reembolso': ['verify'],
  'registrar-gasto': ['verify'],
  'ruta-despacho': ['verify'],
  'reserva-servicio': ['verify'],
  'cambio-precios': ['verify'],
  'cierre-contable': ['balance', 'verify'],
  'nomina-periodo': ['verify'],
  'reporte-ventas-margen': ['verify', 'export'],
});

export interface AgentVerificationRequest {
  workflow_key: string;
  /** Plan's fixed deliverable/step identity, not a playbook observation step. */
  step_id: string;
  inputs: Data;
  /** Optional selectors. Every ref is resolved and causally validated server-side. */
  evidence_refs?: Record<string, string>;
}
export interface AgentVerificationOptions {
  /** The loop's CURRENT offered/catalog/agent/plan/subscription guard. Fail closed. */
  assertToolAllowed: (tool: string, args: Data) => boolean | Promise<boolean>;
  /** Preserve the loop's existing per-success quota/event policy for these internal reads. */
  onRead?: (
    result: ToolExecutionResult,
    meta: {
      tool_name: string;
      call_id: string;
      artifact_id: string;
      arguments: Data;
    },
  ) => Promise<void>;
}
export interface AgentVerificationCoverage {
  tool_name: string;
  workflow_keys: string[];
  verifier_ids: string[];
  gap?: { code: 'unsupported_capability'; module: string; action: string };
}
export type AgentVerificationResult =
  | {
      verified: false;
      reasons: string[];
      evidence_refs: string[];
    }
  | {
      verified: true;
      reference: string;
      evidence_refs: string[];
      capability: AgentVerificationCapability;
    };

class VerificationRefusal extends Error {}
/** A domain predicate actually ran on fresh observations; malformed requests/permission errors are NOT recipe failures. */
class RecipePostconditionFailure extends VerificationRefusal {}
function refusePostcondition(reason: string): never {
  throw new RecipePostconditionFailure(reason);
}
function refuse(reason: string): never {
  throw new VerificationRefusal(reason);
}

function payload(value: unknown): Data {
  let data = record(value);
  for (let n = 0; n < 4; n++) {
    if (data.success === false || data.error || data.ok === false) return {};
    if (record(data.data) !== data.data) break;
    if (
      data.success === true ||
      Object.keys(data).every((k) =>
        ['data', 'message', 'statusCode'].includes(k),
      )
    )
      data = record(data.data);
    else break;
  }
  return data;
}

/** Reject incomplete transport pages even if their final page happens to contain an ID. */
function complete(
  value: unknown,
  result: Pick<ToolExecutionResult, 'pagination' | 'freshness'>,
): boolean {
  if (result.freshness !== 'observed') return false;
  if (
    result.pagination &&
    (!result.pagination.complete ||
      result.pagination.has_more === true ||
      result.pagination.next_cursor != null)
  )
    return false;
  let data = record(value);
  for (let n = 0; n < 5; n++) {
    if (
      data.truncated === true ||
      data.complete === false ||
      data.has_more === true ||
      data.hay_mas === true ||
      data.next_cursor != null ||
      data.nextCursor != null ||
      data.cursor != null ||
      Number(data.offset ?? 0) > 0 ||
      Number(data.page ?? 1) > 1 ||
      Object.entries(data).some(
        ([key, count]) =>
          /(?:^|_)(?:omitted|omitidos|omitidas)$/.test(key) &&
          Number(count) > 0,
      ) ||
      data.reusable_for_write === false
    )
      return false;
    const page = record(data.pagination);
    if (
      page.complete === false ||
      page.has_more === true ||
      page.next_cursor != null
    )
      return false;
    const meta = record(data.meta);
    if (
      Number(meta.total_pages ?? meta.totalPages ?? 1) > 1 ||
      Number(meta.total ?? 0) > Number(meta.limit ?? Infinity)
    )
      return false;
    if (!data.data || Array.isArray(data.data)) break;
    data = record(data.data);
  }
  return true;
}

function assertOwned(
  row: ObjectiveScope & { objective_id?: string },
  scope: ObjectiveScope,
  objectiveId: string,
): void {
  if (
    row.store_id !== scope.store_id ||
    row.organization_id !== scope.organization_id ||
    row.user_id !== scope.user_id ||
    (row.objective_id !== undefined && row.objective_id !== objectiveId)
  )
    throw new NotFoundException('Objective not found');
}

/** Uses only release templates, explicit request inputs and trusted receipt IDs. */
function resolveArguments(
  step: PlaybookStep,
  inputs: Data,
  observations: Map<string, PlaybookObservation>,
): Data {
  function resolve(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolve(v)]),
      );
    if (typeof value !== 'string') return value;
    const symbol =
      /\$\{(inputs|steps)\.([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_-]+))?\}/g;
    const lookup = (
      _all: string,
      source: string,
      key: string,
      field?: string,
    ): unknown => {
      const found =
        source === 'inputs'
          ? inputs[key]
          : observations.get(key)?.resource_ids[field ?? ''];
      if (
        found === undefined ||
        found === null ||
        (typeof found === 'string' && !found.length)
      )
        refuse(`missing_input:${source}.${key}${field ? `.${field}` : ''}`);
      return found;
    };
    const exact =
      /^\$\{(inputs|steps)\.([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_-]+))?\}$/.exec(
        value,
      );
    if (exact) return lookup(exact[0], exact[1], exact[2], exact[3]);
    return value.replace(symbol, (...matches: unknown[]) => {
      const found = lookup(
        matches[0] as string,
        matches[1] as string,
        matches[2] as string,
        matches[3] as string | undefined,
      );
      // All embedded placeholders are a single URL path segment, never a path/query injection.
      if (
        !['string', 'number'].includes(typeof found) ||
        !/^[a-zA-Z0-9_-]+$/.test(String(found))
      )
        refuse('unsafe_path_identity');
      return String(found);
    });
  }
  return record(resolve(step.arguments ?? {}));
}

/** Known domain projections only; never infer resource identity from prose or requested IDs. */
function projectedIds(
  tool: string,
  data: unknown,
  args: Data,
  initial: Record<string, string | number>,
): Record<string, string | number> {
  const d = payload(data);
  const ids = { ...initial };
  const add = (key: string, id: unknown) => {
    if (
      (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
      (typeof id === 'string' && id.length > 0)
    ) {
      if (ids[key] !== undefined && !same(ids[key], id))
        refuse('resource_identity_mismatch');
      ids[key] = id;
    }
  };
  switch (tool) {
    case 'get_invoice_status':
    case 'get_emit_readiness':
      add('invoice_id', d.invoice_id);
      break;
    case 'get_order':
      add('order_id', record(d.orden).order_id);
      break;
    case 'get_purchase_order':
      add('purchase_order_id', record(d.orden).purchase_order_id);
      break;
    case 'get_receivable':
      add('receivable_id', d.id);
      break;
    case 'get_payable':
      add('payable_id', d.id);
      break;
    case 'get_expense':
      add('expense_id', d.id);
      break;
    case 'get_payroll_run':
      add('payroll_run_id', d.id);
      break;
    case 'get_product_pricing':
      add('product_id', record(d.product).product_id);
      break;
    case 'get_booking':
      add('booking_id', record(d.reserva).booking_id);
      break;
    case 'list_dispatch_routes':
      add('route_id', record(d.planilla).route_id);
      break;
    case 'lookup_customer':
      if (Array.isArray(d.customers) && d.customers.length === 1)
        add('customer_id', record(d.customers[0]).customer_id);
      break;
    case 'list_fiscal_periods':
      if (Array.isArray(d.periods))
        add(
          'fiscal_period_id',
          record(
            d.periods.find((p) => same(record(p).id, args.fiscal_period_id)),
          ).id,
        );
      break;
    case 'call_endpoint':
      if (args.path === `store/cash-registers/sessions/${d.id}`)
        add('session_id', d.id);
      if (args.path === `store/stock-transfers/${d.id}`)
        add('transfer_id', d.id);
      if (args.path === `store/orders/return-orders/${d.id}`)
        add('return_order_id', d.id);
      break;
  }
  return ids;
}

@Injectable()
export class AgentVerifierService {
  constructor(
    private readonly registry: AIToolRegistry,
    private readonly repository: AgentObjectiveRepository,
    private readonly playbooks: PlaybookLoaderService,
    @Optional() private readonly proceduralMemory?: ProceduralMemoryService,
  ) {}

  /** Metadata only. Coverage is NOT permission, execution, or proof of a completed workflow. */
  coverage(authorizedToolNames: string[]): AgentVerificationCoverage[] {
    const release = this.playbooks.getPlaybooks();
    return [...new Set(authorizedToolNames)].map((name) => {
      const tool_name = this.registry.canonicalName(name);
      const tool = this.registry.get(tool_name);
      const documents = release.filter(
        (d) =>
          d.contract.mode === 'executable' &&
          READ_STEPS[d.metadata.workflow_key] &&
          !WORKFLOW_GAPS[d.metadata.workflow_key] &&
          d.metadata.tool_contracts.some(
            (c) =>
              c.name === tool_name &&
              c.version === this.registry.getToolVersion(tool_name),
          ) &&
          d.metadata.verifier_ids.every((id) => !!PLAYBOOK_VERIFIERS[id]),
      );
      // A generic bridge name covers no arbitrary route. Only fixed release paths are mapped.
      return {
        tool_name,
        workflow_keys: documents.map((d) => d.metadata.workflow_key),
        verifier_ids: documents.flatMap((d) => d.metadata.verifier_ids),
        ...(!documents.length ||
        ['call_endpoint', 'write_endpoint'].includes(tool_name)
          ? {
              gap: {
                code: 'unsupported_capability' as const,
                module: tool?.domain ?? 'unknown',
                action: ['call_endpoint', 'write_endpoint'].includes(tool_name)
                  ? `${tool_name}:unmapped_routes`
                  : tool_name,
              },
            }
          : {}),
      };
    });
  }

  verify(
    session: AgentDurableSession,
    request: AgentVerificationRequest,
    options: AgentVerificationOptions,
  ): Promise<AgentVerificationResult> {
    return this.verifyBatch(session, [request], options, request.step_id);
  }

  /** One proof at the FINAL version; earlier per-deliverable proofs never authorize closure. */
  verifyMany(
    session: AgentDurableSession,
    requests: AgentVerificationRequest[],
    options: AgentVerificationOptions,
  ): Promise<AgentVerificationResult> {
    return this.verifyBatch(session, requests, options, 'objective');
  }

  private async verifyBatch(
    session: AgentDurableSession,
    requests: AgentVerificationRequest[],
    options: AgentVerificationOptions,
    stepId: string,
  ): Promise<AgentVerificationResult> {
    const refs: string[] = [];
    const liveReads: number[] = [];
    let activeWorkflow: string | undefined;
    if (!robustExecutionEnabled() || !durableObjectivesEnabled())
      return {
        verified: false,
        reasons: ['robust_verification_disabled'],
        evidence_refs: [],
      };
    try {
      if (
        !requests.length ||
        requests.length > 20 ||
        typeof options?.assertToolAllowed !== 'function'
      )
        refuse('verification_contract_required');
      const scope = requireObjectiveScope();
      assertOwned(session.objective, scope, session.objective_id);
      if (new Set(requests.map((r) => r.step_id)).size !== requests.length)
        refuse('duplicate_deliverable_identity');
      await session.assertCurrent();
      const release = this.playbooks.getPlaybooks();
      for (const request of requests) {
        if (
          !request ||
          !/^[a-zA-Z0-9:_-]{1,200}$/.test(request.step_id ?? '') ||
          !request.inputs ||
          Array.isArray(request.inputs) ||
          typeof request.inputs !== 'object' ||
          Buffer.byteLength(JSON.stringify(request.inputs), 'utf8') > 64_000
        )
          refuse('invalid_verification_contract');
        const document = release.find(
          (d) => d.metadata.workflow_key === request.workflow_key,
        );
        if (!document || !PLAYBOOK_VERIFIERS[document.metadata.verifier_ids[0]])
          refuse('unsupported_capability:workflow_verifier');
        if (document.contract.mode !== 'executable')
          refuse('unsupported_capability:preparation_only');
        if (!READ_STEPS[request.workflow_key])
          refuse('unsupported_capability:workflow_verifier');
        const pin = session.playbook_pins.find((p) => p.id === document.id);
        if (
          pin &&
          (pin.hash !== document.hash ||
            pin.version !== document.metadata.version)
        )
          refuse('stale_playbook_contract');
        for (const input of document.contract.inputs)
          if (input.required && request.inputs[input.key] == null)
            refuse(`missing_input:${input.key}`);
        activeWorkflow = request.workflow_key;
        await this.verifyWorkflow(
          session,
          request,
          document,
          options,
          scope,
          refs,
          liveReads,
        );
      }
      agentDeadlineContext.getStore()?.assertCanStart();
      await session.accountRuntime();
      await session.assertCurrent();
      agentDeadlineContext.getStore()?.assertCanStart();
      if (
        !liveReads.length ||
        liveReads.some((at) => Date.now() - at >= MAX_VERIFICATION_READ_AGE_MS)
      )
        refuse('verification_reads_expired');
      const evidence_refs = [...new Set(refs)];
      const capability = issueAgentVerification({
        ...scope,
        objective_id: session.objective_id,
        step_id: stepId,
        version: session.lease.version,
        lease_generation: session.lease.lease_generation,
        evidence_refs,
        workflows: requests.map((r) => r.workflow_key),
        verified_at: new Date().toISOString(),
        contracts_hash: agentVerificationContractsHash(requests),
      });
      return {
        verified: true,
        reference: evidence_refs[evidence_refs.length - 1],
        evidence_refs,
        capability,
      };
    } catch (error) {
      // Authorization/ownership remains indistinguishable 404; never leak foreign IDs.
      if (error instanceof NotFoundException) throw error;
      if (error instanceof RecipePostconditionFailure && activeWorkflow)
        try {
          await this.proceduralMemory?.verifierFailed(session.objective_id, [
            activeWorkflow,
          ]);
        } catch {
          /* Preserve verifier failure; F is optional. */
        }
      return {
        verified: false,
        reasons: [
          error instanceof VerificationRefusal
            ? error.message
            : 'verification_unavailable_or_stale',
        ],
        evidence_refs: refs,
      };
    }
  }

  private async verifyWorkflow(
    session: AgentDurableSession,
    request: AgentVerificationRequest,
    document: PlaybookDocument,
    options: AgentVerificationOptions,
    scope: ObjectiveScope,
    refs: string[],
    liveReads: number[],
  ): Promise<void> {
    if (['devolucion-reembolso', 'venta-cobro'].includes(request.workflow_key))
      refuse(`unsupported_capability:${WORKFLOW_GAPS[request.workflow_key]}`);
    const observations = new Map<string, PlaybookObservation>();
    const writes = document.contract.steps.filter(
      (s) => s.approval === 'individual',
    );
    const effects = await this.repository.listEffects(
      session.objective_id,
      100,
    );
    if (effects.length === 100) refuse('incomplete_effect_ledger');
    for (const effect of effects) {
      assertOwned(effect, scope, session.objective_id);
      if (
        ['proposed', 'approved', 'applying', 'unknown'].includes(effect.status)
      )
        refuse('pending_or_uncertain_effect');
    }
    const needsScan =
      writes.some((s) => !request.evidence_refs?.[s.id]) ||
      (request.workflow_key === 'facturar-venta' &&
        !request.evidence_refs?.preflight);
    const stored = needsScan
      ? await this.scanResults(session.objective_id)
      : [];
    const matched: AgentEffect[] = [];
    for (const step of writes) {
      if (!step.tool) refuse('unsupported_capability:write_contract');
      const args = resolveArguments(step, request.inputs, observations);
      await this.assertTool(
        session,
        step.tool,
        args,
        document,
        options,
        scope,
        false,
      );
      const hash = proposalHash(step.tool, args);
      const candidates = effects.filter(
        (e) =>
          e.proposal_hash === hash &&
          ['applied', 'verified'].includes(e.status),
      );
      if (candidates.length !== 1)
        refuse(`unique_applied_effect_required:${step.id}`);
      const effect = candidates[0];
      const selected = request.evidence_refs?.[step.id];
      const found = selected
        ? await this.resolveReference(session.objective_id, selected)
        : stored.find(
            (r) => r.tool_call_id === `effect:${effect.operation_id}`,
          );
      if (!found) refuse(`successful_effect_receipt_required:${step.id}`);
      const row = found.data_omitted
        ? await this.repository.getResult(session.objective_id, found.id)
        : found;
      this.assertResult(row, session.objective_id, scope);
      if (
        row.tool_name !== step.tool ||
        row.tool_version !== this.registry.getToolVersion(step.tool) ||
        ![hash, objectiveArgsHash(args)].includes(row.args_hash) ||
        row.receipt.effect_status !== 'applied' ||
        row.tool_call_id !== `effect:${effect.operation_id}` ||
        new Date(row.created_at).getTime() <
          new Date(effect.updated_at).getTime()
      )
        refuse(`effect_provenance_mismatch:${step.id}`);
      const ledgerIds = record(effect.domain_receipt?.resource_ids);
      if (
        !effect.domain_reference ||
        !Object.keys(ledgerIds).length ||
        !Object.entries(ledgerIds).every(([key, id]) =>
          same(row.resource_ids[key], id),
        ) ||
        !Object.values(row.resource_ids).some((id) =>
          same(id, effect.domain_reference),
        )
      )
        refuse(`effect_identity_mismatch:${step.id}`);
      for (const [key, id] of Object.entries(row.resource_ids))
        if (request.inputs[key] !== undefined && !same(request.inputs[key], id))
          refuse(`effect_input_identity_mismatch:${key}`);
      if (
        ['pagar-proveedor', 'cobrar-cartera'].includes(request.workflow_key) &&
        !same(row.resource_ids.payment_id, request.inputs.payment_id)
      )
        refuse('unsupported_capability:payment_operation_identity');
      if (
        matched.length &&
        new Date(row.created_at).getTime() <
          new Date(matched[matched.length - 1].updated_at).getTime()
      )
        refuse('effect_order_mismatch');
      matched.push(effect);
      observations.set(step.id, {
        step_id: step.id,
        tool: step.tool,
        status: 'ok',
        fresh: true,
        complete: true,
        arguments: args,
        resource_ids: row.resource_ids,
        data: row.data,
      });
      refs.push(`agent-result:${row.id}`);
    }
    // Readiness is a pre-write condition: querying an already accepted invoice is not emittable.
    if (request.workflow_key === 'facturar-venta') {
      const step = document.contract.steps.find((s) => s.id === 'preflight')!;
      const args = resolveArguments(step, request.inputs, observations);
      await this.assertTool(
        session,
        step.tool!,
        args,
        document,
        options,
        scope,
        true,
      );
      const selected = request.evidence_refs?.preflight;
      const found = selected
        ? await this.resolveReference(session.objective_id, selected)
        : [...stored]
            .reverse()
            .find(
              (r) =>
                r.tool_name === step.tool &&
                r.args_hash === objectiveArgsHash(args) &&
                new Date(r.created_at).getTime() <=
                  new Date(matched[matched.length - 1].created_at).getTime(),
            );
      if (!found) refuse('preflight_evidence_required');
      const row = found.data_omitted
        ? await this.repository.getResult(session.objective_id, found.id)
        : found;
      this.assertResult(row, session.objective_id, scope);
      if (
        row.tool_name !== step.tool ||
        row.args_hash !== objectiveArgsHash(args) ||
        row.receipt.effect_status !== 'not_applicable' ||
        row.tool_version !== this.registry.getToolVersion(step.tool!) ||
        Date.now() - new Date(row.created_at).getTime() >
          MAX_PREFLIGHT_AGE_MS ||
        new Date(row.created_at).getTime() <
          new Date(matched[matched.length - 2].updated_at).getTime() ||
        new Date(row.created_at).getTime() >
          new Date(matched[matched.length - 1].created_at).getTime()
      )
        refuse('preflight_evidence_stale_or_mismatched');
      observations.set('preflight', {
        step_id: 'preflight',
        tool: step.tool!,
        status: 'ok',
        fresh: true,
        complete: true,
        arguments: args,
        resource_ids: row.resource_ids,
        data: row.data,
      });
      refs.push(`agent-result:${row.id}`);
    }
    const after = writes[writes.length - 1]?.id;
    for (const id of READ_STEPS[request.workflow_key]) {
      if (id === 'export' && request.inputs.export_requested !== true) continue;
      if (id === 'supplier' && !request.inputs.supplier_query) continue;
      const step = document.contract.steps.find((s) => s.id === id);
      if (!step?.tool) refuse(`unsupported_capability:read_contract:${id}`);
      const args = resolveArguments(step, request.inputs, observations);
      await this.assertTool(
        session,
        step.tool,
        args,
        document,
        options,
        scope,
        true,
      );
      const deadline = agentDeadlineContext.getStore();
      deadline?.assertCanStart();
      await session.assertBudget();
      const callId = `verify:${randomUUID()}`;
      const sourceContext = RequestContextService.asyncLocalStorage.getStore();
      if (!sourceContext) refuse('explicit_verification_context_required');
      const auditContext = {
        ...sourceContext,
        permissions: [...(sourceContext.permissions ?? [])],
        roles: [...(sourceContext.roles ?? [])],
      };
      let auditedLate = false;
      const auditLate = async (result: ToolExecutionResult): Promise<void> => {
        if (auditedLate) return;
        auditedLate = true;
        try {
          // No live checkpoint preceded this audit: count the actual dispatch
          // once, but its stale/unknown receipt can never authorize completion.
          await RequestContextService.runIsolated(auditContext, () =>
            session.auditTool(
              `late:${callId}`,
              step.tool!,
              args,
              {
                ...result,
                freshness: 'unknown',
                effect_status: 'not_applicable',
                evidence_refs: [],
              },
              this.registry.getToolVersion(step.tool!),
              true,
            ),
          );
        } catch {
          // Failed audit availability never re-enables a cancelled checkpoint.
        }
      };
      const invoke = async (): Promise<ToolExecutionResult> => {
        const result = await session.runTool(() =>
          this.registry.executeToolResult(step.tool!, args),
        );
        try {
          // The outer plan-tool deadline race is NOT enough: its abandoned
          // continuation used to checkpoint this value after cancellation.
          deadline?.assertCanStart();
          return result;
        } catch (error) {
          await auditLate(result);
          throw error;
        }
      };
      const read = deadline ? await deadline.run(invoke) : await invoke();
      const observedAt = Date.now();
      try {
        deadline?.assertCanStart();
        await session.assertCurrent();
        deadline?.assertCanStart();
      } catch (error) {
        await auditLate(read);
        throw error;
      }
      // Persist every completed read, including failures, but stale executors cannot advance.
      const resultId = await session.checkpointTool(
        callId,
        step.tool,
        args,
        read,
        this.registry.getToolVersion(step.tool),
      );
      refs.push(`agent-result:${resultId}`);
      await options.onRead?.(read, {
        tool_name: step.tool,
        call_id: callId,
        artifact_id: resultId,
        arguments: structuredClone(args),
      });
      deadline?.assertCanStart();
      this.assertRead(read);
      liveReads.push(observedAt);
      const ids = projectedIds(
        step.tool,
        read.data,
        { ...args, fiscal_period_id: request.inputs.fiscal_period_id },
        read.resource_ids,
      );
      for (const [key, value] of Object.entries(ids))
        if (
          request.inputs[key] !== undefined &&
          !same(value, request.inputs[key])
        )
          refuse(`resource_identity_mismatch:${key}`);
      observations.set(id, {
        step_id: id,
        tool: step.tool,
        status: 'ok',
        fresh: true,
        complete: true,
        arguments: args,
        resource_ids: ids,
        data: read.data,
        ...(after ? { after_step: after } : {}),
        ...(step.bridge
          ? { bridge: { method: step.bridge.method, path: String(args.path) } }
          : {}),
      });
    }
    const result = verifyPlaybook(
      document.metadata.verifier_ids[0],
      request.inputs,
      [...observations.values()],
    );
    if (!result.verified || result.scope !== 'domain')
      refusePostcondition(
        result.reasons.join(',') || 'preparation_is_not_business_completion',
      );
    // C's predicates are intentionally narrow. Close known projection gaps
    // before D2 turns those observations into authority for an entire workflow.
    const final = payload(observations.get('verify')?.data);
    if (request.workflow_key === 'compra-proveedor') {
      const expected = request.inputs.items;
      const actual = record(final.orden).lineas;
      // These are the REAL DTO/read keys. No amount/tax/cost recalculation: the
      // domain owns those economics; D2 only proves the requested line identities.
      const key = (line: unknown, input: boolean): string => {
        const row = record(line);
        const product = row.product_id;
        const variant = input ? row.product_variant_id : row.variant_id;
        const quantity = input ? row.quantity : row.ordered;
        if (
          !Number.isSafeInteger(Number(product)) ||
          Number(product) <= 0 ||
          !Number.isSafeInteger(Number(quantity)) ||
          Number(quantity) <= 0 ||
          (variant != null &&
            (!Number.isSafeInteger(Number(variant)) || Number(variant) <= 0))
        )
          refuse('unsupported_capability:order_lines_identity');
        return canonicalJson([
          Number(product),
          variant == null ? null : Number(variant),
          Number(quantity),
        ]);
      };
      if (
        !Array.isArray(expected) ||
        !expected.length ||
        !Array.isArray(actual) ||
        !actual.length
      )
        refuse('unsupported_capability:order_lines_identity');
      if (
        canonicalJson(expected.map((line) => key(line, true)).sort()) !==
        canonicalJson(actual.map((line) => key(line, false)).sort())
      )
        refusePostcondition('purchase_order_lines_mismatch');
    }
    if (request.workflow_key === 'reponer-inventario') {
      if (request.inputs.product_variant_id != null)
        refuse('unsupported_capability:variant_stock_identity');
      const main = record(final.bodega_principal);
      const other = final.otras_bodegas;
      if (!('bodega_principal' in final) || !Array.isArray(other))
        refuse('sourcing_quantities_required');
      const locations = [
        ...(final.bodega_principal === null ? [] : [main]),
        ...other.map(record),
      ];
      if (
        locations.some(
          (l) =>
            !Number.isSafeInteger(Number(l.id)) ||
            Number(l.id) < 1 ||
            l.quantity_available == null ||
            !Number.isFinite(Number(l.quantity_available)) ||
            Number(l.quantity_available) < 0,
        ) ||
        new Set(locations.map((l) => String(l.id))).size !== locations.length
      )
        refuse('sourcing_location_identity_required');
      const mainAvailable =
        final.bodega_principal === null ? 0 : Number(main.quantity_available);
      const total =
        mainAvailable +
        other.reduce<number>(
          (sum, l) => sum + Number(record(l).quantity_available),
          0,
        );
      const expected =
        mainAvailable >= Number(request.inputs.quantity)
          ? 'available'
          : total >= Number(request.inputs.quantity)
            ? 'transfer'
            : 'purchase';
      if (final.sugerencia !== expected)
        refusePostcondition('sourcing_quantity_postcondition_mismatch');
    }
    if (request.workflow_key === 'crear-cliente') {
      const customer = record(
        Array.isArray(final.customers) ? final.customers[0] : undefined,
      );
      const expectedDocument = [
        request.inputs.document_type,
        request.inputs.documento,
      ]
        .filter((v) => v != null && v !== '')
        .join(' ');
      if (String(customer.document ?? '').trim() !== expectedDocument.trim())
        refusePostcondition('customer_document_identity_mismatch');
    }
    if (
      request.workflow_key === 'cambio-precios' &&
      request.inputs.product_variant_id != null
    )
      refuse('unsupported_capability:variant_price_identity');
    // C intentionally supports partial receipt. D2 never represents it as fully received.
    if (request.workflow_key === 'recibir-compra') {
      const po = record(payload(observations.get('verify')?.data).orden);
      if (
        request.inputs.expected_status !== 'partial' &&
        (po.status !== 'received' ||
          !Array.isArray(po.lineas) ||
          po.lineas.some((line) => Number(record(line).pending) !== 0))
      )
        refusePostcondition('purchase_partially_received');
      if (
        request.inputs.expected_status === 'partial' &&
        po.status !== 'partial'
      )
        refusePostcondition('purchase_expected_status_mismatch');
    }
    if (WORKFLOW_GAPS[request.workflow_key])
      refuse(`unsupported_capability:${WORKFLOW_GAPS[request.workflow_key]}`);
  }

  private async assertTool(
    session: AgentDurableSession,
    name: string,
    args: Data,
    document: PlaybookDocument,
    options: AgentVerificationOptions,
    scope: ObjectiveScope,
    readOnly: boolean,
  ): Promise<void> {
    const current = requireObjectiveScope();
    assertOwned(current, scope, session.objective_id);
    await session.assertCurrent();
    const tool = this.registry.get(name);
    const contract = document.metadata.tool_contracts.find(
      (t) => t.name === name,
    );
    const permissions =
      RequestContextService.asyncLocalStorage.getStore()?.permissions ?? [];
    if (
      !tool ||
      !contract ||
      this.registry.getToolVersion(name) !== contract.version ||
      tool.clientSide ||
      (readOnly && (tool.readOnly !== true || tool.requiresConfirmation)) ||
      !(tool.requiredPermissions ?? []).every(
        (p) =>
          permissions.includes(p) &&
          session.objective.authority_snapshot.includes(p),
      ) ||
      !(await options.assertToolAllowed(name, args))
    )
      refuse(`tool_not_authorized:${name}`);
  }

  private assertRead(result: ToolExecutionResult): void {
    if (
      result.status !== 'ok' ||
      result.effect_status !== 'not_applicable' ||
      isHistoricalObjectiveArtifact(result.data) ||
      !Object.keys(record(result.data)).length ||
      !complete(result.data, result)
    )
      refuse('fresh_complete_domain_read_required');
  }

  private assertResult(
    row: AgentToolResult,
    objectiveId: string,
    scope: ObjectiveScope,
  ): void {
    assertOwned(row, scope, objectiveId);
    const at = new Date(row.created_at).getTime();
    if (
      !Number.isFinite(at) ||
      at > Date.now() ||
      row.stale_lease ||
      row.data_omitted ||
      row.receipt.status !== 'ok' ||
      row.freshness !== 'observed' ||
      isHistoricalObjectiveArtifact(row.data) ||
      !complete(row.data, row)
    )
      refuse('stored_evidence_stale_incomplete_or_ambiguous');
  }

  private async resolveReference(
    objectiveId: string,
    reference: string,
  ): Promise<AgentToolResult> {
    const match = /^agent-result:([a-f0-9-]{36})$/i.exec(reference);
    if (!match) refuse('stored_result_reference_required');
    return this.repository.getResult(objectiveId, match[1]);
  }

  private async scanResults(objectiveId: string): Promise<AgentToolResult[]> {
    const rows: AgentToolResult[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.repository.listResults(objectiveId, {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      rows.push(...page.items);
      if (!page.has_more) return rows;
      if (
        !page.next_cursor ||
        rows.length >= MAX_RESULT_SCAN ||
        page.next_cursor === cursor
      )
        refuse('incomplete_result_history:provide_explicit_refs');
      cursor = page.next_cursor;
    } while (true);
  }
}
