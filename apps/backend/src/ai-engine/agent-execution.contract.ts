import type { AgentResult } from './ai-agent.service';
import type { AIStreamChunk } from './interfaces/ai-provider.interface';
import type { ObjectiveProgress } from './tasks/interfaces/agent-objective.interface';
import type {
  AgentExecutionSummary,
  ToolExecutionReceipt,
} from './tools/interfaces/tool.interface';
import {
  normalizeToolResult,
  toolReceipt,
} from './tools/tool-result.normalizer';

/**
 * Texto para la persona, nunca para el modelo. Las `next_action` de recibos,
 * de la política de recuperación y del objetivo durable, y los `next_step` de
 * las tools (incluidos los comandos `ui_*` del navegador: «Cuéntale…»,
 * «Dile…»), son instrucciones internas: viajan al modelo y a la metadata,
 * jamás al chat, a `ai_messages.content` ni a la voz.
 *
 * Lista blanca, no lista negra: el texto visible sale SOLO de la prosa del
 * modelo o de este catálogo cerrado. Ninguna cadena de un recibo se muestra,
 * aunque parezca humana.
 */
export const USER_NOTICES = {
  unknown_effect:
    'No pude confirmar si el cambio quedó aplicado. Lo reviso en el registro antes de intentarlo otra vez. No repetiré el cambio.',
  blocked:
    'Parte de lo que pediste no está disponible con tu usuario o con tu plan actual; un administrador puede revisar esos permisos.',
  failed:
    'No pude obtener respuesta del sistema en este momento. Pídemelo de nuevo en un momento y lo intento otra vez.',
  read_failed:
    'No pude consultar toda la información que necesitaba en este momento. Pídemelo de nuevo y lo intento otra vez.',
  exhausted:
    'No alcancé a terminar en este turno. Si quieres, sigo desde donde quedé.',
  pending_confirmation:
    'Revisa y aprueba la propuesta; todavía no se aplicó ese cambio.',
  needs_user_input: 'Indícame el dato que falta para continuar.',
  write_pending_verification:
    'Ya hice el cambio; si quieres, reviso que haya quedado bien registrado.',
  apply_failed:
    'No se pudo aplicar el cambio. Revisa los datos e inténtalo de nuevo.',
  verified: 'Verifiqué en el sistema que los cambios quedaron registrados.',
  stopped:
    'La respuesta se detuvo. El avance se conserva; verifica los cambios en curso antes de volver a intentarlos.',
  // Último recurso: el modelo no produjo texto ni tras la inferencia de cierre.
  // Habla como la tienda, no como un auditor («evidencia», «registro»).
  no_answer:
    'Esta vez no logré armar la respuesta. ¿Me lo pides de nuevo? Si quieres, dímelo con otras palabras y lo intento otra vez.',
} as const;

/** Detalle de un paso del rastro: catálogo cerrado, nunca la nota del recibo. */
export const USER_TOOL_NOTES = {
  staged: 'Preparando la consulta.',
  unavailable: 'Paso no disponible en este asistente; sigo con otra vía.',
  blocked: 'Sin acceso con tu usuario o plan actual.',
  unknown_effect: 'No se pudo confirmar el resultado.',
  pending_confirmation: 'Esperando tu aprobación.',
  needs_user_input: 'Falta un dato para continuar.',
  failed: 'No se pudo consultar este dato.',
} as const;

/**
 * An authorized tool outside the routed top-K, staged for the next inference.
 * Like BATCH_NOT_DISPATCHED it never ran: it is not a failed query.
 */
export const TOOL_STAGED_CODE = 'AI_AGENT_TOOL_STAGED';
const NOT_EXECUTED = new Set([TOOL_STAGED_CODE, 'BATCH_NOT_DISPATCHED']);

/**
 * A call to a name outside the turn's authority: hallucinated, or denied to
 * THIS agent. It is a model mistake the model corrects (recoverable), never a
 * «tu usuario o tu plan» notice — real 401/403 and subscription codes are the
 * only `blocked` receipts.
 */
export const TOOL_NOT_ALLOWED_CODE = 'AI_AGENT_TOOL_NOT_ALLOWED';
export const TOOL_NOT_AVAILABLE_NEXT_STEP =
  'Esa herramienta no existe para este asistente. Usa solo las herramientas de tu catálogo actual; si ninguna sirve, responde con lo que sí sabes sin mencionar herramientas.';
/**
 * Model-facing guidance for a non-existent/unauthorized name with the real
 * authorized alternatives the router already loaded (D4). The user-facing
 * summary stays {@link TOOL_NOT_AVAILABLE_NEXT_STEP}.
 */
