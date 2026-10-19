import {
  INTERNAL_JARGON,
  USER_NOTICES,
  USER_TOOL_NOTES,
  clientSafeChunk,
  describeIncompleteExecution,
  observedReceipt,
  userToolSummary,
  withExecutionContract,
} from './agent-execution.contract';
import type { AgentResult } from './ai-agent.service';
import type { AIStreamChunk } from './interfaces/ai-provider.interface';
import type { ToolExecutionReceipt } from './tools/interfaces/tool.interface';

// §5.3 noJargon grader of the stabilization plan.
const noJargon =
  /postcondici|search_tools|search_playbooks|load_playbook|playbook|objetivo original|next_step|next_action|semantic_status|requires_revalidation|Conservo el avance|evidencia suficiente|no está verificada|RECUPERACIÓN TÉCNICA|inferencia|schema|preflight|fingerprint|lease|tool_call:|objective:|\(interno\)|BATCH_NOT|AI_AGENT_/i;

const MODEL_TEXT =
  'El cierre de ayer tuvo un faltante de $20.000: esperado $500.000, contado $480.000.';

const receipt = (
  over: Partial<ToolExecutionReceipt> = {},
): ToolExecutionReceipt => ({
  ...observedReceipt(),
  evidence_refs: ['tool_call:c1'],
  resource_ids: { id: 'CS-77' },
  ...over,
});

async function runContract(
  tools: Array<{ name: string; execution?: ToolExecutionReceipt; summary?: string }>,
  text: string,
  over: Partial<AgentResult> = {},
) {
  async function* source(): AsyncGenerator<AIStreamChunk, AgentResult> {
    for (const [i, t] of tools.entries()) {
      yield {
        type: 'tool_call',
        tool: { id: `c${i}`, name: t.name, arguments: {} },
      };
      yield {
        type: 'tool_result',
        tool: {
          id: `c${i}`,
          name: t.name,
          summary: t.summary ?? '{"id":"CS-77"}',
          ...(t.execution ? { execution: t.execution } : {}),
        },
      };
    }
    if (text) yield { type: 'text', content: text };
    yield { type: 'done' };
    return {
      content: text,
      iterations: 2,
      tools_used: [],
      total_tokens: 10,
      success: true,
      ...over,
    };
  }
  const chunks: AIStreamChunk[] = [];
  const gen = withExecutionContract(source());
  let step = await gen.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await gen.next();
  }
  return { chunks, result: step.value };
}

describe('agent-execution.contract (P0-3): the model text is never replaced', () => {
  it('(a) an ok but truncated read keeps the model text identical', async () => {
    const { result, chunks } = await runContract(
      [
        {
          name: 'get_cash_session_close_report',
          execution: receipt({
            freshness: 'truncated',
            effect_status: 'unverified',
            next_action:
              'El resultado no constituye evidencia completa. Verifica el registro.',
          }),
        },
      ],
      MODEL_TEXT,
    );
    expect(result.content).toBe(MODEL_TEXT);
    expect(chunks.filter((c) => c.type === 'text')).toEqual([
      { type: 'text', content: MODEL_TEXT },
    ]);
  });

  it('(b) an ok ui_navigate is kept', async () => {
    const { result } = await runContract(
      [
        {
          name: 'ui_navigate',
          execution: receipt({ effect_status: 'unverified' }),
          summary: '{"status":"navigated"}',
        },
      ],
      'Listo, ya estás en Caja.',
    );
    expect(result.content).toBe('Listo, ya estás en Caja.');
  });

  it('(c) search_tools + a read are kept', async () => {
    const { result } = await runContract(
      [
        {
          name: 'search_tools',
          execution: observedReceipt(),
          summary: 'Buscando la herramienta adecuada.',
        },
        { name: 'list_cash_sessions', execution: receipt() },
      ],
      MODEL_TEXT,
    );
    expect(result.content).toBe(MODEL_TEXT);
  });

  it('(c) a search_tools frame without receipt is not turned into a failed/unverified read', async () => {
    const { result, chunks } = await runContract(
      [
        {
          name: 'search_tools',
          summary: 'Buscando la herramienta adecuada.',
        },
      ],
      MODEL_TEXT,
    );
    expect(result.content).toBe(MODEL_TEXT);
    expect(
      chunks.find((c) => c.type === 'tool_result')?.tool?.failed,
    ).toBe(false);
  });

  it('(d) an applied write keeps the model text and appends a short human notice, no jargon', async () => {
    const written = 'Listo, registré el retiro de $50.000 en la caja.';
    const { result } = await runContract(
      [
        {
          name: 'create_cash_movement',
          execution: receipt({
            effect_status: 'applied',
            next_action:
              'Verifica con search_tools y el playbook las postcondiciones.',
          }),
        },
      ],
      written,
    );
    expect(result.content.startsWith(written)).toBe(true);
    expect(result.content).toContain(USER_NOTICES.write_pending_verification);
    expect(result.content).not.toMatch(INTERNAL_JARGON);
    expect(result.content).not.toMatch(noJargon);
  });

  it('only replaces when there is no model text, with a human notice', async () => {
    const { result } = await runContract(
      [
        {
          name: 'list_cash_sessions',
          execution: receipt({
            status: 'recoverable_error',
            error_code: 'TOOL_BUSINESS_ERROR',
            next_action: 'Usa search_tools y revisa el schema.',
          }),
        },
      ],
      '',
    );
    expect(result.content).toBe(USER_NOTICES.read_failed);
    expect(result.content).not.toMatch(noJargon);
  });

  it('describeIncompleteExecution never concatenates next_action nor raw ids', () => {
    const text = describeIncompleteExecution(
      [
        receipt({
          next_action: 'Busca la herramienta con search_tools.',
          resource_ids: { id: 'CS-77', order: 991 },
        }),
      ],
      USER_NOTICES.exhausted,
    );
    expect(text).not.toContain('CS-77');
    expect(text).not.toContain('991');
    expect(text).not.toMatch(noJargon);
    expect(text).toContain(USER_NOTICES.exhausted);
  });
});

