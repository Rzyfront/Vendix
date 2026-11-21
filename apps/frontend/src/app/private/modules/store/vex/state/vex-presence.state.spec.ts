import {
  VEX_WAVE_SHAPE,
  VexPresenceInputs,
  formatVexElapsed,
  resolveSpokenMessageId,
  resolveVexPresence,
  vexWaveBarScale,
} from './vex-presence.state';

const IDLE: VexPresenceInputs = {
  recording: false,
  transcribing: false,
  voice_speaking: false,
  agent_typing: false,
  streaming_text: false,
  tool_running: false,
  typing: false,
};

const state = (patch: Partial<VexPresenceInputs>) =>
  resolveVexPresence({ ...IDLE, ...patch });

describe('resolveVexPresence', () => {
  it('is silent when nothing happens', () => {
    expect(state({})).toBe('silent');
  });

  it('listens to text while the person types', () => {
    expect(state({ typing: true })).toBe('listening_text');
  });

  it('listens to voice while dictating, over everything else', () => {
    expect(
      state({
        recording: true,
        voice_speaking: true,
        agent_typing: true,
        typing: true,
      }),
    ).toBe('listening_voice');
  });

  it('thinks from the send until the first text', () => {
    expect(state({ agent_typing: true })).toBe('thinking');
  });

  it('thinks while transcribing the dictation', () => {
    expect(state({ transcribing: true })).toBe('thinking');
  });

  it('keeps thinking while a tool runs even after text arrived', () => {
    expect(
      state({ agent_typing: true, streaming_text: true, tool_running: true }),
    ).toBe('thinking');
  });

  it('speaks while the text streams', () => {
    expect(state({ agent_typing: true, streaming_text: true })).toBe('speaking');
  });

  it('speaks when reading aloud, before thinking and typing', () => {
    expect(
      state({ voice_speaking: true, agent_typing: true, typing: true }),
    ).toBe('speaking');
  });

  it('prefers thinking over listening_text', () => {
    expect(state({ agent_typing: true, typing: true })).toBe('thinking');
  });
});

describe('formatVexElapsed', () => {
  it('formats mm:ss', () => {
    expect(formatVexElapsed(0)).toBe('00:00');
    expect(formatVexElapsed(65)).toBe('01:05');
    expect(formatVexElapsed(600)).toBe('10:00');
  });

  it('is safe with bad input', () => {
    expect(formatVexElapsed(-3)).toBe('00:00');
    expect(formatVexElapsed(Number.NaN)).toBe('00:00');
  });
});

describe('resolveSpokenMessageId', () => {
  const thread = ['m-1', 'm-2', 'm-3'];

  it('highlights the message that is being read, not the last one', () => {
    expect(resolveSpokenMessageId(true, 'm-2', thread)).toBe('m-2');
  });

  it('highlights nothing when no audio is playing', () => {
    expect(resolveSpokenMessageId(false, 'm-2', thread)).toBeNull();
  });

  it('highlights nothing when the spoken message is not on screen', () => {
    expect(resolveSpokenMessageId(true, 'm-9', thread)).toBeNull();
    expect(resolveSpokenMessageId(true, null, thread)).toBeNull();
  });
});

describe('vexWaveBarScale', () => {
  it('keeps the bars at their floor in silence', () => {
    for (const weight of VEX_WAVE_SHAPE) {
      expect(vexWaveBarScale(0, weight)).toBe(0.15);
    }
  });

  it('grows with the microphone volume', () => {
    const quiet = vexWaveBarScale(0.2, 1);
    const loud = vexWaveBarScale(0.8, 1);
    expect(loud).toBeGreaterThan(quiet);
    expect(vexWaveBarScale(1, 1)).toBe(1);
  });

  it('draws the center bar taller than the edges at the same volume', () => {
    expect(vexWaveBarScale(0.6, 1)).toBeGreaterThan(vexWaveBarScale(0.6, 0.45));
  });

  it('is safe with bad input', () => {
    expect(vexWaveBarScale(Number.NaN, 1)).toBe(0.15);
    expect(vexWaveBarScale(7, 1)).toBe(1);
    expect(vexWaveBarScale(-2, 1)).toBe(0.15);
  });
});
