import {
  AgentRecoveryService,
  AgentRecoveryState,
  RecoveryInput,
} from './agent-recovery.service';
import type { ToolExecutionReceipt } from '../tools/interfaces/tool.interface';

const receipt = (
  patch: Partial<ToolExecutionReceipt> = {},
): ToolExecutionReceipt => ({
  schema_version: '1',
  status: 'recoverable_error',
  error_code: 'INVALID_ARGS',
  retryable: true,
  next_action: null,
  evidence_refs: [],
  resource_ids: {},
  pagination: null,
  freshness: 'unknown',
  effect_status: 'not_applicable',
  ...patch,
});
const input = (patch: Partial<RecoveryInput> = {}): RecoveryInput => ({
  tool_name: 'get_supplier',
  arguments: { id: 10 },
  read_only: true,
  receipt: receipt(),
  ...patch,
});

describe('AgentRecoveryService objective-scoped policy', () => {
  const service = new AgentRecoveryService();
  it('recovers an omitted tool through bounded authorized discovery, never creates a supplier', () => {
    const result = service.decide(input({ failure_kind: 'missing_tool' }));
    expect(result.decision.action).toBe('expand_tools');
    expect(result.decision.next_action).toContain('search_tools');
    expect(result.state.expansions).toBe(1);
    expect(result.decision.next_action).not.toContain('create_supplier');
  });
  it('canonicalizes arguments and changes strategy before identical invalid args execute again', () => {
    const first = service.decide(input({ arguments: { b: 2, a: 1 } }));
    const blocked = service.beforeCall(
      input({ arguments: { a: 1, b: 2 } }),
      first.state,
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.decision?.action).toBe('change_strategy');
    expect(blocked.state.replans).toBe(1);
    const second = service.decide(
      input({ arguments: { a: 1, b: 2 } }),
      first.state,
    );
    expect(second.decision.action).toBe('change_strategy');
    expect(second.state.failures).toHaveLength(1);
  });
  it('allows just one changed-argument schema correction across continuations', () => {
    const first = service.decide(input());
    const next = service.beforeCall(
      input({ arguments: { id: 20 } }),
      first.state,
    );
    expect(next.allowed).toBe(true);
    expect(next.state.corrections).toBe(1);
    const failure = service.decide(
      input({ arguments: { id: 20 } }),
      next.state,
    );
    const denied = service.beforeCall(
      input({ arguments: { id: 30 } }),
      JSON.parse(JSON.stringify(failure.state)),
    );
    expect(denied.allowed).toBe(false);
    expect(denied.state.corrections).toBe(1);
  });
  it('never guesses an unknown record or converts register-existing into create-new', () => {
    const result = service.decide(
      input({
        receipt: receipt({ error_code: 'NOT_FOUND' }),
        missing_identifier: 'supplier.tax_id',
      }),
    );
    expect(result.decision.action).toBe('ask_identifier');
    expect(result.decision.next_action).toContain('supplier.tax_id');
    expect(result.decision.next_action).toContain('no crearé');
    expect(
      service.beforeCall(input({ arguments: { id: 888 } }), result.state)
        .allowed,
    ).toBe(false);
  });
  it('allows one server-proven deterministic alternative then asks for specific identifier', () => {
    const first = service.decide(
      input({
        receipt: receipt({ error_code: 'NOT_FOUND' }),
        alternative_identifier_available: true,
      }),
    );
    expect(first.decision.action).toBe('lookup_identifier');
    const lookup = service.beforeCall(
      input({ arguments: { tax_id: 'fixture' } }),
      first.state,
    );
    expect(lookup.allowed).toBe(true);
    const notfound = service.decide(
      input({
        arguments: { tax_id: 'fixture' },
        receipt: receipt({ error_code: 'NOT_FOUND' }),
        alternative_identifier_available: true,
      }),
      lookup.state,
    );
    expect(
      service.beforeCall(input({ arguments: { id: 999 } }), notfound.state)
        .decision?.action,
    ).toBe('ask_identifier');
  });
  it('paginates explicit incomplete datasets without claiming completion', () => {
    const result = service.decide(
      input({
        receipt: receipt({
          status: 'ok',
          error_code: null,
          freshness: 'observed',
          pagination: { complete: false, has_more: true, next_cursor: 'page2' },
        }),
      }),
    );
    expect(result.decision.action).toBe('paginate');
    expect(result.decision.next_cursor).toBe('page2');
    expect(result.state.replans).toBe(0);
    expect(
      service.decide(
        input({
          receipt: receipt({
            status: 'ok',
            error_code: null,
            freshness: 'truncated',
          }),
        }),
      ).decision.action,
    ).toBe('change_strategy');
  });
  it.each([429, 500, 503])(
    'bounded jitter and retry reservation only for read HTTP%s',
    (status) => {
      let result = service.decide(
        input({
          receipt: receipt({ error_code: 'HTTP_ERROR' }),
          http_status: status,
          jitter: 0,
          now: 1000,
          deadline_at: 5000,
        }),
      );
      expect(result.decision).toMatchObject({
        action: 'retry_read',
        wait_ms: 125,
      });
      const first = service.beforeCall(input(), result.state);
      expect(first.allowed).toBe(true);
      result = service.decide(
        input({
          receipt: receipt({ error_code: 'HTTP_ERROR' }),
          http_status: status,
          jitter: 1,
        }),
        first.state,
      );
      expect(result.decision.wait_ms).toBe(500);
      const second = service.beforeCall(input(), result.state);
      result = service.decide(
        input({
          receipt: receipt({ error_code: 'HTTP_ERROR' }),
          http_status: status,
        }),
        second.state,
      );
      expect(second.state.transient_retries).toBe(2);
      expect(result.decision.action).toBe('change_strategy');
      expect(service.beforeCall(input(), result.state).allowed).toBe(false);
    },
  );
  it('does not add provider retries or retry writes after HTTP503', () => {
    const result = service.decide(
      input({
        read_only: false,
        http_status: 503,
        receipt: receipt({ error_code: 'HTTP_ERROR' }),
      }),
    );
    expect(result.decision.action).not.toBe('retry_read');
    expect(result.state.transient_retries).toBe(0);
  });
  it('refuses backoff and new calls that cannot fit checkpoint reserve', () => {
    expect(
      service.decide(
        input({
          receipt: receipt({ error_code: 'HTTP_ERROR' }),
          http_status: 429,
          now: 1000,
          deadline_at: 1200,
        }),
      ).decision.action,
    ).toBe('stop');
    expect(
      service.decide(
        input({
          receipt: receipt({ error_code: 'HTTP_ERROR' }),
          http_status: 429,
          now: 1000,
          deadline_at: 1300,
          jitter: 0,
        }),
      ).decision.action,
    ).toBe('stop');
    expect(
      service.beforeCall(input({ now: 1000, deadline_at: 1001 })).allowed,
    ).toBe(false);
  });
  it.each(['PERMISSION_DENIED', 'SUBSCRIPTION_LIMIT'])(
    'never retries permission/plan %s, but permits another authorized tool',
    (code) => {
      const result = service.decide(
        input({ receipt: receipt({ status: 'blocked', error_code: code }) }),
      );
      expect(result.decision.action).toBe('allowed_alternative');
      expect(
        service.beforeCall(input({ arguments: { id: 11 } }), result.state)
          .allowed,
      ).toBe(false);
      expect(
        service.beforeCall(
          input({ tool_name: 'get_public_catalog' }),
          result.state,
        ).allowed,
      ).toBe(true);
    },
  );
  it('stops unknown effects before replay or another write, permits only explicit reconciliation read', () => {
    const result = service.decide(
      input({
        read_only: false,
        receipt: receipt({
          status: 'unknown_effect',
          effect_status: 'unknown',
        }),
      }),
    );
    expect(result.decision.action).toBe('reconcile');
    expect(
      service.beforeCall(
        input({ read_only: false, tool_name: 'create_invoice' }),
        result.state,
      ).allowed,
    ).toBe(false);
    expect(service.beforeCall(input(), result.state).allowed).toBe(false);
    expect(
      service.beforeCall(input({ reconciliation_read: true }), result.state)
        .allowed,
    ).toBe(true);
    const read = service.decide(
      input({
        receipt: receipt({
          status: 'ok',
          error_code: null,
          freshness: 'observed',
        }),
      }),
      result.state,
    );
    expect(read.state.unknown_effect).toBe(true); // a successful read is not reconciliation evidence
  });
  it('persists expansion/replan budgets through four serialized continuations', () => {
    let state: AgentRecoveryState | undefined;
    const actions: string[] = [];
    for (let i = 0; i < 6; i++) {
      const result = service.decide(
        input({ tool_name: `missing_${i}`, failure_kind: 'missing_tool' }),
        state,
      );
      actions.push(result.decision.action);
      state = JSON.parse(JSON.stringify(result.state));
    }
    expect(actions).toEqual([
      'expand_tools',
      'expand_tools',
      'change_strategy',
      'change_strategy',
      'stop',
      'stop',
    ]);
    expect(state).toMatchObject({ expansions: 2, replans: 2 });
  });
  it('never resets budgets after success or rehydrates raw arguments/secrets', () => {
    const first = service.decide(
      input({
        arguments: { password: 'DO_NOT_PERSIST', name: 'secret_customer' },
        failure_kind: 'missing_tool',
      }),
    );
    const success = service.decide(
      input({
        receipt: receipt({
          status: 'ok',
          error_code: null,
          freshness: 'observed',
        }),
      }),
      first.state,
    );
    expect(success.state.expansions).toBe(1);
    expect(JSON.stringify(success.state)).not.toMatch(
      /DO_NOT_PERSIST|secret_customer|password/,
    );
    expect(success.state.failures.every((f) => f.resolved)).toBe(true);
    expect(service.beforeCall(input(), success.state).allowed).toBe(true);
  });
  it('deduplicates receipt call IDs and fails closed for malformed or overcapacity history', () => {
    const first = service.decide(
      input({ call_id: 'call1', failure_kind: 'missing_tool' }),
    );
    const replay = service.decide(
      input({ call_id: 'call1', failure_kind: 'missing_tool' }),
      first.state,
    );
    expect(replay.state.expansions).toBe(1);
    expect(replay.decision.action).toBe('stop');
    expect(service.beforeCall(input(), {} as AgentRecoveryState).allowed).toBe(
      false,
    );
    let state: AgentRecoveryState | undefined;
    for (let i = 0; i < 65; i++)
      state = service.decide(input({ arguments: { id: i } }), state).state;
    expect(state?.failures).toHaveLength(64);
    expect(state?.exhausted).toBe(true);
  });
});
