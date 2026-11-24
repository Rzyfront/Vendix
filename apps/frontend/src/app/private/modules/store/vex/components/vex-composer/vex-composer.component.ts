import { VexiVoicePipelineService } from '../../../../../../core/services/vexi-voice-pipeline.service';
import { VexiRealtimeService } from '../../../../../../core/services/vexi-realtime.service';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import {
  AI_ATTACHMENT_MAX_BYTES,
  AI_ATTACHMENT_MAX_FILES,
  acceptAttribute,
  resolveAttachmentType,
} from '../../../../../../shared/constants/ai-attachments';
import { VexApiService } from '../../services/vex-api.service';
import { VexChatStore } from '../../state/vex-chat.store';
import { VexPresenceStore } from '../../state/vex-presence.store';
import { VEX_COPY } from '../../vex-copy';
import { VexPresenceComponent } from '../vex-presence/vex-presence.component';

const MAX_LINES = 8;
/** How long the floating notice above the box stays up. */
const NOTICE_MS = 4500;
/** A press shorter than this is a tap, not «hold to dictate». */
const SHORT_TAP_MS = 400;
const MAX_FILES = AI_ATTACHMENT_MAX_FILES;
const MAX_FILE_BYTES = AI_ATTACHMENT_MAX_BYTES;
/** Same accept list as the server; drops and pastes bypass the input's `accept`. */
const ACCEPT_ATTRIBUTE = acceptAttribute();

function isAcceptedFile(file: File): boolean {
  return resolveAttachmentType(file.type, file.name) !== null;
}

interface StagedFile {
  local_id: string;
  name: string;
  size_bytes: number;
  status: 'uploading' | 'ready' | 'error';
  attachment_id?: string;
  error?: string;
}

