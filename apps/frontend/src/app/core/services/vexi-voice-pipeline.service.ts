import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
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
 * arrives. Jobs start in index order, so a lower index is never *delayed* behind
 * a higher one by more than its own synthesis time — past this, it is not coming.
 */
const HOLE_TOLERANCE_MS = 1500;

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
@Injectable({ providedIn: 'root' })
export class VexiVoicePipelineService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/vexi/voice`;

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

  readonly marks = signal<VexiVoiceMarks>({ server: {} });

  // --- capture -------------------------------------------------------------

  private recorder: MediaRecorder | null = null;
  private micStream: MediaStream | null = null;
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
  private audio: HTMLAudioElement | null = null;
  private holeTimer: ReturnType<typeof setTimeout> | null = null;
  private turnFinished = false;

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
  async startRecording(): Promise<boolean> {
    if (this.recorder) return true;

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
    this.pump();
  }

  /** Stops playback and drops everything queued. */
  interrupt(): void {
    this.acceptingStreamId = null;
    this.resetPlayback();
    if (this.state() === 'speaking') this.state.set('idle');
  }

  // --- internals -----------------------------------------------------------

  private beginCapture(): void {
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

    return firstValueFrom(
      this.http.post(`${this.baseUrl}/chunk`, form),
    ).catch(() => {
      // A dropped slice is a hole in the middle of the recording, which the
      // decoder cannot bridge. Not fatal here: the transcript comes back short
      // or empty and the person is asked to repeat, which beats failing a turn
      // they already finished speaking.
      return null;
    });
  }

  private async transcribe(
    turnId: string,
    tail: Blob | null,
    format: string,
  ): Promise<string> {
    const form = new FormData();
    form.append('turn_id', turnId);
    if (tail) {
      form.append('file', tail, `tail.${this.extension(format)}`);
    }

    return firstValueFrom(
      this.http
        .post<{ data: { text: string } }>(`${this.baseUrl}/transcribe`, form)
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
    const audio = new Audio(item.url);

    this.playing = true;
    this.audio = audio;
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

    const finish = () => {
      URL.revokeObjectURL(item.url);
      // A turn that was interrupted while this segment played must not resume
      // into the next one — that queue belongs to an answer nobody is waiting on.
      if (generation !== this.generation) return;

      this.playing = false;
      this.audio = null;

      if (this.pending.size) {
        this.pump();
      } else if (this.turnFinished) {
        this.state.set('idle');
      }
    };

    audio.addEventListener('ended', finish, { once: true });
    audio.addEventListener('error', finish, { once: true });

    void audio.play().catch(() => {
      // Autoplay refused, or the format is not decodable here. Skipping keeps
      // the rest of the answer audible instead of stalling the queue on it.
      finish();
    });
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

    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    for (const item of this.pending.values()) URL.revokeObjectURL(item.url);
    this.pending.clear();
    this.nextIndex = 0;
    this.playing = false;
    this.marks.set({ server: {} });
  }

  private releaseMic(): void {
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
