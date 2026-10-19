import { AIChatService } from './ai-chat.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  USER_NOTICES,
  clientSafeStream,
  withExecutionContract,
} from '../../../ai-engine/agent-execution.contract';
import {
  normalizeToolResult,
  toolReceipt,
} from '../../../ai-engine/tools/tool-result.normalizer';
import type { AgentResult } from '../../../ai-engine/ai-agent.service';
import type { AIStreamChunk } from '../../../ai-engine/interfaces/ai-provider.interface';

/**
 * Every user-facing output of a Vexi turn — the streamed text, the assistant
 * row persisted in `ai_messages.content` and what is handed to the voice
 * synthesizer (`speak: true`) — must be made ONLY of the model's prose and of
 * the closed human catalog (`USER_NOTICES`). Instructions written for the
 * model (`next_step` / `next_action` of any receipt, recovery guidance) never
 * reach the person, however human they read.
 *
 * The receipts are built with the real normalizer from the real payloads the
 * browser and the tools send (`vexi-ui-command.service.ts`,
 * `reservations.tools.ts`, `agent-recovery.service.ts`).
 */

const CATALOG: readonly string[] = Object.values(USER_NOTICES);
const PARTIAL_PREFIX = 'Alcancé a consultar parte de la información. ';

/** Second-person instructions about the user, or tool names: model-directed. */
const MODEL_DIRECTED =
  /\b(cuéntale|dile|pregúntale|ofrécele|confírmale|resúmele|usa otra capacidad|lista las reservas)\b|\b(ui|list|get|search)_[a-z_]+\b|next_(step|action)|agent-result:|tool_call:/i;

interface Scenario {
  name: string;
  tools: Array<{
    name: string;
    raw: unknown;
    write?: boolean;
    clientSide?: boolean;
    /** Simulates the recovery policy overwriting the receipt's guidance. */
    recovery?: string;
  }>;
  modelText: string;
  result?: Partial<AgentResult>;
}

// Real strings, verbatim from the sources named above.
const UI_ADD_ITEM_FAIL =
  'Cuéntale exactamente qué pasó y qué tiene que hacer él.';
const UI_CHECKOUT_FAIL =
  'Dile exactamente en qué quedó el cobro y qué falta para completarlo.';
const UI_CHECKOUT_OK =
  'Confírmale que la venta quedó cobrada y dile el número de orden.';
const UI_ACTION_FAIL = 'Dile exactamente en qué quedó y qué falta de su parte.';
const UI_REDIRECT =
  'La aplicación lo desvió a /admin/dashboard. Dile dónde quedó realmente en vez de afirmar que llegó a Inventario.';
const BOOKING_HINT = 'Lista las reservas con list_bookings y usa su booking_id.';
const RECOVERY_BLOCKED =
  'Usa otra capacidad ya autorizada; no reintentes este bloqueo con otros argumentos.';
const RECOVERY_UNKNOWN =
  'El efecto de la escritura es incierto. Consulta la operación o referencia; no la repitas.';

const SCENARIOS: Scenario[] = [
  {
    name: 'ui_pos_add_item needs_user_input (variants) with model text',
    tools: [
      {
        name: 'ui_pos_add_item',
        clientSide: true,
        raw: {
          status: 'needs_user_input',
          message: 'Le abrí el selector para "camiseta" y estoy esperando que elija.',
          next_step: UI_ADD_ITEM_FAIL,
        },
      },
    ],
    modelText: 'Te abrí el selector de la camiseta para que elijas la talla.',
  },
  {
    name: 'ui_click_action needs_user_input without model text',
    tools: [
      {
        name: 'ui_click_action',
        clientSide: true,
        raw: {
          status: 'needs_user_input',
          action: 'Nuevo cliente',
          next_step: UI_ACTION_FAIL,
        },
      },
    ],
    modelText: '',
  },
  {
    name: 'ui_pos_checkout ok and a failed one in the same turn',
    tools: [
      {
        name: 'ui_pos_checkout',
        clientSide: true,
        raw: { status: 'ok', order_number: 'POS-991', next_step: UI_CHECKOUT_OK },
      },
      {
        name: 'ui_pos_checkout',
        clientSide: true,
        raw: { status: 'error', message: 'Caja cerrada', next_step: UI_CHECKOUT_FAIL },
      },
    ],
    modelText: 'La venta POS-991 quedó cobrada.',
  },
  {
    name: 'ui_navigate redirected and the loop exhausted',
    tools: [
      {
        name: 'ui_navigate',
        clientSide: true,
        raw: {
          status: 'redirected',
          landed_on: '/admin/dashboard',
          next_step: UI_REDIRECT,
        },
      },
    ],
    modelText: '',
    result: { exhausted: true },
  },
  {
    name: 'domain needs_user_input (reservations)',
    tools: [
      {
        name: 'cancel_booking',
        raw: { needs_user_input: true, next_step: BOOKING_HINT },
      },
    ],
    modelText: '¿Cuál de tus reservas de hoy quieres cancelar?',
  },
  {
    name: 'recovery guidance on a blocked read and an uncertain write',
    tools: [
      {
        name: 'get_income_statement',
        raw: { error: 'Sin permiso', error_code: 'PERMISSION_DENIED', next_step: 'x' },
        recovery: RECOVERY_BLOCKED,
      },
      {
        name: 'write_endpoint',
        write: true,
        raw: { result_unknown: true },
        recovery: RECOVERY_UNKNOWN,
      },
    ],
    modelText: 'Intenté registrar el gasto.',
  },
  {
    name: 'verification: applied write pending server verification',
    tools: [
      {
        name: 'create_cash_movement',
        write: true,
        raw: {
          applied: true,
          id: 'CM-1',
          next_step:
            'Verifica las postcondiciones con verify_deliverables antes de cerrar.',
        },
      },
    ],
    modelText: 'Registré el retiro de $50.000 de la caja.',
  },
  {
    name: 'verification: provider fails after an applied write (no "pídemelo de nuevo")',
    tools: [
      {
        name: 'create_cash_movement',
        write: true,
        raw: { applied: true, id: 'CM-2', next_step: 'Cuéntale que quedó.' },
      },
    ],
    modelText: '',
    result: { success: false, error: 'provider 503' },
  },
  {
    name: 'verification: verified close keeps evidence refs internal',
    tools: [
      {
        name: 'create_cash_movement',
        write: true,
        raw: { applied: true, id: 'CM-3' },
      },
    ],
    modelText: USER_NOTICES.verified,
  },
];

