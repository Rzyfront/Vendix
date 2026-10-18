/**
 * Offline D2 wiring: REAL registry, loop, D1 repository/session and deterministic
 * SQL transport. Provider and business domain are synthetic boundaries only.
 * This is not PostgreSQL isolation, a provider benchmark or product E2E.
 */
import {
  AIAgentService,
  type AgentResult,
  type AgentRunParams,
} from '../../src/ai-engine/ai-agent.service';
import type {
  AIMessage,
  AIResponse,
  AIStreamChunk,
  AIToolCall,
} from '../../src/ai-engine/interfaces/ai-provider.interface';
import { AgentObjectiveRepository } from '../../src/ai-engine/tasks/agent-objective.repository';
import { AgentTaskContextService } from '../../src/ai-engine/tasks/agent-task-context.service';
import {
  AgentDurableSessionService,
  type AgentDurableSession,
} from '../../src/ai-engine/tasks/agent-durable-session.service';
import { ObjectiveMemoryDatabase } from '../../src/ai-engine/tasks/testing/objective-memory-db';
import { AIToolRegistry } from '../../src/ai-engine/tools/ai-tool-registry';
import type { RegisteredTool } from '../../src/ai-engine/tools/interfaces/tool.interface';
import { RequestContextService } from '../../src/common/context/request-context.service';

