import { AIToolRegistry } from '../tools/ai-tool-registry';
import { createCodeExecutionTools } from '../tools/domains/code-execution.tools';
import { RequestContextService } from '../../common/context/request-context.service';
import { publicSandboxArgs } from './sandbox-invocation.context';

const source =
  "const PRIVATE_CLIENT_DATA_930 = 'synthetic@example.invalid'; return {};";
const args = {
  source,
  language: 'javascript',
  tools: ['list_products'],
  purpose: 'join',
};
describe('B5 sandbox source never enters generic tool logs', () => {
  it.each(['run_readonly_script', 'legacy_script'])(
    'redacts before unavailable handler through %s',
    async (name) => {
      const run = jest
        .fn()
        .mockResolvedValue(
          JSON.stringify({
            status: 'recoverable_error',
            error_code: 'SANDBOX_UNAVAILABLE',
          }),
        );
      const registry = new AIToolRegistry({} as never);
      const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      Object.assign(registry, { logger });
      registry.registerMany(createCodeExecutionTools({ run } as never));
      registry.registerAlias('legacy_script', 'run_readonly_script');
      const output = await RequestContextService.runIsolated(
        {
          store_id: 1,
          organization_id: 2,
          user_id: 3,
          permissions: [],
          is_owner: true,
          is_super_admin: false,
        },
        () => registry.executeTool(name, args),
      );
      expect(output).toContain('SANDBOX_UNAVAILABLE');
      expect(run).toHaveBeenCalledWith(args);
      const logs = JSON.stringify(logger.log.mock.calls);
      expect(logs).toContain(
        publicSandboxArgs('run_readonly_script', args).source_hash,
      );
      expect(logs).not.toContain('PRIVATE_CLIENT_DATA_930');
      expect(logs).not.toContain('synthetic@example.invalid');
      expect(logs).not.toContain('const ');
    },
  );
  it('does not leak guest source through generic exception logging', async () => {
    const registry = new AIToolRegistry({} as never);
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    Object.assign(registry, { logger });
    registry.registerMany(
      createCodeExecutionTools({
        run: async () => {
          throw new Error(source);
        },
      } as never),
    );
    await expect(
      registry.executeTool('run_readonly_script', args),
    ).rejects.toThrow('SANDBOX_EXECUTION_FAILED');
    expect(
      JSON.stringify([logger.log.mock.calls, logger.error.mock.calls]),
    ).not.toContain(source);
  });
});