@Component({
  selector: 'vendix-vex-composer',
  standalone: true,
  imports: [ButtonComponent, IconComponent, VexPresenceComponent],
  template: `
    <div class="w-full">
      <div class="mb-2 px-2 min-h-8 flex items-center">
        <vendix-vex-presence variant="chip" [live]="true" />
      </div>
      @if (staged().length > 0) {
        <div class="flex flex-wrap gap-2 mb-2" [attr.aria-label]="copy.attachments_label">
          @for (file of staged(); track file.local_id) {
            <span
              class="inline-flex items-center gap-2 max-w-full pl-3 pr-1.5 py-1.5 rounded-xl border text-xs"
              [class.border-border]="file.status !== 'error'"
              [class.bg-surface]="file.status !== 'error'"
              [class.border-error]="file.status === 'error'"
              [class.bg-error/10]="
                file.status === 'error'
              "
            >
              @if (file.status === 'uploading') {
                <app-icon name="loader-2" [size]="14" [spin]="true"></app-icon>
              } @else {
                <app-icon name="file" [size]="14"></app-icon>
              }
              <span
                class="truncate max-w-40 text-text-primary"
                [attr.title]="file.error || file.name"
              >
                {{ file.name }}
              </span>
              <app-button
                class="shrink-0"
                variant="ghost"
                size="sm"
                customClasses="!w-8 !h-8 !px-0 !rounded-lg text-text-secondary"
                [ariaLabel]="copy.remove_aria(file.name)"
                (clicked)="removeStaged(file.local_id)"
              >
                <app-icon slot="icon" name="x" [size]="14"></app-icon>
              </app-button>
            </span>
          }
        </div>
      }
      @let pct = store.context_percent();
      @if (pct !== null) {
        <div class="mb-2 px-2 flex items-center gap-2 text-xs">
          <span
            role="meter"
            class="inline-flex items-center gap-1.5"
            [class]="store.context_warning() ? 'text-warning' : 'text-text-secondary'"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="pct"
            [attr.aria-label]="copy.context_label(pct)"
            [attr.title]="contextTitle()"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                transform="rotate(-90 10 10)"
                [attr.stroke-dasharray]="ringDash(pct)"
              />
            </svg>
            {{ copy.context_label(pct) }}
          </span>
          @if (store.context_warning()) {
            <span class="text-warning" role="status">{{ copy.context_warning }}</span>
          }
        </div>
      }
      <!-- Voice mode needs no extra banner: the waves button is filled and the
           box gets the primary ring; «Vex hablando» + «Detener» live in the
           presence chip above. Nothing below the box appears or hides, so the
           buttons never move under the finger. -->
      <div class="relative">
      @if (notice(); as message) {
        <div
          class="absolute bottom-full left-2 right-2 mb-2 z-20 flex items-start gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg px-3 py-2 text-xs text-[var(--color-text-primary)]"
          role="status"
          aria-live="polite"
          data-testid="vex-composer-notice"
        >
          <app-icon name="info" [size]="14" class="shrink-0 mt-px text-[var(--color-text-secondary)]" />
          <span class="flex-1 min-w-0">{{ message }}</span>
          <button
            type="button"
            class="shrink-0 -m-1 p-1 rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            [attr.aria-label]="copy.notice_close"
            (click)="dismissNotice()"
          >
            <app-icon name="x" [size]="14" />
          </button>
        </div>
      }
      <div
        [class]="
          store.voice_mode()
            ? 'rounded-3xl bg-[var(--color-surface)] border border-[var(--color-primary)] ring-2 ring-[rgba(var(--color-primary-rgb),0.22)] shadow-lg px-3 py-2 flex items-end gap-1.5 sm:gap-2 transition-all'
            : 'rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg px-3 py-2 flex items-end gap-1.5 sm:gap-2 transition-all'
        "
      >
        <input
          #file_input
          type="file"
          class="hidden"
          multiple
          [attr.accept]="accept"
          [attr.aria-label]="copy.attach"
          (change)="onFilesPicked($event)"
        />
        <button
          type="button"
          [attr.aria-label]="copy.attach"
          [attr.title]="copy.attach_title"
          [disabled]="store.is_agent_typing()"
          (click)="file_input.click()"
          class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]"
        >
          <app-icon name="plus" [size]="20"></app-icon>
        </button>

        <textarea
          #input
          rows="1"
          class="flex-1 min-w-0 resize-none bg-transparent outline-none border-0 py-2 text-text-primary placeholder:text-text-secondary"
          [attr.placeholder]="copy.placeholder"
          [attr.aria-label]="copy.message_label"
          [value]="text()"
          (input)="onInput($event)"
          (keydown)="onKeydown($event)"
          (paste)="onPaste($event)"
        ></textarea>

        @if (voiceEnabled()) {
          <!-- Micrófono = solo entrada: transcribe lo que dice la persona; la
               respuesta sigue en texto salvo que el modo voz (ondas) esté activo. -->
          <button
            type="button"
            [class]="
              pipeline.recording()
                ? 'touch-none select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 bg-[var(--color-error)] text-white animate-pulse'
                : 'touch-none select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            "
            (contextmenu)="$event.preventDefault()"
            (selectstart)="$event.preventDefault()"
            [disabled]="
              store.is_agent_typing() || pipeline.state() === 'transcribing'
            "
            [attr.aria-label]="copy.hold_to_dictate"
            title="Mantén presionado para dictar (solo entrada)"
            [attr.aria-pressed]="pipeline.recording()"
            (pointerdown)="voiceDown($event)"
            (pointerup)="voiceUp($event)"
            (pointercancel)="voiceCancel()"
            (keydown.space)="voiceDown($event)"
            (keyup.space)="voiceUp($event)"
            (keydown.enter)="voiceDown($event)"
            (keyup.enter)="voiceUp($event)"
          >
            @if (pipeline.state() === 'transcribing') {
              <app-icon name="loader-2" [size]="18" [spin]="true" />
            } @else {
              <app-icon
                [name]="pipeline.recording() ? 'square' : 'mic'"
                [size]="19"
              />
            }
          </button>
        } @else {
          <button
            type="button"
            disabled
            aria-disabled="true"
            class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-text-secondary opacity-40 cursor-not-allowed"
            [attr.aria-label]="copy.dictate_aria"
            [attr.title]="copy.soon"
          >
            <app-icon name="mic" [size]="19" />
          </button>
        }

        <!-- Icono de ondas = modo voz: mientras esté activo, cada respuesta de
             Vex se sintetiza automáticamente y se reproduce completa. -->
        <button
          type="button"
          [class]="
            store.voice_mode()
              ? 'touch-none select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all bg-[var(--color-primary)] text-[var(--color-text-on-primary)] shadow-sm'
              : 'touch-none select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[rgba(var(--color-primary-rgb),0.08)]'
          "
          (contextmenu)="$event.preventDefault()"
          [attr.aria-pressed]="store.voice_mode()"
          [attr.aria-label]="
            store.voice_mode()
              ? 'Desactivar modo voz'
              : 'Activar modo voz (respuestas automáticas con audio)'
          "
          [title]="
            store.voice_mode()
              ? 'Modo voz activo (clic para desactivar)'
              : 'Modo voz: escuchar respuestas automáticamente'
          "
          (click)="toggleVoiceMode()"
        >
          <app-icon name="audio-lines" [size]="19" />
        </button>

        @if (store.is_agent_typing()) {
          <!-- The ONLY «Detener» for a running answer (the thread no longer
               repeats it): it takes the send button's place. -->
          <button
            type="button"
            class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-text-primary text-background transition-opacity hover:opacity-90 select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]"
            [attr.aria-label]="copy.stop_aria"
            [attr.title]="copy.stop"
            data-testid="vex-composer-stop"
            (click)="store.stopStream()"
          >
            <app-icon name="square" [size]="14"></app-icon>
          </button>
        } @else if (can_send()) {
          <button
            type="button"
            class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-primary text-on-primary transition-opacity hover:opacity-90 select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]"
            [attr.aria-label]="copy.send"
            (click)="send()"
          >
            <app-icon name="send" [size]="18"></app-icon>
          </button>
        }
      </div>
      </div>
      <p class="mt-2 text-center text-xs text-text-secondary">
        {{ copy.disclaimer }}
      </p>
    </div>
  `,
})
export class VexComposerComponent {
  protected readonly copy = VEX_COPY.composer;
  protected readonly accept = ACCEPT_ATTRIBUTE;
  protected readonly pipeline = inject(VexiVoicePipelineService);
  private readonly realtime = inject(VexiRealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  readonly voiceEnabled = signal(false);
  private voiceHeld = false;
  private voiceDownAt = 0;
  /**
   * Floating notice above the box (mic denied, dictation errors, «hold to
   * dictate»). It overlays instead of taking a row under the input, so it
   * never shifts the buttons; it hides by itself after a few seconds.
   * Recording and transcribing are already shown by the presence chip.
   */
  readonly notice = signal<string | null>(null);
  private notice_timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.realtime
      .voiceConsentEnabled()
      .then((enabled) => this.voiceEnabled.set(enabled));
    effect(() => {
      const err = this.pipeline.errorMessage();
      if (err) untracked(() => this.showNotice(err));
    });
    this.destroyRef.onDestroy(() => {
      this.voiceHeld = false;
      this.pipeline.cancelRecording();
      if (this.notice_timer) clearTimeout(this.notice_timer);
    });
  }