describe('agent-execution.contract (B1): receipt instructions are never visible', () => {
  // Verbatim from vexi-ui-command.service.ts (posAddItem, non-ok branch).
  const UI_NEXT_STEP = 'Cuéntale exactamente qué pasó y qué tiene que hacer él.';

  it('a ui_* needs_user_input appends the catalog line, not its next_action', async () => {
    const { result, chunks } = await runContract(
      [
        {
          name: 'ui_pos_add_item',
          execution: receipt({
            status: 'needs_user_input',
            next_action: UI_NEXT_STEP,
          }),
          summary: UI_NEXT_STEP,
        },
      ],
      'Te abrí el selector de la camiseta.',
    );
    expect(result.content).toBe(
      `Te abrí el selector de la camiseta.\n\n${USER_NOTICES.needs_user_input}`,
    );
    // The receipt keeps it for the model (clientSafeStream strips it later);
    // the text and the trace row never carry it.
    for (const chunk of chunks) {
      expect(chunk.content ?? '').not.toContain(UI_NEXT_STEP);
      expect(chunk.tool?.summary ?? '').not.toContain(UI_NEXT_STEP);
    }
  });

  it('an exhausted turn with a pending question uses the catalog line', async () => {
    const { result } = await runContract(
      [
        {
          name: 'ui_click_action',
          execution: receipt({
            status: 'needs_user_input',
            next_action: UI_NEXT_STEP,
          }),
        },
      ],
      '',
      { exhausted: true },
    );
    expect(result.content).not.toContain(UI_NEXT_STEP);
    expect(result.content).toContain(USER_NOTICES.needs_user_input);
  });

  it('trace rows: non-ok is always a catalog line; ok drops embedded instructions', () => {
    expect(
      userToolSummary(
        receipt({ status: 'needs_user_input', next_action: UI_NEXT_STEP }),
        UI_NEXT_STEP,
      ),
    ).toBe(USER_TOOL_NOTES.needs_user_input);
    expect(
      userToolSummary(
        receipt(),
        JSON.stringify({ status: 'ok', next_step: 'Pregúntale si quiere algo más.' }),
      ),
    ).toBeUndefined();
    expect(userToolSummary(receipt(), '{"id":"CS-77"}')).toBe('{"id":"CS-77"}');
  });
});

describe('agent-execution.contract (M2): failure after a write', () => {
  it('an applied write followed by a provider failure never says "pídemelo de nuevo"', async () => {
    const { result } = await runContract(
      [{ name: 'create_cash_movement', execution: receipt({ effect_status: 'applied' }) }],
      '',
      { success: false },
    );
    expect(result.content).toBe(USER_NOTICES.write_pending_verification);
  });

  it('an uncertain write followed by a provider failure reports the uncertainty', async () => {
    const { result } = await runContract(
      [
        {
          name: 'write_endpoint',
          execution: receipt({ status: 'unknown_effect', effect_status: 'unknown' }),
        },
      ],
      '',
      { success: false },
    );
    expect(result.content).toBe(USER_NOTICES.unknown_effect);
  });

  it('a failure without writes keeps the retry notice', async () => {
    const { result } = await runContract([], 'diagnóstico', { success: false });
    expect(result.content).toBe(USER_NOTICES.failed);
  });
});

describe('agent-execution.contract (P0-14): client-safe frames', () => {
  it('strips next_action from receipts and summary and next_step from the objective', () => {
    const chunk = clientSafeChunk({
      type: 'done',
      execution: {
        schema_version: '1',
        outcome: 'partial',
        next_action: 'Usa search_tools.',
        evidence_refs: [],
        resource_ids: {},
      },
      objective: {
        id: 'o1',
        goal: 'g',
        conversation_id: 1,
        version: 1,
        semantic_status: 'partial',
        next_step: 'Revisa el playbook.',
        budget: {} as any,
        expires_at: '',
        requires_revalidation: false,
      },
    });
    expect(chunk.execution).not.toHaveProperty('next_action');
    expect(chunk.objective?.next_step).toBeNull();
    const tool = clientSafeChunk({
      type: 'tool_result',
      tool: {
        id: 'c1',
        name: 'x',
        execution: receipt({ next_action: 'Usa search_tools.' }),
      },
    });
    expect(tool.tool?.execution).not.toHaveProperty('next_action');
    expect(tool.tool?.execution?.status).toBe('ok');
  });
});
