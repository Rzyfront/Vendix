import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { VexiVoiceSafetyService } from './vexi-voice-safety.service';
import { ToastService } from '../../shared/components/toast/toast.service';
import { environment } from '../../../environments/environment';

/**
 * Where the turn is, from the person's point of view.
 *
 * `permission` exists because the browser's mic dialog eats the gesture that
 * opened it: the first hold can never be a real recording, and the UI has to say
 * so instead of appearing broken.
 */
export type VexiPipelineState =
  | 'idle'
  | 'permission'
  | 'recording'
  | 'transcribing'
  | 'speaking'
  | 'error';

/** A synthesized piece of the answer, as the stream delivers it. */
export interface VexiAudioFrame {
  index: number;
  audio_base64: string;
  content_type: string;
  filler?: boolean;
}

/** Latency marks, merged from both sides of the wire. */
export interface VexiVoiceMarks {
  /** Mic up → transcript in hand. The STT leg, measured by the client. */
  releaseToTextMs?: number;
  /** Mic up → first sample audible. This is the number the person feels. */
  perceivedMs?: number;
  /** Mic up → first sample of *content* audible, fillers excluded. */
  contentMs?: number;
  /** The server's marks, relative to the moment the stream opened. */
  server: Record<string, number>;
}

/**
 * Shortest hold that counts as speech. Below it the recording is discarded
 * without a round trip — a mis-tap must not cost an STT call.
 */
const MIN_TALK_MS = 350;

/** Smallest recording worth transcribing. A container header alone exceeds none. */
const MIN_BLOB_BYTES = 1500;

/**
 * How often the recorder hands over a slice.
 *
 * This is the chained-upload interval: while the person is still talking the
 * bytes are already travelling, so on release only the tail is left to send.
 * One second is the compromise — shorter multiplies requests for no gain,
 * longer leaves too much on the critical path.
 */
const CHUNK_INTERVAL_MS = 1000;

/**
 * How long playback waits for a missing index before skipping it.
 *
 * A gap is normal: one failed segment degrades to text-only and its index never
 * arrives. A 400-char synthesis call to MiniMax/OpenAI regularly takes 2-4 s, so
 * 1.5 s skipped segments that were still on their way. 8 s comfortably clears
 * normal provider latency while still recovering from a genuinely lost frame.
 */
const HOLE_TOLERANCE_MS = 8000;

/** Minimal valid silent WAV used to unlock HTMLAudioElement inside a user gesture. */
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

/** Containers to try, best first. Safari only has the last one. */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

interface QueuedAudio {
  url: string;
  filler: boolean;
}

/**
 * Capture and playback for the pipeline voice mode.
 *
 * Owns only what the browser owns: the microphone, the upload of its bytes, and
 * the speaker. It deliberately does **not** dispatch anything — the transcript it
 * returns is sent through the normal chat path, which is the entire premise of
 * the pipeline: a voice turn is a chat turn, so it must not have a second way in.
 *
 * Audio never enters the NgRx store. A base64 mp3 in a reducer is megabytes of
 * non-serialisable-in-practice state and a devtools timeline nobody can read;
 * playback is imperative browser state, like the `HTMLAudioElement` the realtime
 * engine holds.
 */
/**
 * Loudness (0..1) of one window of 8-bit time-domain samples (128 = silence):
 * root mean square, scaled so normal speech fills most of the range.
 */
export function micLevelFromSamples(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index++) {
    const centered = (samples[index] - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.max(0, rms * 4));
}

@Injectable({ providedIn: 'root' })
export class VexiVoicePipelineService {
  private readonly http = inject(HttpClient);
  private readonly safety = inject(VexiVoiceSafetyService);
  private readonly toast = inject(ToastService);
  private readonly baseUrl = `${environment.apiUrl}/store/vexi/voice`;

  /**
   * T14 — why the last answer came as text only: the plan does not include
   * this agent's voice, or the month's reading seconds ran out. `null` while
   * the voice works.
   */
  readonly voiceNotice = signal<string | null>(null);

  readonly state = signal<VexiPipelineState>('idle');
  readonly errorMessage = signal<string | null>(null);

  /**
   * True once the mic prompt has been answered. The first hold is spent on the
   * dialog, so the UI asks for a second one rather than appearing to do nothing.
   */
  readonly permissionResolved = signal(false);

  /**
   * What the person just said, as the transcriber heard it.
   *
   * The user half of the closed captions. The assistant half comes from the
   * chat facade (`streamingContent()` / `messages()`) — the same text the chat
   * mode renders, because it is the same turn.
   */
  readonly transcript = signal<string | null>(null);

