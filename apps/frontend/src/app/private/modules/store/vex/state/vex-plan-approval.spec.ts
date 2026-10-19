import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { VexChatStore } from './vex-chat.store';
import { VexApiService } from '../services/vex-api.service';
import { VexiApiService } from '../../../../../core/services/vexi-api.service';
import { VexiVoicePipelineService } from '../../../../../core/services/vexi-voice-pipeline.service';
import { VexiVoiceSafetyService } from '../../../../../core/services/vexi-voice-safety.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { VexPlanCardComponent } from '../components/vex-plan-card/vex-plan-card.component';
import type { VexPlanProposal } from '../models/vex.models';

describe('B4/M3 Vex plan store and own cards', () => {
  let store: VexChatStore;
  let api: jasmine.SpyObj<VexApiService>;
  let plan: VexPlanProposal;
  beforeEach(async () => {
    api = jasmine.createSpyObj('VexApiService', [
      'listConversations',
      'approvePlan',
      'applyConfirmation',
      'requestStepConfirmation',
      'applyStepConfirmation',
      'getConversation',
    ]);
    api.listConversations.and.returnValue(
      of({ data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }),
    );
    TestBed.configureTestingModule({
      providers: [
        VexChatStore,
        { provide: VexApiService, useValue: api },
        { provide: VexiApiService, useValue: {} },
        { provide: VexiVoicePipelineService, useValue: {} },
        {
          provide: VexiVoiceSafetyService,
          useValue: { invalidate: jasmine.createSpy('invalidate') },
        },
        {
          provide: ToastService,
          useValue: { error: jasmine.createSpy('error') },
        },
      ],
    });
    store = TestBed.inject(VexChatStore);
    await Promise.resolve(); // Constructor list load settles before seeding the active thread.
    plan = {
      plan_id: 'legacy-plan',
      title: 'Dos cambios',
      status: 'proposed',
      steps: [1, 2].map((n) => ({
        step_id: `s${n}`,
        tool: 'create_customer',
        summary: `Cliente ${n}`,
        arguments: { name: `Cliente ${n}` },
        irreversible: false,
        status: 'pending',
      })),
    };
    (store as any)._active_id.set('7');
    (store as any)._conversations.set([
      {
        id: '7',
        title: 'QA',
        created_at: new Date(),
        updated_at: new Date(),
        messages: [
          {
            id: 'm1',
            role: 'agent',
            content: '',
            created_at: new Date(),
            plan,
          },
        ],
      },
    ]);
    api.approvePlan.and.returnValue(
      of({
        plan_id: plan.plan_id,
        plan_token: 'first-only',
        expires_in_seconds: 900,
        covered_steps: [1],
        reconfirm_steps: [2],
        ignored_steps: [],
      }),
    );
    api.applyConfirmation.and.returnValue(
      of({
        tool: 'create_customer',
        output: '{}',
        step_status: 'applied',
        plan_status: 'approved',
      }),
    );
  });
  const current = (s: VexChatStore) =>
    s.active_conversation()!.messages[0].plan!;
  for (const initial of ['proposed', 'approved', 'single'] as const) {
    it(`N1 folds voice unknown from ${initial} like click and remains blocked after thread reload`, async () => {
      plan.plan_id =
        initial === 'single'
          ? 'single-voice'
          : 'd973bb78-8c4a-4daa-a600-b9969d726447';
      plan.status = initial === 'approved' ? 'approved' : 'proposed';
      const token = initial === 'proposed' ? '' : 'old-token';
      plan.steps = [
        { ...plan.steps[0], confirmation_token: token || undefined },
      ];
      store.acceptVoiceReceipt('m1', plan.plan_id, {
        context: {
          conversation_id: 7,
          agent_key: 'vex',
          channel: 'pipeline',
          step_id: 's1',
        },
        confirmationToken: token,
        proposalArguments: plan.steps[0].arguments,
        receipt: {
          tool: 'create_customer',
          output: '{}',
          step_status: 'unknown',
          plan_status: 'unknown_effect',
          execution: {
            schema_version: '1',
            status: 'unknown_effect',
            effect_status: 'unknown',
            freshness: 'unknown',
            retryable: false,
            error_code: null,
            next_action: 'Reconciliar antes de repetir.',
            resource_ids: {},
            evidence_refs: [],
          },
        },
      });
      const assertBlocked = () => {
        const value = current(store);
        expect(value.status).toBe('unknown_effect');
        expect(value.steps[0].status).toBe('unknown');
        expect(value.steps[0].confirmation_token).toBeUndefined();
        expect(value.steps[0].error).toBe('Reconciliar antes de repetir.');
        const card = TestBed.runInInjectionContext(
          () => new VexPlanCardComponent(),
        );
        Object.assign(card, { plan: signal(value), conversationId: signal(7) });
        expect(card.single_status_label(value.steps[0])).toBe(
          'Pendiente de verificación',
        );
        expect(card.is_open()).toBe(false);
        expect(card.show_own_card(value.steps[0])).toBe(false);
        expect(card.voiceContext(value.steps[0])).toBeNull();
        const message = store.active_conversation()!.messages[0];
        store.approvePlan(message.id, value.plan_id);
        store.approveStep(message.id, value, 's1', 'old-token');
        expect(api.approvePlan).not.toHaveBeenCalled();
        expect(api.requestStepConfirmation).not.toHaveBeenCalled();
        expect(api.applyConfirmation).not.toHaveBeenCalled();
        expect(api.applyStepConfirmation).not.toHaveBeenCalled();
      };
      assertBlocked();
      const persisted = {
        plan_id: plan.plan_id,
        status: 'unknown_effect',
        steps: [{ ...current(store).steps[0] }],
      };
      api.getConversation.and.returnValue(
        of({
          id: 7,
          title: 'QA',
          status: 'active',
          metadata: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          messages: [
            {
              id: 1,
              role: 'assistant',
              content: '',
              tool_calls: null,
              metadata: { plan: persisted },
              created_at: new Date().toISOString(),
            },
          ],
        }),
      );
      await (store as any).loadThread('7');
      assertBlocked();
    });
  }
  it('N1 fails closed for voice receipts missing semantic statuses instead of returning to pending', () => {
    plan.steps = [plan.steps[0]];
    store.acceptVoiceReceipt('m1', plan.plan_id, {
      context: {
        conversation_id: 7,
        agent_key: 'vex',
        channel: 'pipeline',
        step_id: 's1',
      },
      confirmationToken: '',
      proposalArguments: plan.steps[0].arguments,
      receipt: { tool: 'create_customer', output: '{}' },
    });
    expect(current(store).status).toBe('unknown_effect');
    expect(current(store).steps[0].status).toBe('unknown');
  });
  it('N1 retains applied voice state when the server reports an applied receipt', () => {
    plan.steps = [plan.steps[0]];
    store.acceptVoiceReceipt('m1', plan.plan_id, {
      context: {
        conversation_id: 7,
        agent_key: 'vex',
        channel: 'pipeline',
        step_id: 's1',
      },
      confirmationToken: '',
      proposalArguments: plan.steps[0].arguments,
      receipt: {
        tool: 'create_customer',
        output: '{}',
        step_status: 'applied',
        plan_status: 'applied',
      },
    });
    expect(current(store).status).toBe('done');
    expect(current(store).steps[0].status).toBe('done');
  });
  it('N3 marks an applied single-use voice receipt done, like the click path', () => {
    // `single-` cards carry no server plan: the backend sink now synthesizes the
    // applied step/plan state that runSingleUseApply adds for click.
    plan.plan_id = 'single-voice';
    plan.steps = [{ ...plan.steps[0], confirmation_token: 'single-use' }];
    store.acceptVoiceReceipt('m1', plan.plan_id, {
      context: {
        conversation_id: 7,
        agent_key: 'vex',
        channel: 'pipeline',
        step_id: 's1',
      },
      confirmationToken: 'single-use',
      proposalArguments: plan.steps[0].arguments,
      receipt: {
        tool: 'create_customer',
        output: '{}',
        summary: 'Cliente creado.',
        step_status: 'applied',
        plan_status: 'applied',
        execution: {
          schema_version: '1',
          status: 'ok',
          effect_status: 'applied',
          freshness: 'observed',
          retryable: false,
          error_code: null,
          next_action: null,
          resource_ids: {},
          evidence_refs: [],
        },
      },
    });
    expect(current(store).status).toBe('done');
    expect(current(store).steps[0].status).toBe('done');
    expect(current(store).steps[0].error).toBeUndefined();
    const messages = store.active_conversation()!.messages;
    expect(messages[messages.length - 1].content).toBe('Cliente creado.');
  });
  it('applies only covered first change and leaves second reachable after token loss/reload', async () => {
    await (store as any).runPlanApproval('7', 'm1', 7, plan);
    expect(api.applyConfirmation).toHaveBeenCalledTimes(1);
    expect(current(store).steps.map((s) => s.status)).toEqual([
      'done',
      'pending',
    ]);
    (store as any).plan_tokens.clear();
    const card = TestBed.runInInjectionContext(
      () => new VexPlanCardComponent(),
    );
    // Logic-only card assertion; this does not certify the template or E2E.
    Object.assign(card, { plan: signal(current(store)) });
    expect(card.show_own_card(current(store).steps[1])).toBe(true);
    api.requestStepConfirmation.and.returnValue(
      of({ confirmation_token: 'fresh-for-s2', expires_in: 60 }),
    );
    api.applyConfirmation.and.returnValue(
      of({
        tool: 'create_customer',
        output: '{}',
        step_status: 'applied',
        plan_status: 'applied',
      }),
    );
    spyOn(store as any, 'reopenNarration');
    store.approveStep('m1', current(store), 's2');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(api.requestStepConfirmation).toHaveBeenCalledWith(
      'legacy-plan',
      's2',
      7,
    );
    expect(api.applyConfirmation.calls.mostRecent().args[0]).toEqual({
      conversationId: 7,
      planId: 'legacy-plan',
      stepId: 's2',
      confirmationToken: 'fresh-for-s2',
    });
    expect(current(store).steps.map((s) => s.status)).toEqual(['done', 'done']);
  });
  it('also preserves uncertain effects for a single-step fallback token', async () => {
    plan.plan_id = 'single-qa';
    plan.steps = [{ ...plan.steps[0], confirmation_token: 'single-use' }];
    api.applyStepConfirmation.and.returnValue(
      of({
        tool: 'create_customer',
        output: '{}',
        execution: {
          schema_version: '1',
          status: 'unknown_effect',
          effect_status: 'unknown',
          freshness: 'unknown',
          retryable: false,
          next_action: 'Reconciliar.',
          error_code: null,
          resource_ids: {},
          evidence_refs: [],
        },
      }),
    );
    const reopen = spyOn(store as any, 'reopenNarration');
    store.approvePlan('m1', plan.plan_id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(current(store).status).toBe('unknown_effect');
    expect(current(store).steps[0].status).toBe('unknown');
    expect(current(store).steps[0].confirmation_token).toBeUndefined();
    expect(reopen).not.toHaveBeenCalled();
    store.approvePlan('m1', plan.plan_id);
    expect(api.applyStepConfirmation).toHaveBeenCalledTimes(1);
  });
  it('renders uncertain receipt as reconciliation and stops loop/reapproval, never Hecho', async () => {
    api.applyConfirmation.and.returnValue(
      of({
        tool: 'create_customer',
        output: '{}',
        execution: {
          schema_version: '1',
          status: 'unknown_effect',
          effect_status: 'unknown',
          freshness: 'unknown',
          retryable: false,
          next_action: 'Reconciliar.',
          error_code: null,
          resource_ids: {},
          evidence_refs: [],
        },
      }),
    );
    await (store as any).runPlanApproval('7', 'm1', 7, plan);
    expect(current(store).status).toBe('unknown_effect');
    expect(current(store).steps[0].status).toBe('unknown');
    const card = TestBed.runInInjectionContext(
      () => new VexPlanCardComponent(),
    );
    // Logic-only card assertion; this does not certify the template or E2E.
    Object.assign(card, { plan: signal(current(store)) });
    expect(card.single_status_label(current(store).steps[0])).toBe(
      'Pendiente de verificación',
    );
    expect(card.show_own_card(current(store).steps[1])).toBe(false);
    store.approvePlan('m1', plan.plan_id);
    store.approveStep('m1', current(store), 's1', 'old-token');
    expect(api.applyConfirmation).toHaveBeenCalledTimes(1);
    expect(api.approvePlan).toHaveBeenCalledTimes(1);
    expect(api.requestStepConfirmation).not.toHaveBeenCalled();
  });
});
