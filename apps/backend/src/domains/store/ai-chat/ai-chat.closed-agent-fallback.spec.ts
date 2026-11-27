import { AIChatService, closedAgentFallback } from './ai-chat.service';

/**
 * Vexi público F2 — closes the F1 open fallback of `resolveChatAgent`: a
 * missing/inactive/unreadable `vexi` row must never turn into "no agent"
 * (= the caller's whole permission catalog). Vex keeps the old fallback.
 */
function service(findUnique: jest.Mock) {
  const svc = Object.create(AIChatService.prototype) as any;
  svc.globalPrisma = { ai_agents: { findUnique } };
  svc.logger = { warn: jest.fn(), log: jest.fn() };
  return svc as { resolveChatAgent(key: string | null): Promise<any> };
}

const NO_TOOLS_VEXI = {
  key: 'vexi',
  app_key: null,
  system_prompt: null,
  allowed_tools: [],
  denied_tools: [],
  max_iterations: null,
  timeout_seconds: null,
};

describe('resolveChatAgent closed-catalog fallback (Vexi público F2)', () => {
  it.each([
    ['missing', jest.fn().mockResolvedValue(null)],
    ['inactive', jest.fn().mockResolvedValue({ key: 'vexi', is_active: false })],
    ['lookup error', jest.fn().mockRejectedValue(new Error('no table'))],
  ])('vexi row %s → vexi with no tools, never null', async (_label, findUnique) => {
    await expect(service(findUnique).resolveChatAgent('vexi')).resolves.toEqual(
      NO_TOOLS_VEXI,
    );
  });

  it('an open agent (vex) keeps the previous fallback (null)', async () => {
    await expect(
      service(jest.fn().mockResolvedValue(null)).resolveChatAgent('vex'),
    ).resolves.toBeNull();
    expect(closedAgentFallback('vex')).toBeNull();
  });

  it('no agent key stays null (unchanged)', async () => {
    const findUnique = jest.fn();
    await expect(service(findUnique).resolveChatAgent(null)).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveChatAgent staff app (R1: vexi row -> vexi_storefront)', () => {
  const row = (key: string, app_key: string | null) => ({
    key,
    is_active: true,
    app_key,
    system_prompt: null,
    allowed_tools: [],
    denied_tools: [],
    max_iterations: null,
    timeout_seconds: null,
  });

  it('the admin dock (vexi staff turn) keeps chat_assistant and its business metrics', async () => {
    const svc = service(
      jest.fn().mockResolvedValue(row('vexi', 'vexi_storefront')),
    );
    await expect(svc.resolveChatAgent('vexi')).resolves.toMatchObject({
      key: 'vexi',
      app_key: 'chat_assistant',
    });
  });

  it('Vex keeps exactly the app its row says', async () => {
    const svc = service(jest.fn().mockResolvedValue(row('vex', 'vex_assistant')));
    await expect(svc.resolveChatAgent('vex')).resolves.toMatchObject({
      key: 'vex',
      app_key: 'vex_assistant',
    });
  });
});