  readonly recording = computed(() => this.state() === 'recording');
  readonly speaking = computed(() => this.state() === 'speaking');
  /** Stream or message turn id currently active for playback, or null when idle. */
  readonly activeTurnId = signal<string | null>(null);

  /**
   * Loudness of the microphone while recording, 0 (quiet) to 1 (loud). `null`
   * when nothing is being captured or the browser cannot measure it; whoever
   * draws a wave falls back to a generic one then.
   */
  readonly micLevel = signal<number | null>(null);

  readonly marks = signal<VexiVoiceMarks>({ server: {} });

  // --- capture -------------------------------------------------------------

  private recorder: MediaRecorder | null = null;
  private captureContext: { conversation_id: number; agent_key: 'vex' } | null =
    null;
  private micStream: MediaStream | null = null;
  private levelContext: AudioContext | null = null;
  private levelFrame: number | null = null;
  private turnId: string | null = null;
  private mimeType = '';
  private recordingStartedAt = 0;
  private releasedAt = 0;
  private uploadedBytes = 0;
  private closing = false;
  private tailParts: Blob[] = [];
  private uploads: Promise<unknown>[] = [];
  private stopped: Promise<void> | null = null;

  // --- playback ------------------------------------------------------------

  /**
   * Which stream's frames are accepted right now.
   *
   * The guard for barge-in. On mic-down the previous turn's EventSource is still
   * open and still emitting audio that was already paid for; dropping by stream
   * id is what keeps that audio from playing over the new question. A generation
   * counter alone would not do it — the old stream would still be "current" until
   * the new one exists, which is a whole transcription later.
   */
  private acceptingStreamId: string | null = null;
  private generation = 0;
  private readonly pending = new Map<number, QueuedAudio>();
  private nextIndex = 0;
  private playing = false;
  /**
   * Single persistent audio element reused across every segment of a turn.
   *
   * Constructing `new Audio(url)` per segment breaks after ~1 second on Safari,
   * iOS and strict-autoplay Chrome: the initial filler plays while transient
   * user activation is still open, then the LLM runs for several seconds,
   * activation expires, and every subsequent `new Audio().play()` rejects with
   * `NotAllowedError` — silently dropping the entire answer. Unlocking ONE
   * element inside the user's click/pointer gesture via `primeAudio()` keeps
   * playback authorised for every segment that follows.
   */
  private player: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private cleanupListeners: (() => void) | null = null;
  private holeTimer: ReturnType<typeof setTimeout> | null = null;
  private turnFinished = false;

  /**
   * Unlocks the reusable `HTMLAudioElement` synchronously inside a user
   * gesture (click / pointerup / keydown) so delayed multi-segment TTS frames
   * are never blocked by browser autoplay policy.
   */
  primeAudio(): void {
    if (this.playing || typeof Audio === 'undefined') return;
    const player = this.ensurePlayer();
    if (!player) return;

    player.muted = true;
    player.src = SILENT_WAV_DATA_URI;
    const attempt = player.play();
    if (attempt && typeof attempt.then === 'function') {
      void attempt
        .then(() => {
          if (!this.playing) {
            player.pause();
            player.muted = false;
          }
        })
        .catch(() => {
          if (!this.playing) player.muted = false;
        });
    } else if (!this.playing) {
      player.muted = false;
    }
  }

