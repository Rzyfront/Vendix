import { RequestContextService } from '../../../common/context/request-context.service';
import {
  VexiPlanStateService,
  canonicalStepHash,
} from './vexi-plan-state.service';
import { toolPreviewHash } from '../../../ai-engine/tools/ai-tool-registry';

const preview = {
  status: 'ok',
  target: 'Registro',
  changes: [{ field: 'quantity', label: 'Cantidad', from: 1, to: 2 }],
};
const args = { quantity: 2 };
describe('G canonical Vex displayed proposal identity', () => {
  beforeEach(() =>
    jest
      .spyOn(RequestContextService.asyncLocalStorage, 'getStore')
      .mockReturnValue({
        store_id: 7,
        organization_id: 3,
        user_id: 11,
        is_owner: true,
        is_super_admin: false,
      }),
  );
  afterEach(() => jest.restoreAllMocks());

  function fixture() {
    const row = { metadata: { agent_key: 'vex' } };
    const plan = {
      plan_id: 'card',
      status: 'proposed',
      steps: [
        {
          step_id: 's1',
          status: 'pending',
          tool: 'change_record',
          arguments: args,
          preview,
        },
      ],
    };
    const prisma: any = {
      ai_conversations: {
        findFirst: jest.fn(async () => row),
        updateMany: jest.fn(async ({ data }: any) => {
          row.metadata = data.metadata;
          return { count: 1 };
        }),
      },
      ai_messages: {
        findFirst: jest.fn(async () => ({ metadata: { plan } })),
        create: jest.fn(),
      },
    };
    const objective: any = {
      id: 'obj',
      step_hashes: null,
      version: 1,
      plan: null,
    };
    const repo = {
      importLegacy: jest.fn(async () => objective),
      updateHashes: jest.fn(async (_id, _version, hashes) => {
        objective.step_hashes = hashes;
        return objective;
      }),
    };
    return {
      service: new VexiPlanStateService(prisma, repo as any),
      prisma,
      plan,
      row,
      objective,
    };
  }
  it('exact original diff returns the persisted step id, not tool/current-plan id', async () => {
    const f = fixture();
    await expect(
      f.service.assertVoiceProposalPreview(
        5,
        'card',
        'change_record',
        args,
        toolPreviewHash(preview),
      ),
    ).resolves.toEqual({ stepId: 's1' });
    expect(f.prisma.ai_messages.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversation_id: 5,
          role: 'assistant',
          metadata: { path: ['plan', 'plan_id'], equals: 'card' },
        },
      }),
    );
  });
  it.each(['rejected', 'applied', 'partially_applied'])(
    'terminal plan %s cannot approve stale token',
    async (status) => {
      const f = fixture();
      f.plan.status = status;
      await expect(
        f.service.assertVoiceProposalPreview(
          5,
          'card',
          'change_record',
          args,
          toolPreviewHash(preview),
        ),
      ).rejects.toBeDefined();
    },
  );
  it('changed args/preview or non-single plan requires a new proposal', async () => {
    const f = fixture();
    await expect(
      f.service.assertVoiceProposalPreview(
        5,
        'card',
        'change_record',
        { quantity: 9 },
        toolPreviewHash(preview),
      ),
    ).rejects.toBeDefined();
    await expect(
      f.service.assertVoiceProposalPreview(
        5,
        'card',
        'change_record',
        args,
        'f'.repeat(64),
      ),
    ).rejects.toBeDefined();
    f.plan.steps.push({ ...f.plan.steps[0], step_id: 's2' });
    await expect(
      f.service.assertVoiceProposalPreview(
        5,
        'card',
        'change_record',
        args,
        toolPreviewHash(preview),
      ),
    ).rejects.toBeDefined();
  });
  it('realtime persists one same-shaped card and server canonical hashes, no secrets', async () => {
    const f = fixture();
    const identity = await f.service.persistVoiceWriteProposal(
      5,
      'change_record',
      args,
      preview,
    );
    expect(identity.stepId).toBe('s1');
    expect(f.objective.step_hashes).toMatchObject({
      plan_id: identity.planId,
      steps: [
        {
          order: 1,
          tool: 'change_record',
          args_hash: canonicalStepHash('change_record', args),
        },
      ],
    });
    expect(f.prisma.ai_messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: {
            plan: expect.objectContaining({
              plan_id: identity.planId,
              status: 'proposed',
              steps: [
                expect.objectContaining({
                  step_id: 's1',
                  status: 'pending',
                  preview,
                }),
              ],
            }),
          },
        }),
      }),
    );
    expect(
      JSON.stringify(f.prisma.ai_messages.create.mock.calls),
    ).not.toContain('confirmation_token');
  });
});