export function toolNotAvailableWithAlternatives(
  alternatives: readonly string[],
): string {
  return alternatives.length
    ? `Ese paso no está disponible con ese nombre. Herramientas reales que ya quedaron cargadas para lo mismo: ${alternatives.join(', ')}. Llama la adecuada en tu siguiente respuesta; si ninguna sirve, responde con lo que sí sabes sin mencionar herramientas.`
    : TOOL_NOT_AVAILABLE_NEXT_STEP;
}
const notExecuted = (r: ToolExecutionReceipt) =>
  NOT_EXECUTED.has(r.error_code ?? '');

/**
 * Detector para graders y specs (gate `noJargon`). NO es un filtro de salida:
 * lo visible se decide por lista blanca ({@link USER_NOTICES}), no por esta
 * regex.
 */
export const INTERNAL_JARGON =
  /postcondici|search_tools|playbook|objetivo original|conservo el avance|\bschema\b|preflight|fingerprint|\blease\b|checkpoint|recuperaci[oó]n t[eé]cnica|\(interno\)|AI_AGENT_|inferencia|agent-result:|tool_call:|next_step|next_action/i;

function appendNotice(content: string, notice: string): string {
  if (!content) return notice;
  return content.includes(notice) ? content : `${content}\n\n${notice}`;
}

/**
 * Trace row text. A non-ok row is always a catalog line; an ok row keeps its
 * data preview unless it carries the receipt's model instruction.
 */
export function userToolSummary(
  receipt: ToolExecutionReceipt,
  summary: string | undefined,
): string | undefined {
  if (notExecuted(receipt)) return USER_TOOL_NOTES.staged;
  if (receipt.error_code === TOOL_NOT_ALLOWED_CODE)
    return USER_TOOL_NOTES.unavailable;
  switch (receipt.status) {
    case 'ok':
      return summary &&
        ((receipt.next_action && summary.includes(receipt.next_action)) ||
          /"next_(step|action)"/.test(summary))
        ? undefined
        : summary;
    case 'blocked':
      return USER_TOOL_NOTES.blocked;
    case 'unknown_effect':
      return USER_TOOL_NOTES.unknown_effect;
    case 'pending_confirmation':
      return USER_TOOL_NOTES.pending_confirmation;
    case 'needs_user_input':
      return USER_TOOL_NOTES.needs_user_input;
    default:
      return USER_TOOL_NOTES.failed;
  }
}

/**
 * Text for a turn the model never closed. Human only: it never concatenates a
 * receipt's `next_action` (model instruction) nor raw resource ids.
 */
export function describeIncompleteExecution(
  receipts: ToolExecutionReceipt[],
  userNotice: string,
): string {
  const observed = receipts.some(
    (r) => r.status === 'ok' && r.freshness === 'observed',
  );
  return (
    (observed ? 'Alcancé a consultar parte de la información. ' : '') +
    userNotice
  );
}

/** Receipt for runtime scaffolding that answered (e.g. `search_tools`). */
export function observedReceipt(): ToolExecutionReceipt {
  return {
    schema_version: '1',
    status: 'ok',
    error_code: null,
    retryable: false,
    next_action: null,
    evidence_refs: [],
    resource_ids: {},
    pagination: null,
    freshness: 'observed',
    effect_status: 'not_applicable',
  };
}

/*
 * Client boundary. `next_action` (receipts and turn summary) and the
 * objective's `next_step` are instructions for the MODEL. They stay intact in
 * the AgentResult the runtime and the durable session consume, and are
 * stripped from everything serialized to a client: SSE frames, the POST
 * response and the message metadata the frontend reads back.
 */
export function clientSafeReceipt(
  receipt: ToolExecutionReceipt,
): ToolExecutionReceipt {
  const { next_action: _internal, ...rest } = receipt;
  // The key is omitted, not nulled: the client contract has no such field.
  return rest as ToolExecutionReceipt;
}

export function clientSafeExecution(
  execution: AgentExecutionSummary,
): AgentExecutionSummary {
  const { next_action: _internal, ...rest } = execution;
  return rest as AgentExecutionSummary;
}

export function clientSafeObjective(
  objective: ObjectiveProgress,
): ObjectiveProgress {
  return { ...objective, next_step: null };
}

export function clientSafeChunk(chunk: AIStreamChunk): AIStreamChunk {
  if (!chunk.execution && !chunk.objective && !chunk.tool?.execution)
    return chunk;
  return {
    ...chunk,
    ...(chunk.execution
      ? { execution: clientSafeExecution(chunk.execution) }
      : {}),
    ...(chunk.objective
      ? { objective: clientSafeObjective(chunk.objective) }
      : {}),
    ...(chunk.tool?.execution
      ? {
          tool: {
            ...chunk.tool,
            execution: clientSafeReceipt(chunk.tool.execution),
          },
        }
      : {}),
  };
}