const ctx = {
  store_id: 11,
  organization_id: 22,
  user_id: 33,
  permissions: ['read'],
  roles: ['owner'],
  is_super_admin: false,
  is_owner: true,
};
const call = (
  index: number,
  args: unknown = { id: index },
  name = 'read_record',
): AIToolCall => ({
  id: `call_${index}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const answer = (tool_calls?: AIToolCall[]): AIResponse => ({
  success: true,
  content: tool_calls
    ? ''
    : 'Consulté los registros; falta verificar el objetivo.',
  tool_calls,
  usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
});
const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tickUntil = async (predicate: () => boolean) => {
  for (let i = 0; i < 1500 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
};
const readTool = (
  handler: NonNullable<RegisteredTool['handler']>,
  patch: Partial<RegisteredTool> = {},
): RegisteredTool => ({
  name: 'read_record',
  domain: 'records',
  description: 'Consulta sintética scoped, sin efectos',
  readOnly: true,
  requiredPermissions: ['read'],
  parameters: {
    type: 'object',
    properties: { id: { type: 'number' } },
    required: ['id'],
  },
  scheduling: {
    parallelSafe: true,
    idempotent_read: true,
    resource_keys: ['record:{id}'],
    max_result_bytes: 65536,
  },
  handler,
  ...patch,
});
function wiring(tool: RegisteredTool) {
  const db = new ObjectiveMemoryDatabase();
  db.seedConversation(7, ctx);
  const repo = new AgentObjectiveRepository(db.prisma);
  const contexts = new AgentTaskContextService(repo);
  const sessions = new AgentDurableSessionService(repo, contexts);
  const registry = new AIToolRegistry({} as never);
  registry.register(tool);
  const queue: Array<AIResponse | (() => Promise<AIResponse>)> = [];
  const providerMessages: AIMessage[][] = [];
  const chat = jest.fn(async (messages: AIMessage[]) => {
    providerMessages.push(structuredClone(messages));
    const next = queue.shift();
    return typeof next === 'function' ? next() : (next ?? answer());
  });
  const quota = jest.fn().mockResolvedValue(undefined);
  const agent = new AIAgentService(
    { chat } as never,
    {} as never,
    registry,
    { emit: jest.fn() } as never,
    {} as never,
    {
      canUseAIFeature: async () => ({ allowed: true }),
      getAIFeatureConfig: async () => ({ tools_allowed: ['*'] }),
      consumeAIQuota: quota,
      checkExtraQuota: async () => ({ exceeded: false }),
      consumeExtraQuota: jest.fn(),
    } as never,
  );
  return {
    db,
    repo,
    contexts,
    sessions,
    registry,
    queue,
    chat,
    providerMessages,
    quota,
    agent,
  };
}
async function drain(
  agent: AIAgentService,
  session?: AgentDurableSession,
  patch: Partial<AgentRunParams> = {},
) {
  const chunks: AIStreamChunk[] = [];
  const iterator = agent.runAgentStream({
    goal: 'Consulta registros existentes, no crees nuevos.',
    agent_key: 'vexi',
    conversation_id: 7,
    max_iterations: 3,
    timeout_ms: 10000,
    ...(session ? { durable: session } : {}),
    ...patch,
  });
  let next = await iterator.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await iterator.next();
  }
  return { chunks, result: next.value as AgentResult };
}
const scope = <T>(fn: () => T) => RequestContextService.runIsolated(ctx, fn);

beforeEach(() => {});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('D2 real execution seams, synthetic provider/domain', () => {
  it('executes eight audited reads at most three concurrently, with stable provider IDs and exactly eight durable results', async () =>
    scope(async () => {
      const gate = defer();
      let active = 0,
        max = 0;
      const handler = jest.fn(async (args: Record<string, unknown>) => {
        const local = RequestContextService.asyncLocalStorage.getStore()!;
        expect(local.store_id).toBe(ctx.store_id);
        active++;
        max = Math.max(max, active);
        await gate.promise;
        active--;
        return JSON.stringify({
          id: args.id,
          resource_ids: { record_id: args.id },
          observed: true,
        });
      });
      const w = wiring(readTool(handler));
      const session = (await w.sessions.open(7, 'vexi', 'Consultar ocho'))!;
      w.queue.push(
        answer(Array.from({ length: 8 }, (_, i) => call(i))),
        answer(),
      );
      const pending = drain(w.agent, session);
      await tickUntil(() => active === 3);
      gate.resolve();
      const { chunks, result } = await pending;
      expect(max).toBe(3);
      expect(handler).toHaveBeenCalledTimes(8);
      const publicRows = await w.repo.listResults(session.objective_id, {
        limit: 100,
      });
      expect(publicRows.items).toHaveLength(8);
      expect(
        new Set(publicRows.items.map((row) => row.tool_call_id)).size,
      ).toBe(8);
      expect(
        publicRows.items.every(
          (row) => row.receipt.status === 'ok' && !row.stale_lease,
        ),
      ).toBe(true);
      expect(
        w.providerMessages[1]
          .filter((message) => message.role === 'tool')
          .map((message) => message.tool_call_id),
      ).toEqual(Array.from({ length: 8 }, (_, i) => `call_${i}`));
      expect(
        chunks
          .filter((chunk) => chunk.type === 'tool_result')
          .map((chunk) => chunk.tool?.id),
      ).toEqual(Array.from({ length: 8 }, (_, i) => `call_${i}`));
      expect(result.objective?.semantic_status).not.toBe('completed_verified');
      expect((await w.repo.get(session.objective_id)).budget.tools).toBe(8);
    }));

  it('one rejected domain read retains seven successful sibling checkpoints and exact model result correlation', async () =>
    scope(async () => {
      const handler = jest.fn(async (args: Record<string, unknown>) => {
        await Promise.resolve();
        if (args.id === 3) throw new Error('synthetic read outage');
        return JSON.stringify({
          id: args.id,
          resource_ids: { record_id: args.id },
        });
      });
      const w = wiring(readTool(handler));
      const session = (await w.sessions.open(
        7,
        'vexi',
        'Consultar con un fallo',
      ))!;
      w.queue.push(
        answer(Array.from({ length: 8 }, (_, i) => call(i))),
        answer(),
      );
      const { result } = await drain(w.agent, session);
      const page = await w.repo.listResults(session.objective_id, {
        limit: 100,
      });
      expect(handler).toHaveBeenCalledTimes(8);
      expect(page.items).toHaveLength(8);
      expect(
        page.items.filter((row) => row.receipt.status === 'ok'),
      ).toHaveLength(7);
      expect(
        page.items.find((row) => row.tool_call_id.endsWith(':call_3'))?.receipt
          .status,
      ).not.toBe('ok');
      expect(
        w.providerMessages[1]
          .filter((message) => message.role === 'tool')
          .map((message) => message.tool_call_id),
      ).toEqual(Array.from({ length: 8 }, (_, i) => `call_${i}`));
      expect(result.execution?.outcome).not.toBe('completed_verified');
    }));

  it('rejects a malformed full batch before all handlers, with recovery attributed only to the culprit', async () =>
    scope(async () => {
      const handler = jest.fn(async () => '{"id":1}');
      const w = wiring(readTool(handler));
      const session = (await w.sessions.open(7, 'vexi', 'Lote malformado'))!;
      const malformed = call(2);
      malformed.function.arguments = '{bad-json';
      w.queue.push(answer([call(1), malformed]), answer());
      await drain(w.agent, session);
      expect(handler).not.toHaveBeenCalled();
      const page = await w.repo.listResults(session.objective_id, {
        limit: 100,
      });
      expect(page.items).toHaveLength(2);
      expect(
        page.items.find((row) => row.tool_call_id.endsWith(':call_1'))?.receipt
          .error_code,
      ).toBe('BATCH_NOT_DISPATCHED');
      expect(
        page.items.find((row) => row.tool_call_id.endsWith(':call_2'))?.receipt
          .error_code,
      ).toBe('INVALID_ARGS');
      const internal = await w.repo.latestInternalResult(
        session.objective_id,
        'agent_recovery_checkpoint',
      );
      const state = (
        internal?.data as {
          recovery: {
            failures: unknown[];
            expansions: number;
            replans: number;
          };
        }
      ).recovery;
      expect(state.failures).toHaveLength(1);
      expect(state.expansions).toBe(0);
      expect(state.replans).toBe(0);
      expect(
        page.items.every(
          (row) => row.tool_name !== 'agent_recovery_checkpoint',
        ),
      ).toBe(true);
    }));

  it('does not dispatch any valid sibling when another call is unauthorized', async () =>
    scope(async () => {
      const handler = jest.fn(async () => '{"id":1}');
      const w = wiring(readTool(handler));
      const session = (await w.sessions.open(7, 'vexi', 'Sin permiso'))!;
      w.queue.push(answer([call(1), call(2, {}, 'forbidden_write')]));
      const { result } = await drain(w.agent, session);
      expect(handler).not.toHaveBeenCalled();
      expect(result.objective?.semantic_status).toBe('blocked');
      expect([...w.db.effects.values()]).toHaveLength(0);
      const publicRows = await w.repo.listResults(session.objective_id);
      expect(publicRows.items).toHaveLength(2);
      expect(
        publicRows.items.some(
          (row) => row.receipt.error_code === 'AI_AGENT_TOOL_NOT_ALLOWED',
        ),
      ).toBe(true);
    }));

  it('suppresses the same failed handler across four continuations without resetting the durable recovery budget or exposing checkpoints', async () =>
    scope(async () => {
      const handler = jest.fn(async () =>
        JSON.stringify({
          error: 'Schema conocido, consulta inválida',
          error_code: 'INVALID_ARGS',
          next_step: 'Corrige id una sola vez.',
        }),
      );
      const w = wiring(readTool(handler));
      const objectiveIds: string[] = [];
      for (let turn = 0; turn < 5; turn++) {
        const session = (await w.sessions.open(
          7,
          'vexi',
          turn ? 'Continúa' : 'Consultar',
          { continuation: turn > 0 },
        ))!;
        objectiveIds.push(session.objective_id);
        w.queue.splice(0, w.queue.length, answer([call(0)]), answer());
        await drain(w.agent, session, { max_iterations: 2 });
      }
      expect(new Set(objectiveIds).size).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);
      const row = await w.repo.get(objectiveIds[0]);
      expect(row.budget.recovery).toBe(2);
      const internal = await w.repo.latestInternalResult(
        row.id,
        'agent_recovery_checkpoint',
      );
      expect(
        (
          internal?.data as {
            recovery: { replans: number; expansions: number };
          }
        ).recovery,
      ).toMatchObject({ replans: 2, expansions: 0 });
      const page = await w.repo.listResults(row.id, { limit: 100 });
      expect(page.items).toHaveLength(5);
      expect(page.items.every((item) => item.tool_name === 'read_record')).toBe(
        true,
      );
      expect((await w.contexts.build(row.id)).context).not.toContain(
        'agent_recovery_checkpoint',
      );
      expect(row.semantic_status).not.toBe('completed_verified');
    }));

  it('permits one schema correction through the same registry and retains its counter on the next continuation', async () =>
    scope(async () => {
      const handler = jest.fn(async (args: Record<string, unknown>) =>
        args.id === 1
          ? JSON.stringify({
              error: 'invalid fixture ID format',
              error_code: 'INVALID_ARGS',
              next_step: 'Usa el id correcto.',
            })
          : JSON.stringify({
              id: args.id,
              resource_ids: { record_id: args.id },
            }),
      );
      const w = wiring(readTool(handler));
      const session = (await w.sessions.open(7, 'vexi', 'Corregir consulta'))!;
      w.queue.push(answer([call(1)]), answer([call(2)]), answer());
      await drain(w.agent, session);
      expect(handler).toHaveBeenCalledTimes(2);
      const next = (await w.sessions.open(7, 'vexi', 'Continúa', {
        continuation: true,
      }))!;
      expect((await next.recoveryState())?.corrections).toBe(1);
      expect(next.objective.budget.recovery).toBe(1);
      await next.close();
    }));

  it('aborts a non-cooperative provider and fences its late tool completion without a second inference or dispatch', async () =>
    scope(async () => {
      const gate = defer(),
        started = defer(),
        abort = new AbortController();
      const handler = jest.fn(async () => '{"id":1}');
      const w = wiring(readTool(handler));
      const session = (await w.sessions.open(7, 'vexi', 'Cancelar proveedor'))!;
      w.queue.push(async () => {
        started.resolve();
        await gate.promise;
        return answer([call(1)]);
      });
      const pending = drain(w.agent, session, { signal: abort.signal });
      await started.promise;
      abort.abort();
      const stopped = await pending;
      expect(stopped.result.success).toBe(false);
      expect(stopped.result.error_code).toBe('AGENT_CANCELLED');
      const rowBefore = await w.repo.get(session.objective_id);
      gate.resolve();
      await tickUntil(() => w.queue.length === 0);
      for (let i = 0; i < 80; i++) await Promise.resolve();
      const rowAfter = await w.repo.get(session.objective_id);
      expect(handler).not.toHaveBeenCalled();
      expect(w.chat).toHaveBeenCalledTimes(1);
      expect(rowAfter.version).toBe(rowBefore.version);
      expect(rowAfter.lease_generation).toBe(rowBefore.lease_generation);
      expect(
        (await w.repo.listResults(session.objective_id)).items,
      ).toHaveLength(0);
    }));

  it('holds a completed sibling as durable evidence while a later read is still in flight, then audits cancellation without claiming verification', async () =>
    scope(async () => {
      const slow = defer(),
        abort = new AbortController();
      let slowStarted = false;
      const handler = jest.fn(async (args: Record<string, unknown>) => {
        if (args.id === 2) {
          slowStarted = true;
          await slow.promise;
        }
        return JSON.stringify({
          id: args.id,
          resource_ids: { record_id: args.id },
        });
      });
      const w = wiring(readTool(handler));
      const session = (await w.sessions.open(7, 'vexi', 'Preservar siblings'))!;
      w.queue.push(answer([call(1), call(2)]));
      const pending = drain(w.agent, session, { signal: abort.signal });
      await tickUntil(
        () =>
          slowStarted &&
          [...w.db.results.values()].some((row) =>
            row.tool_call_id.endsWith(':call_1'),
          ),
      );
      abort.abort();
      slow.resolve();
      const { result } = await pending;
      const rows = [...w.db.results.values()].filter(
        (row) => row.tool_name === 'read_record',
      );
      expect(
        rows.find((row) => row.tool_call_id.endsWith(':call_1'))?.receipt
          .status,
      ).toBe('ok');
      const late = rows.find((row) => row.tool_call_id.endsWith(':call_2'))!;
      expect(late.stale_lease).toBe(true);
      expect(late.freshness).not.toBe('observed');
      expect(result.objective?.semantic_status).not.toBe('completed_verified');
      expect(handler).toHaveBeenCalledTimes(2);
    }));
});