  showNotice(message: string): void {
    if (this.notice_timer) clearTimeout(this.notice_timer);
    this.notice.set(message);
    this.notice_timer = setTimeout(() => this.dismissNotice(), NOTICE_MS);
  }

  dismissNotice(): void {
    if (this.notice_timer) clearTimeout(this.notice_timer);
    this.notice_timer = null;
    this.notice.set(null);
  }

  /** Tooltip with the estimated tokens; empty until the first answer. */
  readonly contextTitle = computed(() => {
    const budget = this.store.active_context_budget();
    return budget
      ? this.copy.context_title(
          budget.estimated_input_tokens,
          budget.context_window_tokens,
        )
      : null;
  });

  /** `stroke-dasharray` of the ring (circumference = 2π·8). */
  ringDash(percent: number): string {
    const circumference = 2 * Math.PI * 8;
    return `${(circumference * percent) / 100} ${circumference}`;
  }

  toggleVoiceMode(): void {
    this.dismissNotice();
    this.store.toggleVoiceMode();
  }

  voiceDown(event: Event): void {
    event.preventDefault();
    if (
      (event as KeyboardEvent).repeat ||
      !this.voiceEnabled() ||
      this.store.is_agent_typing() ||
      this.pipeline.state() === 'transcribing'
    )
      return;
    this.dismissNotice();
    this.voiceDownAt = Date.now();
    if (this.store.voice_mode()) this.pipeline.primeAudio();
    this.voiceHeld = true;
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== undefined)
      (event.currentTarget as HTMLElement).setPointerCapture?.(
        pointer.pointerId,
      );
    void this.store.ensureVoiceConversation().then(async (conversation_id) => {
      if (
        !conversation_id ||
        !this.voiceHeld ||
        this.store.activeNumericId() !== conversation_id
      )
        return;
      const started = await this.pipeline.startRecording({
        conversation_id,
        agent_key: 'vex',
      });
      if (!this.voiceHeld && started) this.pipeline.cancelRecording();
      if (!started) this.showNotice(this.copy.mic_denied);
    });
  }

  /**
   * The browser took the gesture away (system swipe, incoming call). Release
   * the hold too: otherwise a recording still being prepared would start with
   * no finger on the button and the next tap would send it.
   */
  voiceCancel(): void {
    this.voiceHeld = false;
    this.pipeline.cancelRecording();
  }

  voiceUp(event: Event): void {
    event.preventDefault();
    if (!this.voiceHeld) return;
    this.voiceHeld = false;
    // A quick tap does not record: explain the gesture once, as a popup.
    if (
      !this.pipeline.recording() &&
      Date.now() - this.voiceDownAt < SHORT_TAP_MS
    )
      this.showNotice(this.copy.voice_hint);
    if (this.store.voice_mode()) this.pipeline.primeAudio();
    const conversation = this.store.active_id();
    void this.pipeline.stopRecording().then((text) => {
      if (text && this.store.active_id() === conversation)
        // Micrófono = solo entrada: envía por el flujo normal del store, que
        // responde en texto salvo cuando el modo voz (ondas) está activo.
        this.store.sendMessage(text);
    });
  }

  readonly store = inject(VexChatStore);
  private readonly presence = inject(VexPresenceStore);
  private readonly api = inject(VexApiService);
  private readonly toast = inject(ToastService);
  private readonly input =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('input');

  readonly text = signal('');
  readonly staged = signal<StagedFile[]>([]);

  private readonly uploading = computed(() =>
    this.staged().some((f) => f.status === 'uploading'),
  );
  private readonly ready_ids = computed(() =>
    this.staged()
      .filter((f) => f.status === 'ready' && f.attachment_id)
      .map((f) => f.attachment_id as string),
  );

  readonly can_send = computed(
    () =>
      (this.text().trim().length > 0 || this.ready_ids().length > 0) &&
      !this.store.is_agent_typing() &&
      !this.uploading(),
  );

  onInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.text.set(value);
    if (value.length > 0) this.presence.noteTyping();
    else this.presence.clearTyping();
    this.resize();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    this.send();
  }

  send(): void {
    if (!this.can_send()) return;
    const ids = this.ready_ids();
    const text = this.text().trim() || this.copy.attached_default;
    this.presence.clearTyping();
    this.store.sendMessage(text, ids);
    this.text.set('');
    this.staged.set([]);
    this.input().nativeElement.value = '';
    this.resize();
  }

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.addFiles(files);
  }

  /** Whether attaching is currently allowed (same gate as the "+" button). */
  readonly can_attach = computed(() => !this.store.is_agent_typing());

  onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return; // plain text paste: leave it alone
    event.preventDefault();
    this.addFiles(files);
  }

  /**
   * Single entry for the "+" picker, drag-and-drop and paste: same limits,
   * same upload, same staged preview. Invalid files toast, the rest attach.
   */
  addFiles(files: File[]): void {
    if (!files.length || !this.can_attach()) return;

    const room = MAX_FILES - this.staged().length;
    if (room <= 0) {
      this.toast.warning(this.copy.max_files(MAX_FILES));
      return;
    }
    for (const file of files.slice(0, room)) {
      if (!isAcceptedFile(file)) {
        this.toast.warning(
          this.copy.not_allowed(file.name || this.copy.file_fallback),
        );
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        this.toast.warning(this.copy.too_big(file.name));
        continue;
      }
      void this.uploadOne(file);
    }
    if (files.length > room) {
      this.toast.warning(this.copy.only_attached(room));
    }
  }

  removeStaged(local_id: string): void {
    this.staged.update((list) => list.filter((f) => f.local_id !== local_id));
  }

  private uploadOne(file: File): Promise<void> {
    const local_id = crypto.randomUUID();
    this.staged.update((list) => [
      ...list,
      {
        local_id,
        name: file.name,
        size_bytes: file.size,
        status: 'uploading' as const,
      },
    ]);
    const conversation_id = this.store.active_id();
    const numeric = conversation_id ? Number(conversation_id) : NaN;
    return firstValueFrom(
      this.api.uploadAttachment(
        file,
        Number.isFinite(numeric) ? numeric : undefined,
      ),
    )
      .then((attachment) => {
        this.staged.update((list) =>
          list.map((f) =>
            f.local_id === local_id
              ? {
                  ...f,
                  status: 'ready' as const,
                  attachment_id: attachment.attachment_id,
                }
              : f,
          ),
        );
      })
      .catch((error) => {
        const message = extractApiErrorMessage(error);
        this.staged.update((list) =>
          list.map((f) =>
            f.local_id === local_id
              ? { ...f, status: 'error' as const, error: message }
              : f,
          ),
        );
        this.toast.error(message, this.copy.attach_failed);
      });
  }

  private resize(): void {
    const el = this.input().nativeElement;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }
}