/** Maps every yielded frame through `clientSafeChunk`; the return value is untouched. */
export async function* clientSafeStream(
  source: AsyncGenerator<AIStreamChunk, AgentResult>,
): AsyncGenerator<AIStreamChunk, AgentResult> {
  let completed = false;
  try {
    let step = await source.next();
    while (!step.done) {
      let input: unknown;
      try {
        input = yield clientSafeChunk(step.value);
      } catch (error) {
        step = await source.throw(error);
        continue;
      }
      step = await source.next(input);
    }
    completed = true;
    return step.value;
  } finally {
    if (!completed) await source.return(undefined as never);
  }
}

function terminalOutcome(
  result: AgentResult,
  critical?: ToolExecutionReceipt,
): AgentExecutionSummary['outcome'] {
  if (result.aborted) return 'cancelled';
  if (result.pending_confirmation || result.pending_plan)
    return 'pending_confirmation';
  if (result.awaiting_input) return 'needs_user_input';
  if (!result.success) return 'failed';
  if (
    !critical ||
    critical.status === 'recoverable_error' ||
    critical.status === 'ok'
  )
    return 'partial';
  return critical.status;
}

function terminalNextAction(
  result: AgentResult,
  outcome: AgentExecutionSummary['outcome'],
  critical?: ToolExecutionReceipt,
): string {
  if (outcome === 'cancelled') return 'Continúa en el turno más reciente.';
  if (outcome === 'pending_confirmation')
    return 'Revisa y aprueba la propuesta; todavía no se aplicó ese cambio.';
  if (outcome === 'needs_user_input')
    return (
      (result.awaiting_input ? result.content : critical?.next_action) ||
      'Indica el dato que falta para continuar.'
    );
  if (outcome === 'failed')
    return 'No pude obtener un resultado del servicio. Puedes reintentar la consulta; una escritura incierta requiere verificar primero su estado.';
  if (critical?.next_action) return critical.next_action;
  return result.plan_continue
    ? 'Continuaré desde el siguiente paso pendiente, sin repetir cambios.'
    : 'Puedo continuar con el siguiente paso o verificar el estado actual del registro.';
}

