import { createCapabilityTools } from './capability.tools';
import { CapabilityRegistryService } from './capability-registry.service';

function listCapabilities(describeDomain: jest.Mock) {
  const [tool] = createCapabilityTools({
    capabilities: {
      describeDomain,
      listDomains: jest.fn().mockReturnValue([]),
      gaps: jest.fn().mockReturnValue([]),
    } as unknown as CapabilityRegistryService,
  });
  return tool;
}

describe('list_capabilities', () => {
  it('an area without bridge routes points to search_tools, not to guessed routes', async () => {
    const tool = listCapabilities(jest.fn().mockReturnValue([]));
    const answer = JSON.parse(
      await tool.handler!({ domain: 'suppliers' }, {} as never),
    );

    expect(answer.total).toBe(0);
    expect(answer.next_step).toMatch(/search_tools/);
    expect(answer.next_step).toMatch(/no adivines rutas/);
  });

  it('an area with routes keeps asking for the full contract first', async () => {
    const tool = listCapabilities(
      jest.fn().mockReturnValue([
        {
          area: 'store',
          module_hint: 'expenses',
          reads: [{ id: 'expenses.list', fields: [] }],
          writes: [],
        },
      ]),
    );
    const answer = JSON.parse(
      await tool.handler!({ domain: 'expenses' }, {} as never),
    );

    expect(answer.total).toBe(1);
    expect(answer.next_step).toMatch(/list_endpoints/);
  });
});
