import type { AgentResult } from './ai-agent.service';
import type { AIStreamChunk } from './interfaces/ai-provider.interface';
import type {
  AgentExecutionSummary,
  ToolExecutionReceipt,
} from './tools/interfaces/tool.interface';
import {
  normalizeToolResult,
  toolReceipt,
} from './tools/tool-result.normalizer';

export function describeIncompleteExecution(
  receipts: ToolExecutionReceipt[],
  nextAction: string,
): string {
  const observed = receipts.filter(
    (r) => r.status === 'ok' && r.freshness === 'observed',
  );
  const ids = [
    ...new Set(observed.flatMap((r) => Object.values(r.resource_ids))),
  ];
  const prefix = ids.length
    ? `Consulté los registros ${ids.slice(0, 5).join(', ')}. `
    : observed.length
      ? 'Obtuve resultados de consulta, pero la solicitud no está verificada como terminada. '
      : 'No tengo evidencia suficiente para dar tu solicitud por terminada. ';
  return prefix + nextAction;
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
            execution,
            failed: ['recoverable_error', 'blocked'].includes(execution.status),
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
    const outstanding = [...receipts.values()].filter((r) => r.status !== 'ok');
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
    // Never let optimistic provider prose hide a known blocker or an uncertain
    // effect. Legacy text/truncation and applied-without-verifier are not proof.
    const unverified = all.some(
      (r) =>
        r.effect_status === 'applied' ||
        r.effect_status === 'unverified' ||
        r.freshness !== 'observed',
    );
    const mustDescribe =
      critical || result.exhausted || unverified || !result.success;
    let content = text || result.content;
    if (mustDescribe) content = describeIncompleteExecution(all, nextAction);
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