/** Decorates the ONE shared sync/SSE loop. No extra inference, verifier or engine. */
export async function* withExecutionContract(
  source: AsyncGenerator<AIStreamChunk, AgentResult>,
): AsyncGenerator<AIStreamChunk, AgentResult> {
  const receipts = new Map<string, ToolExecutionReceipt>();
  const all: ToolExecutionReceipt[] = [];
  let text = '';
  let done: AIStreamChunk | undefined;
  let terminalError: AIStreamChunk | undefined;
  let completed = false;
  const relay = async function* (
    chunk: AIStreamChunk,
  ): AsyncGenerator<AIStreamChunk, IteratorResult<AIStreamChunk, AgentResult>> {
    let input: unknown;
    try {
      input = yield chunk;
    } catch (error) {
      return await source.throw(error);
    }
    return await source.next(input);
  };
  try {
    let step = await source.next();
    while (!step.done) {
      const chunk = step.value;
      if (chunk.type === 'tool_result' && chunk.tool) {
        const execution =
          chunk.tool.execution ??
          toolReceipt(
            normalizeToolResult(chunk.tool.summary ?? '', {
              truncated: (chunk.tool.summary?.length ?? 0) >= 300,
            }),
          );
        receipts.set(chunk.tool.name, execution);
        all.push(execution);
        step = yield* relay({
          ...chunk,
          tool: {
            ...chunk.tool,
            summary: userToolSummary(execution, chunk.tool.summary),
            execution,
            failed:
              !notExecuted(execution) &&
              ['recoverable_error', 'blocked'].includes(execution.status),
          },
        });
        continue;
      } else if (chunk.type === 'text') text += chunk.content ?? '';
      else if (chunk.type === 'done') done = chunk;
      else if (chunk.type === 'error') terminalError = chunk;
      else {
        step = yield* relay(chunk);
        continue;
      }
      step = await source.next();
    }
    const result = step.value;
    completed = true;
    const outstanding = [...receipts.values()].filter(
      (r) => r.status !== 'ok' && !notExecuted(r),
    );
    const critical =
      outstanding.find((r) => r.status === 'unknown_effect') ??
      outstanding.find((r) => r.status === 'blocked') ??
      outstanding[0];
    const outcome = terminalOutcome(result, critical);
    const nextAction = terminalNextAction(result, outcome, critical);
    const execution: AgentExecutionSummary = {
      schema_version: '1',
      outcome,
      next_action: nextAction,
      ...(result.error_code ? { error_code: result.error_code } : {}),
      evidence_refs: [...new Set(all.flatMap((r) => r.evidence_refs))],
      resource_ids: Object.assign({}, ...all.map((r) => r.resource_ids)),
    };
    // The model's answer is the answer. Read/analysis turns are never
    // overwritten: a failed or truncated read is something the model already
    // saw and must explain itself. Only a known blocker or an uncertain WRITE
    // earns a short human notice, appended — never the internal next_action.
    let content = text || result.content;
    // The model answered in prose: intermediate receipts it already saw and
    // handled (a failed read, a corrected call, a 403 it explained) earn NO
    // generic notice. Catalog notices are for a turn without a model answer,
    // or for a write that is pending/uncertain.
    const answered = !!content.trim() && !result.exhausted;
    // The receipt's `next_action` is written FOR THE MODEL ("Cuéntale qué
    // pasó…"): the person only ever reads the catalog line.
    const question =
      critical?.status === 'needs_user_input' &&
      !result.awaiting_input &&
      !answered
        ? USER_NOTICES.needs_user_input
        : undefined;
    const wroteUnknown = all.some(
      (r) => r.status === 'unknown_effect' || r.effect_status === 'unknown',
    );
    const wroteApplied = all.some(
      (r) => r.status === 'ok' && r.effect_status === 'applied',
    );
    // A failed loop's content is a provider/runtime diagnostic, not an answer.
    // After a write that landed (or may have), "pídemelo de nuevo" would invite
    // a second approval: say what is known about the change instead.
    if (!result.success)
      content = wroteUnknown
        ? USER_NOTICES.unknown_effect
        : wroteApplied
          ? USER_NOTICES.write_pending_verification
          : result.exhausted
            ? content || USER_NOTICES.failed
            : USER_NOTICES.failed;
    // Exhaustion text is ours (the model never closed), so it may be rebuilt.
    else if (result.exhausted)
      content = describeIncompleteExecution(
        all,
        question ?? USER_NOTICES.exhausted,
      );
    else if (question) content = appendNotice(content, question);
    else if (!content && critical) content = USER_NOTICES.read_failed;
    if (critical?.status === 'unknown_effect')
      content = appendNotice(content, USER_NOTICES.unknown_effect);
    else if (critical?.status === 'blocked' && !answered)
      content = appendNotice(content, USER_NOTICES.blocked);
    else if (
      critical?.status === 'pending_confirmation' &&
      !result.pending_confirmation &&
      !result.pending_plan
    )
      content = appendNotice(content, USER_NOTICES.pending_confirmation);
    // A write applied in THIS turn has no server verifier at this layer: the
    // model's text stays and a short human line is appended. The durable
    // session removes it again if its verifier confirms the effect.
    else if (!critical && result.success && !result.exhausted && wroteApplied)
      content = appendNotice(content, USER_NOTICES.write_pending_verification);
    if (
      (outcome === 'pending_confirmation' &&
        (result.pending_confirmation || result.pending_plan)) ||
      result.awaiting_input
    )
      content = result.content;
    if (result.aborted || result.degenerate || result.plan_continue)
      content = '';
    if (content) yield { type: 'text', content };
    if (result.degenerate && terminalError)
      yield { ...terminalError, execution };
    if (!result.aborted && !result.degenerate)
      yield { ...(done ?? { type: 'done' as const }), execution };
    return { ...result, content, execution };
  } catch (error) {
    // Preserve guard/HTTP semantics. The API boundary remains responsible for
    // transport errors; no permission failure becomes a successful HTTP result.
    throw error;
  } finally {
    if (!completed) await source.return(undefined as never);
  }
}

export function semanticToolOutcome(
  receipt: ToolExecutionReceipt,
):
  | 'partial'
  | 'unknown_effect'
  | 'awaiting_approval'
  | 'awaiting_input'
  | 'blocked_permission'
  | 'blocked_plan'
  | 'not_found'
  | 'failed' {
  if (receipt.status === 'unknown_effect') return 'unknown_effect';
  if (receipt.status === 'pending_confirmation') return 'awaiting_approval';
  if (receipt.status === 'needs_user_input') return 'awaiting_input';
  if (receipt.status === 'blocked')
    return /^(SUBSCRIPTION_|PLAN_|TRIAL_)/.test(receipt.error_code ?? '')
      ? 'blocked_plan'
      : 'blocked_permission';
  if (receipt.error_code === 'NOT_FOUND') return 'not_found';
  return receipt.status === 'recoverable_error' ? 'failed' : 'partial';
}
