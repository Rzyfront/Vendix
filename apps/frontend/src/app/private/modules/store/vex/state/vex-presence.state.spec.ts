import {
  VexPresenceInputs,
  formatVexElapsed,
  resolveVexPresence,
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