  /**
   * Synthesizes the filler bank so the first turn does not pay for it.
   *
   * Called when voice mode opens, not on the first turn: a filler that has to be
   * synthesized on demand *is* the latency it exists to hide. Failure is silent —
   * a cold bank costs one slow filler, not a broken mode.
   */
  async warm(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.baseUrl}/warm`, {}));
    } catch {
      // Intentionally ignored; see above.
    }
  }

  /**
   * Opens the mic and starts recording.
   *
   * Resolves `false` when the attempt was consumed by the permission prompt, so
   * the caller can ask for a second hold instead of leaving the person holding a
   * button that is not recording.
   */
  async startRecording(context?: {
    conversation_id: number;
    agent_key: 'vex';
  }): Promise<boolean> {
    this.safety.invalidate();
    if (this.recorder) return true;
    this.captureContext = context ?? null;

    this.errorMessage.set(null);
    // Barge-in: whatever Vexi was saying stops the moment the person starts
    // talking, and the audio still arriving for that turn is dropped.
    this.interrupt();

    try {
      const needsPrompt = !this.permissionResolved();
      if (needsPrompt) this.state.set('permission');

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Mono and processed: the transcriber wants intelligible speech, not
          // fidelity, and every byte saved is upload time on the critical path.
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.permissionResolved.set(true);

      if (needsPrompt) {
        // The dialog tore the hold apart — the pointer is long gone. Release the
        // mic and let the person start a real turn.
        this.releaseMic();
        this.state.set('idle');
        return false;
      }

      this.beginCapture();
      return true;
    } catch (error) {
      this.releaseMic();
      this.state.set('error');
      this.errorMessage.set(
        (error as Error)?.name === 'NotAllowedError'
          ? 'No tengo permiso para usar el micrófono.'
          : 'No pude abrir el micrófono.',
      );
      return false;
    }
  }

  /**
   * Closes the recording and returns what was said.
   *
   * Returns null when the turn is not worth a round trip — too short, or too few
   * bytes to contain speech. The buffered chunks on the server are simply
   * abandoned; they expire on their own TTL, so a discarded turn needs no
   * cleanup call and leaves nothing behind.
   */
  async stopRecording(): Promise<string | null> {
    if (!this.recorder) return null;

    this.releasedAt = Date.now();
    const heldMs = this.releasedAt - this.recordingStartedAt;
    const turnId = this.turnId!;
    const format = this.mimeType;

    this.closing = true;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    await this.stopped;
    this.releaseMic();

    const tail = this.tailParts.length
      ? new Blob(this.tailParts, { type: format })
      : null;
    const totalBytes = this.uploadedBytes + (tail?.size ?? 0);

    this.recorder = null;
    this.tailParts = [];

    if (heldMs < MIN_TALK_MS || totalBytes < MIN_BLOB_BYTES) {
      this.state.set('idle');
      return null;
    }

    this.state.set('transcribing');

    try {
      // The chunks uploaded during the recording have to be on the server before
      // the tail asks it to assemble them, or the transcript is missing its
      // opening words.
      await Promise.allSettled(this.uploads);
      this.uploads = [];

      const text = await this.transcribe(turnId, tail, format);
      this.mark({ releaseToTextMs: Date.now() - this.releasedAt });
      this.transcript.set(text || null);

      if (!text) {
        // A hold that caught no speech. Not an error — the person changed their
        // mind, and a failure toast for that is noise.
        this.state.set('idle');
        return null;
      }

      return text;
    } catch (error) {
      this.state.set('error');
      this.errorMessage.set(
        (error as any)?.error?.message ||
          'No pude entender el audio. Prueba de nuevo.',
      );
      return null;
    }
  }

  /** Drops the recording without transcribing it. */
  cancelRecording(): void {
    if (!this.recorder) return;

    this.closing = true;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.releaseMic();
    this.recorder = null;
    this.tailParts = [];
    this.uploads = [];
    this.state.set('idle');
  }

  // --- playback ------------------------------------------------------------

  /**
   * Declares which stream may speak. Everything queued for a previous one is
   * discarded here rather than left to arrive late over the old connection.
   */
  startTurn(streamId: string): void {
    this.resetPlayback();
    this.acceptingStreamId = streamId;
    this.activeTurnId.set(streamId);
    this.turnFinished = false;
    this.generation++;
  }

  /** Accepts a synthesized segment. Ignores anything from another turn. */
  enqueue(streamId: string, frame: VexiAudioFrame): void {
    if (streamId !== this.acceptingStreamId) return;

    const url = URL.createObjectURL(
      this.toBlob(frame.audio_base64, frame.content_type),
    );
    this.pending.set(frame.index, { url, filler: frame.filler === true });
    this.pump();
  }

  /** Records a server-side latency mark. */
  serverMark(mark: string, ms: number): void {
    this.marks.update((current) => ({
      ...current,
      server: { ...current.server, [mark]: ms },
    }));
  }

  /**
   * No more audio is coming for this turn.
   *
   * Lets playback stop waiting on an index that a failed synthesis means will
   * never arrive, instead of holding the remaining segments behind a gap.
   */
  finishTurn(streamId: string): void {
    if (streamId !== this.acceptingStreamId) return;
    this.turnFinished = true;
    this.clearHoleTimer();
    if (!this.playing && !this.pending.size) {
      this.acceptingStreamId = null;
      this.activeTurnId.set(null);
      if (this.state() === 'speaking') this.state.set('idle');
      return;
    }
    this.pump();
  }

  /**
   * T14 — the answer will not be read aloud. Says why once, with the server's
   * own sentence, and keeps it readable in `voiceNotice` for the surface.
   */
  notice(message: string): void {
    const text = message.trim();
    if (!text) return;
    this.voiceNotice.set(text);
    this.toast.show({ description: text, variant: 'info', duration: 5000 });
  }

  /** Stops playback and drops everything queued. */
  interrupt(): void {
    this.acceptingStreamId = null;
    this.activeTurnId.set(null);
    this.resetPlayback();
    if (this.state() === 'speaking') this.state.set('idle');
  }

  // --- internals -----------------------------------------------------------

  /**
   * Measures the microphone loudness for the listening wave. Reads the same
   * stream the recorder uses through an analyser that is never connected to the
   * speakers; the audio that is uploaded is untouched. Any failure only leaves
   * `micLevel` at `null`.
   */
  private startLevelMeter(): void {
    this.stopLevelMeter();
    const stream = this.micStream;
    if (!stream || typeof AudioContext === 'undefined') return;
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      this.levelContext = context;
      let last = 0;
      const tick = (now: number): void => {
        if (this.levelContext !== context) return;
        this.levelFrame = requestAnimationFrame(tick);
        // ~15 readings per second are enough for a wave and cheap to render.
        if (now - last < 66) return;
        last = now;
        analyser.getByteTimeDomainData(samples);
        this.micLevel.set(micLevelFromSamples(samples));
      };
      this.levelFrame = requestAnimationFrame(tick);
    } catch {
      this.stopLevelMeter();
    }
  }

  private stopLevelMeter(): void {
    if (this.levelFrame !== null) cancelAnimationFrame(this.levelFrame);
    this.levelFrame = null;
    const context = this.levelContext;
    this.levelContext = null;
    if (context) void context.close().catch(() => undefined);
    this.micLevel.set(null);
  }

  private beginCapture(): void {
    this.startLevelMeter();
    this.turnId = this.newTurnId();
    this.mimeType = this.pickMimeType();
    this.uploadedBytes = 0;
    this.closing = false;
    this.tailParts = [];
    this.uploads = [];
    this.recordingStartedAt = Date.now();

    const recorder = new MediaRecorder(
      this.micStream!,
      this.mimeType ? { mimeType: this.mimeType } : undefined,
    );

    this.stopped = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });

    recorder.ondataavailable = (event) => {
      if (!event.data?.size) return;
      // G Vex has an independent toggle. Keep one bounded audio upload and use
      // the authenticated conversation-bound STT adapter, not Vexi-only chunks.
      if (this.captureContext) {
        this.tailParts.push(event.data);
        return;
      }

      // Everything after `stop()` was requested belongs to the tail, which
      // travels with the transcribe call rather than as one more chunk.
      if (this.closing) {
        this.tailParts.push(event.data);
        return;
      }

      this.uploadedBytes += event.data.size;
      this.uploads.push(this.uploadChunk(this.turnId!, event.data));
    };

    recorder.start(CHUNK_INTERVAL_MS);
    this.recorder = recorder;
    this.state.set('recording');
  }

  private uploadChunk(turnId: string, blob: Blob): Promise<unknown> {
    const form = new FormData();
    form.append('turn_id', turnId);
    form.append('file', blob, `chunk.${this.extension()}`);

    return firstValueFrom(this.http.post(`${this.baseUrl}/chunk`, form)).catch(
      () => {
        // A dropped slice is a hole in the middle of the recording, which the
        // decoder cannot bridge. Not fatal here: the transcript comes back short
        // or empty and the person is asked to repeat, which beats failing a turn
        // they already finished speaking.
        return null;
      },
    );
  }

  private async transcribe(
    turnId: string,
    tail: Blob | null,
    format: string,
  ): Promise<string> {
    const form = new FormData();
    const context = this.captureContext;
    if (context) {
      form.append('conversation_id', String(context.conversation_id));
      form.append('agent_key', context.agent_key);
    } else form.append('turn_id', turnId);
    if (tail) {
      form.append('file', tail, `tail.${this.extension(format)}`);
    }

    return firstValueFrom(
      this.http
        .post<{
          data: { text: string };
        }>(context ? `${this.baseUrl}/confirmations/transcribe` : `${this.baseUrl}/transcribe`, form)
        .pipe(map((res) => (res.data?.text ?? '').trim())),
    );
  }

  /**
   * Plays in ascending index order, skipping a gap once it is clearly not coming.
   *
   * Strict order matters — the indices are the order the sentences were spoken —
   * but waiting forever for an index that a failed synthesis will never produce
   * would hold the rest of the answer hostage.
   */
  private pump(): void {
    if (this.playing || !this.pending.size) return;

    if (!this.pending.has(this.nextIndex)) {
      if (this.turnFinished) {
        this.nextIndex = Math.min(...this.pending.keys());
      } else {
        this.armHoleTimer();
        return;
      }
    }

    this.clearHoleTimer();

    const next = this.pending.get(this.nextIndex);
    if (!next) return;
    this.pending.delete(this.nextIndex);
    this.nextIndex++;

    this.play(next);
  }

  private play(item: QueuedAudio): void {
    const generation = this.generation;
    const audio = this.ensurePlayer();
    if (!audio) {
      URL.revokeObjectURL(item.url);
      return;
    }

    this.detachListeners();
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
    }

    this.playing = true;
    this.currentUrl = item.url;
    audio.muted = false;
    audio.src = item.url;
    this.state.set('speaking');

    if (this.marks().perceivedMs === undefined && this.releasedAt) {
      this.mark({ perceivedMs: Date.now() - this.releasedAt });
    }
    if (
      !item.filler &&
      this.marks().contentMs === undefined &&
      this.releasedAt
    ) {
      this.mark({ contentMs: Date.now() - this.releasedAt });
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.detachListeners();
      if (this.currentUrl === item.url) {
        this.currentUrl = null;
      }
      URL.revokeObjectURL(item.url);
      // A turn that was interrupted while this segment played must not resume
      // into the next one — that queue belongs to an answer nobody is waiting on.
      if (generation !== this.generation) return;

      this.playing = false;

      if (this.pending.size) {
        this.pump();
      } else if (this.turnFinished) {
        this.acceptingStreamId = null;
        this.activeTurnId.set(null);
        this.state.set('idle');
      }
    };

    audio.addEventListener('ended', finish);
    audio.addEventListener('error', finish);
    this.cleanupListeners = () => {
      audio.removeEventListener('ended', finish);
      audio.removeEventListener('error', finish);
    };

    const playResult = audio.play();
    if (playResult && typeof playResult.catch === 'function') {
      void playResult.catch(() => {
        // Autoplay refused, or the format is not decodable here. Skipping keeps
        // the rest of the answer audible instead of stalling the queue on it.
        finish();
      });
    }
  }

  private ensurePlayer(): HTMLAudioElement | null {
    if (this.player) return this.player;
    if (typeof Audio === 'undefined') return null;
    this.player = new Audio();
    return this.player;
  }

  private detachListeners(): void {
    if (!this.cleanupListeners) return;
    this.cleanupListeners();
    this.cleanupListeners = null;
  }

  private armHoleTimer(): void {
    if (this.holeTimer) return;
    this.holeTimer = setTimeout(() => {
      this.holeTimer = null;
      if (this.pending.size && !this.pending.has(this.nextIndex)) {
        this.nextIndex = Math.min(...this.pending.keys());
      }
      this.pump();
    }, HOLE_TOLERANCE_MS);
  }

  private clearHoleTimer(): void {
    if (!this.holeTimer) return;
    clearTimeout(this.holeTimer);
    this.holeTimer = null;
  }

  private resetPlayback(): void {
    this.generation++;
    this.clearHoleTimer();
    this.detachListeners();

    if (this.player) {
      this.player.pause();
      this.player.removeAttribute('src');
      this.player.load();
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    for (const item of this.pending.values()) URL.revokeObjectURL(item.url);
    this.pending.clear();
    this.nextIndex = 0;
    this.playing = false;
    this.marks.set({ server: {} });
  }

  private releaseMic(): void {
    this.stopLevelMeter();
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
  }

  private mark(patch: Partial<Omit<VexiVoiceMarks, 'server'>>): void {
    this.marks.update((current) => ({ ...current, ...patch }));
  }

  private pickMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    return (
      PREFERRED_MIME_TYPES.find((type) =>
        MediaRecorder.isTypeSupported(type),
      ) ?? ''
    );
  }

  /**
   * Container name for the upload filename.
   *
   * The transcription endpoint picks a decoder from the extension, so a wrong
   * one produces a provider error about bytes that were perfectly fine.
   */
  private extension(mimeType = this.mimeType): string {
    const base = mimeType.split(';')[0];
    if (base.includes('mp4')) return 'mp4';
    if (base.includes('ogg')) return 'ogg';
    if (base.includes('mpeg')) return 'mp3';
    return 'webm';
  }

  private toBlob(base64: string, contentType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: contentType || 'audio/mpeg' });
  }

  private newTurnId(): string {
    // `randomUUID` needs a secure context, which the app has, but a stale
    // hostname over plain http would otherwise throw here rather than degrade.
    return typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `t${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  }
}
