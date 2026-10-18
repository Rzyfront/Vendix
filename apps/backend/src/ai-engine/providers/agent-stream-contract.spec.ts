import {
  canonicalAgentTools,
  reportedAgentUsage,
  validateAgentToolCalls,
} from './agent-stream-contract';

describe('H provider terminal contract', () => {
  const tool = (name: string) => ({
    type: 'function' as const,
    function: { name, description: name, parameters: { type: 'object' } },
  });
  const call = (name: string, id = 'a', args = '{}') => ({
    id,
    type: 'function' as const,
    function: { name, arguments: args },
  });

  it('canonically sorts only the authorized working set without mutating definitions or adding tools', () => {
    const tools = [tool('z'), tool('a')];
    const ordered = canonicalAgentTools(tools)!;
    expect(ordered.map((t) => t.function.name)).toEqual(['a', 'z']);
    expect(tools.map((t) => t.function.name)).toEqual(['z', 'a']);
    expect(ordered[0]).toBe(tools[1]);
    expect(canonicalAgentTools(undefined)).toBeUndefined();
  });
  it('rejects duplicate working-set names before SDK dispatch', () => {
    expect(() => canonicalAgentTools([tool('a'), tool('a')])).toThrow(
      'Duplicate',
    );
  });
  it('validates the entire batch, not a prefix before an invalid sibling', () => {
    expect(() =>
      validateAgentToolCalls(
        [call('a'), call('z', 'b', '{"quantity":')],
        [tool('a'), tool('z')],
      ),
    ).toThrow('JSON');
    expect(() =>
      validateAgentToolCalls([call('a'), call('z')], [tool('a'), tool('z')]),
    ).toThrow('Invalid');
    expect(() =>
      validateAgentToolCalls([call('unoffered')], [tool('a')]),
    ).toThrow('unoffered');
    const calls = [call('a'), call('z', 'b', '{"quantity":2}')];
    expect(validateAgentToolCalls(calls, [tool('a'), tool('z')])).toEqual(
      calls,
    );
  });
  it.each(['[]', 'null', '1', 'true', '"s"'])(
    'rejects non-object completed arguments %s',
    (args) => {
      expect(() =>
        validateAgentToolCalls([call('a', 'id', args)], [tool('a')]),
      ).toThrow('object');
    },
  );
  it('does not manufacture unknown cache counters or infer cache hits from cache hints', () => {
    const usage = { promptTokens: 10, completionTokens: 2, totalTokens: 12 };
    expect(reportedAgentUsage(usage)).toEqual(usage);
    expect(reportedAgentUsage(usage)).not.toHaveProperty('cacheReadTokens');
    expect(reportedAgentUsage(undefined)).toBeUndefined();
  });
  it.each([
    { promptTokens: -1, completionTokens: 2, totalTokens: 1 },
    { promptTokens: NaN, completionTokens: 2, totalTokens: 12 },
    { promptTokens: 10, completionTokens: Infinity, totalTokens: 12 },
    { promptTokens: 10.5, completionTokens: 2, totalTokens: 12.5 },
    {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cacheReadTokens: 5,
    },
  ])(
    'keeps invalid provider usage unknown instead of charging fake counts %#',
    (usage) => {
      expect(reportedAgentUsage(usage)).toBeUndefined();
    },
  );
  it('counts total tokens once across fresh/read/create usage', () => {
    const usage = {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 42,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
    };
    expect(reportedAgentUsage(usage)).toBe(usage);
  });
  it('validates all schemas and coerces only private parsed copies', () => {
    const definition = tool('a');
    definition.function.parameters = {
      type: 'object',
      properties: { quantity: { type: 'integer' } },
      required: ['quantity'],
    } as any;
    const good = call('a', 'good', '{"quantity":"2"}');
    const invalid = call('a', 'bad', '{"quantity":"not-number"}');
    expect(() => validateAgentToolCalls([good, invalid], [definition])).toThrow(
      'schema',
    );
    expect(good.function.arguments).toBe('{"quantity":"2"}');
    expect(
      validateAgentToolCalls([good], [definition])[0].function.arguments,
    ).toBe('{"quantity":2}');
  });
  it('normalizes compatible namespaces only to an exactly offered name', () => {
    expect(
      validateAgentToolCalls([call('default_api.a')], [tool('a')])[0].function
        .name,
    ).toBe('a');
    expect(() =>
      validateAgentToolCalls([call('default_api.private_write')], [tool('a')]),
    ).toThrow('unoffered');
    expect(() =>
      validateAgentToolCalls([call('legacy_alias')], [tool('a')]),
    ).toThrow('unoffered');
  });
});