function receiptsOf(scenario: Scenario) {
  return scenario.tools.map((tool, i) => {
    const normalized = normalizeToolResult(JSON.stringify(tool.raw), {
      write: tool.write,
      clientSide: tool.clientSide,
      evidenceRef: `agent-result:00000000-0000-4000-8000-00000000000${i}`,
    });
    if (tool.recovery) normalized.next_action = tool.recovery;
    return { tool, execution: toolReceipt(normalized) };
  });
}

/** Every instruction a receipt carried for the model in this scenario. */
function instructionsOf(scenario: Scenario): string[] {
  const out = new Set<string>();
  for (const { tool, execution } of receiptsOf(scenario)) {
    const raw = tool.raw as Record<string, unknown>;
    for (const value of [raw.next_step, raw.next_action, execution.next_action])
      if (typeof value === 'string' && value.trim().length > 3)
        out.add(value.trim());
  }
  return [...out];
}

function loopFor(scenario: Scenario) {
  return async function* (): AsyncGenerator<AIStreamChunk, AgentResult> {
    for (const [i, { tool, execution }] of receiptsOf(scenario).entries()) {
      yield { type: 'tool_call', tool: { id: `c${i}`, name: tool.name, arguments: {} } };
      yield {
        type: 'tool_result',
        tool: {
          id: `c${i}`,
          name: tool.name,
          // What the loop really puts here for a failed call: the instruction.
          summary: execution.next_action ?? JSON.stringify(tool.raw),
          execution,
        },
      };
    }
    if (scenario.modelText) yield { type: 'text', content: scenario.modelText };
    yield { type: 'done' };
    return {
      content: scenario.modelText,
      iterations: 2,
      tools_used: [],
      total_tokens: 10,
      success: true,
      ...scenario.result,
    };
  };
}

