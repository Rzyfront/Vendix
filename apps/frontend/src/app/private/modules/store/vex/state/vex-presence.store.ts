import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { VexiVoicePipelineService } from '../../../../../core/services/vexi-voice-pipeline.service';
import { VexChatStore } from './vex-chat.store';
import {
  VEX_TYPING_IDLE_MS,
  VexPresenceState,
  resolveVexPresence,
} from './vex-presence.state';

/**
 * The single presence state of Vex (`silent`, `listening_*`, `thinking`,
 * `speaking`), shared by the header badge, the composer chip and the thread.
 *
 * Sources: keystrokes (`noteTyping`, emitted by the composer), dictation and
 * read-aloud (`VexiVoicePipelineService`, read only) and the turn in flight
 * (`VexChatStore`). Provided by `VexPageComponent`, next to `VexChatStore`.
 */
@Injectable()
export class VexPresenceStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly chat = inject(VexChatStore);
  private readonly pipeline = inject(VexiVoicePipelineService);

  private readonly _typing = signal(false);
  private readonly _recording_seconds = signal(0);
  private typing_timer: ReturnType<typeof setTimeout> | null = null;

  /** Seconds of the current dictation (0 outside listening_voice). */
  readonly recording_seconds = this._recording_seconds.asReadonly();

  private readonly last_message = computed(() => {
    const messages = this.chat.active_conversation()?.messages ?? [];
    return messages.length ? messages[messages.length - 1] : null;
  });

  private readonly streaming_text = computed(() => {
    const message = this.last_message();
    return (
      !!message &&
      message.role === 'agent' &&
      !!message.streaming &&
      (message.content.length > 0 || (message.blocks?.length ?? 0) > 0)
    );
  });

  private readonly tool_running = computed(() => {
    const message = this.last_message();
    return (
      !!message &&
      message.role === 'agent' &&
      (message.tool_steps ?? []).some((step) => step.status === 'running')
    );
  });

  readonly state = computed<VexPresenceState>(() =>
    resolveVexPresence({
      recording: this.pipeline.recording(),
      transcribing: this.pipeline.state() === 'transcribing',
      voice_speaking: this.pipeline.speaking(),
      agent_typing: this.chat.is_agent_typing(),
      streaming_text: this.streaming_text(),
      tool_running: this.tool_running(),
      typing: this._typing(),
    }),
  );

  /** True when the answer is being read aloud (not just written). */
  readonly reading_aloud = computed(() => this.pipeline.speaking());

  /** Message highlighted in the thread while it is read aloud. */
  readonly speaking_message_id = computed<string | null>(() => {
    if (!this.pipeline.speaking()) return null;
    const messages = this.chat.active_conversation()?.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === 'agent') return messages[index].id;
    }
    return null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTyping());
    // The dictation timer lives here so every badge shows the same mm:ss.
    effect((onCleanup) => {
      if (this.state() !== 'listening_voice') {
        this._recording_seconds.set(0);
        return;
      }
      const started = Date.now();
      this._recording_seconds.set(0);
      const interval = setInterval(() => {
        this._recording_seconds.set(Math.floor((Date.now() - started) / 1000));
      }, 500);
      onCleanup(() => clearInterval(interval));
    });
  }

  /** A key was pressed in the composer: "listening" until ~1.2 s of quiet. */
  noteTyping(): void {
    this._typing.set(true);
    if (this.typing_timer) clearTimeout(this.typing_timer);
    this.typing_timer = setTimeout(() => {
      this.typing_timer = null;
      this._typing.set(false);
    }, VEX_TYPING_IDLE_MS);
  }

  /** The composer was emptied or sent: back to quiet right away. */
  clearTyping(): void {
    if (this.typing_timer) {
      clearTimeout(this.typing_timer);
      this.typing_timer = null;
    }
    this._typing.set(false);
  }

  /** Stops the read-aloud playback. */
  stopReading(): void {
    this.pipeline.interrupt();
  }
}
