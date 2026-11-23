/**
 * Presence of Vex: what it is doing right now, from the person's point of
 * view. ONE pure function maps every source signal to ONE state, so the header
 * badge, the composer chip and the thread can never disagree.
 */
export type VexPresenceState =
  | 'listening_text'
  | 'listening_voice'
  | 'thinking'
  | 'speaking'
  | 'silent';

export interface VexPresenceInputs {
  /** Dictation is capturing the microphone (`pipeline.recording()`). */
  recording: boolean;
  /** The dictated audio is being turned into text (`pipeline.state() === 'transcribing'`). */
  transcribing: boolean;
  /** Vex is reading an answer aloud (`pipeline.speaking()`). */
  voice_speaking: boolean;
  /** A turn is in flight (`store.is_agent_typing()`). */
  agent_typing: boolean;
  /** The answer already has text (or blocks) on screen. */
  streaming_text: boolean;
  /** A tool of the turn is running (reading data, preparing a plan…). */
  tool_running: boolean;
  /** The person pressed a key in the composer less than `VEX_TYPING_IDLE_MS` ago. */
  typing: boolean;
}

/** Silence after the last keystroke before "listening" goes back to "silent". */
export const VEX_TYPING_IDLE_MS = 1200;

/**
 * Priority: listening_voice > speaking (voice) > thinking > speaking (writing)
 * > listening_text > silent.
 */
export function resolveVexPresence(input: VexPresenceInputs): VexPresenceState {
  if (input.recording) return 'listening_voice';
  if (input.voice_speaking) return 'speaking';
  const thinking =
    input.transcribing ||
    (input.agent_typing && (!input.streaming_text || input.tool_running));
  if (thinking) return 'thinking';
  if (input.agent_typing) return 'speaking';
  if (input.typing) return 'listening_text';
  return 'silent';
}

/** `mm:ss` of an elapsed number of seconds (never negative). */
export function formatVexElapsed(total_seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(total_seconds) ? total_seconds : 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Message to highlight as "being read aloud": the one whose audio is playing,
 * and only while it plays and is still on screen. Never a guess — when the
 * spoken message is not in the open thread, nothing is highlighted.
 */
export function resolveSpokenMessageId(
  voice_speaking: boolean,
  spoken_message_id: string | null,
  thread_message_ids: readonly string[],
): string | null {
  if (!voice_speaking || !spoken_message_id) return null;
  return thread_message_ids.includes(spoken_message_id)
    ? spoken_message_id
    : null;
}

/** Relative height of each of the seven bars of the listening wave (center tallest). */
export const VEX_WAVE_SHAPE = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45] as const;

/**
 * `scaleY` of one wave bar for a microphone level (0..1): a quiet room leaves
 * the bars at their floor, speech lifts them in proportion to the volume.
 */
export function vexWaveBarScale(level: number, weight: number): number {
  const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const floor = 0.15;
  return Math.round((floor + (1 - floor) * safe * weight) * 100) / 100;
}
