import {
  VoiceConsentContext,
  VoiceConsentReceipt,
  voiceCaptureAllowed,
  voiceChallengeExpiry,
  voiceProposalIdentity,
  voiceProposalReadout,
  voiceReceiptWasApplied,
  voiceChallengeRequest,
  voiceClickRequest,
  voiceConsentSessionRequest,
} from './vexi-voice-consent.model';
import type { VexiProposal } from '../store/vexi/vexi.actions';
import type { VexiToolExecution } from './vexi-api.service';

const context: VoiceConsentContext = {
  conversation_id: 7,
  agent_key: 'vex',
  channel: 'pipeline',
  objective_id: 'objective-1',
};
const proposal: VexiProposal = {
  tool: 'change_price',
  arguments: { product_id: 42, price: 50 },
  confirmationToken: 'opaque',
  applying: false,
  preview: {
    status: 'warning',
    target: 'Café 1 kg',
    changes: [
      { field: 'price', label: 'Precio', from: 42, to: 50 },
      { field: 'quantity', label: 'Cantidad', from: 2, to: 3 },
    ],
    message: 'Esta acción no se puede deshacer.',
  },
};
const allowed = {
  now: 1000,
  expiresAt: 2000,
  focused: true,
  visible: true,
  assistantSilent: true,
  epoch: 4,
  expectedEpoch: 4,
};
const execution: VexiToolExecution = {
  schema_version: '1',
  status: 'ok',
  effect_status: 'applied',
  freshness: 'observed',
  error_code: null,
  retryable: false,
  next_action: null,
  evidence_refs: ['receipt-1'],
  resource_ids: { product: 42 },
};

describe('G dedicated voice consent UI guards (not STT or acoustic proof)', () => {
  it('allows only the active focused silent foreground challenge', () => {
    expect(voiceCaptureAllowed(allowed)).toBe(true);
  });
  [
    { focused: false },
    { visible: false },
    { assistantSilent: false },
    { epoch: 5 },
    { now: 2000 },
    { now: 2001 },
    { expiresAt: NaN },
    { expiresAt: Infinity },
  ].forEach((patch, index) => {
    it(
      'fails closed when a challenge boundary changes: %j' +
        ' (caso ' +
        index +
        ')',
      () => {
        expect(voiceCaptureAllowed({ ...allowed, ...patch })).toBe(false);
      },
    );
  });
  it('recognizes ISO and Unix expiry without extending it', () => {
    expect(voiceChallengeExpiry('2026-10-17T12:00:00.000Z')).toBe(
      1792238400000,
    );
    expect(voiceChallengeExpiry(1792238400)).toBe(1792238400000);
    expect(voiceChallengeExpiry(1792238400000)).toBe(1792238400000);
    expect(Number.isNaN(voiceChallengeExpiry('invalid'))).toBe(true);
  });
  it('reads all subjects, values, quantities and the irreversible consequence without truncation', () => {
    const text = voiceProposalReadout(proposal);
    for (const expected of [
      'Café 1 kg',
      'Precio: de 42 a 50',
      'Cantidad: de 2 a 3',
      'no se puede deshacer',
      'dictado normal no autoriza',
    ]) {
      expect(text).toContain(expected);
    }
    const long = 'x'.repeat(8000);
    expect(
      voiceProposalReadout({
        ...proposal,
        preview: { ...proposal.preview!, message: long },
      }),
    ).toContain(long);
  });
  it('changes binding on diff, arguments, token, conversation, objective, channel or agent changes', () => {
    const identity = voiceProposalIdentity(proposal, context);
    const alternatives: Array<[VexiProposal, VoiceConsentContext]> = [
      [{ ...proposal, arguments: { price: 51 } }, context],
      [{ ...proposal, confirmationToken: 'new' }, context],
      [
        { ...proposal, preview: { ...proposal.preview!, target: 'Otro café' } },
        context,
      ],
      [proposal, { ...context, conversation_id: 8 }],
      [proposal, { ...context, objective_id: 'other' }],
      [proposal, { ...context, channel: 'realtime' }],
      [proposal, { ...context, agent_key: 'vexi' }],
      [proposal, { ...context, proposal_id: 'other' }],
    ];
    for (const [next, binding] of alternatives)
      expect(voiceProposalIdentity(next, binding)).not.toBe(identity);
    expect(
      voiceProposalIdentity({ ...proposal, applying: true }, context),
    ).toBe(identity);
  });
  it('does not infer an applied result from an HTTP success or a pending typed receipt', () => {
    const receipt: VoiceConsentReceipt = {
      tool: 'change_price',
      output: '{}',
      execution,
    };
    expect(voiceReceiptWasApplied(receipt)).toBe(true);
    for (const patch of [
      { status: 'unknown_effect' as const },
      { effect_status: 'pending' as const },
      { effect_status: 'unknown' as const },
      { freshness: 'unknown' as const },
      { status: 'blocked' as const },
    ])
      expect(
        voiceReceiptWasApplied({
          ...receipt,
          execution: { ...execution, ...patch },
        }),
      ).toBe(false);
    expect(
      voiceReceiptWasApplied({
        tool: 'write',
        output: '',
        step_status: 'pending',
      }),
    ).toBe(false);
    expect(
      voiceReceiptWasApplied({
        tool: 'write',
        output: '',
        step_status: 'applied',
      }),
    ).toBe(true);
  });
  it('keeps realtime click and spoken rebind requests opaque even if an unexpected raw token exists locally', () => {
    const realtime: VoiceConsentContext = {
      ...context,
      channel: 'realtime',
      session_id: 'original-session',
      proposal_id: 'original-proposal',
    };
    expect(voiceClickRequest(realtime)).toEqual({
      session_id: 'original-session',
      proposal_id: 'original-proposal',
    });
    expect(
      voiceChallengeRequest('fresh-capture-session', realtime, proposal),
    ).toEqual({
      session_id: 'fresh-capture-session',
      proposal_id: 'original-proposal',
    });
    expect(voiceConsentSessionRequest(realtime)).toEqual({
      conversation_id: 7,
      agent_key: 'vex',
      channel: 'realtime',
    });
    expect(
      voiceClickRequest({ ...realtime, session_id: undefined }),
    ).toBeNull();
    expect(
      voiceClickRequest({ ...realtime, proposal_id: undefined }),
    ).toBeNull();
  });
  it('preserves token-based text proposal registration without widening its outbound context', () => {
    expect(voiceChallengeRequest('capture-session', context, proposal)).toEqual(
      {
        session_id: 'capture-session',
        tool: proposal.tool,
        arguments: proposal.arguments,
        confirmation_token: proposal.confirmationToken,
      },
    );
  });
  it('retains the successful legacy apply ABI when no semantic envelope exists', () => {
    expect(voiceReceiptWasApplied({ tool: 'write', output: '{}' })).toBe(true);
  });
});