function build(scenario: Scenario) {
  const prisma: any = {
    ai_conversations: {
      findFirst: jest.fn().mockResolvedValue({
        id: 7,
        store_id: 1,
        organization_id: 1,
        user_id: 9,
        title: 'x',
        app_key: null,
        status: 'active',
        metadata: null,
        messages: [],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    ai_messages: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const spoken: string[] = [];
  const turn = {
    abort: jest.fn(),
    filler: jest.fn().mockResolvedValue(null),
    usedFiller: jest.fn().mockReturnValue(undefined),
    push: (text: string) => spoken.push(text),
    drain: () => [],
    flush: jest.fn(),
    settle: jest.fn().mockResolvedValue(undefined),
    timings: () => [],
  };
  const speech = {
    openTurn: jest.fn().mockResolvedValue(turn),
    lastFiller: jest.fn().mockReturnValue(undefined),
    rememberFiller: jest.fn(),
  };
  const run = jest.fn(() =>
    clientSafeStream(withExecutionContract(loopFor(scenario)())),
  );
  const planState: any = {
    getActive: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
    markCurrentChangeStep: jest.fn().mockResolvedValue(null),
    rejectPendingObjective: jest.fn().mockResolvedValue(null),
    createHook: jest.fn().mockReturnValue({ hook: true }),
    setStepHashes: jest.fn().mockResolvedValue([]),
  };
  const streamIntents: any = {
    consume: jest.fn().mockResolvedValue({
      conversation_id: 7,
      user_id: 9,
      content: 'ayúdame',
      speak: true,
    }),
    claimTurn: jest.fn().mockResolvedValue(undefined),
    isCurrentTurn: jest.fn().mockResolvedValue(true),
  };
  const service = new AIChatService(
    prisma,
    {
      ai_agents: { findUnique: jest.fn().mockResolvedValue(null) },
      store_settings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ settings: { vex: { enabled: false } } }),
      },
    } as any,
    {
      supportsAgentStreaming: jest.fn().mockResolvedValue(false),
      getApplication: jest
        .fn()
        .mockResolvedValue({ metadata: { agent_enabled: true } }),
    } as any,
    {} as any,
    { runAgentStream: run, runAgent: jest.fn() } as any,
    {} as any,
    { emit: jest.fn() } as any,
    {
      buildSnapshot: jest.fn().mockResolvedValue({}),
      buildVexSnapshot: jest.fn().mockResolvedValue({}),
    } as any,
    streamIntents,
    { registerTurn: jest.fn(), releaseTurn: jest.fn() } as any,
    speech as any,
    planState,
    {
      canUseAIFeature: jest.fn().mockResolvedValue({
        allowed: true,
        mode: 'allow',
        severity: 'info',
        subscription_state: 'active',
        plan_id: 1,
        has_record: true,
      }),
    } as any,
    { isEnforce: jest.fn().mockReturnValue(true) } as any,
  );
  jest
    .spyOn(service as any, 'durableTurnArgs')
    .mockImplementation(async (conv: any, _key, _goal, base: any) => ({
      ...base,
      conversation_id: conv.id,
      messages: [],
    }));
  return { service, prisma, spoken };
}

async function runTurn(scenario: Scenario) {
  const b = build(scenario);
  const frames: any[] = [];
  await RequestContextService.runIsolated(
    {
      user_id: 9,
      store_id: 1,
      organization_id: 1,
      is_owner: true,
      is_super_admin: false,
    } as any,
    async () => {
      for await (const { replay: _replay, ...f } of b.service.sendMessageStream(
        7,
        's1',
      ))
        frames.push(f);
    },
  );
  const assistant = b.prisma.ai_messages.create.mock.calls
    .map((c: any) => c[0].data)
    .find((row: any) => row.role === 'assistant');
  return {
    frames,
    streamed: frames
      .filter((f) => f.type === 'text')
      .map((f) => f.content)
      .join(''),
    persisted: (assistant?.content ?? '') as string,
    spoken: b.spoken.join(''),
  };
}

/** Output = model prose + catalog lines, nothing else. */
function expectWhitelisted(
  output: string,
  scenario: Scenario,
  instructions: string[],
) {
  for (const instruction of instructions)
    expect(output).not.toContain(instruction);
  const rest = scenario.modelText
    ? output.replace(scenario.modelText, '')
    : output;
  const parts = rest
    .split(/\n\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const line = part.startsWith(PARTIAL_PREFIX)
      ? part.slice(PARTIAL_PREFIX.length)
      : part;
    expect({ part, allowed: CATALOG.includes(line) }).toEqual({
      part,
      allowed: true,
    });
  }
  expect(rest).not.toMatch(MODEL_DIRECTED);
}

describe('Salidas visibles de Vexi: solo prosa del modelo o catálogo humano', () => {
  beforeEach(() =>
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9, store_id: 1 } as any),
  );
  afterEach(() => jest.restoreAllMocks());

  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    '%s',
    async (_name, scenario) => {
      const instructions = instructionsOf(scenario);
      const out = await runTurn(scenario);
      // Something is always said, and the three channels say the same thing.
      expect(out.streamed.length).toBeGreaterThan(0);
      expect(out.persisted).toBe(out.streamed);
      expect(out.spoken).toBe(out.streamed);
      for (const channel of [out.streamed, out.persisted, out.spoken])
        expectWhitelisted(channel, scenario, instructions);
      // Trace rows the panel can paint: never the model instruction either.
      for (const frame of out.frames.filter((f) => f.type === 'tool_result'))
        for (const instruction of instructions)
          expect(frame.tool?.summary ?? '').not.toContain(instruction);
    },
  );

  it('B1: the real ui_pos_add_item instruction never reaches text, row or voice', async () => {
    const out = await runTurn(SCENARIOS[0]);
    for (const channel of [out.streamed, out.persisted, out.spoken]) {
      expect(channel).not.toContain(UI_ADD_ITEM_FAIL);
      expect(channel).toContain(USER_NOTICES.needs_user_input);
    }
  });

  it('M2: a provider failure after an applied write does not invite a repeat', async () => {
    const out = await runTurn(SCENARIOS[7]);
    expect(out.streamed).toBe(USER_NOTICES.write_pending_verification);
    expect(out.streamed).not.toContain(USER_NOTICES.failed);
  });
});
