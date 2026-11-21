import { VexiVoicePipelineService } from '../../../../../../core/services/vexi-voice-pipeline.service';
import { VexiRealtimeService } from '../../../../../../core/services/vexi-realtime.service';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { VexApiService } from '../../services/vex-api.service';
import { VexChatStore } from '../../state/vex-chat.store';
import { VexPresenceStore } from '../../state/vex-presence.store';
import { VEX_COPY } from '../../vex-copy';
import { VexPresenceComponent } from '../vex-presence/vex-presence.component';

const MAX_LINES = 8;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Mirror of the "+" input's `accept` attribute (drops and pastes bypass it). */
const ACCEPTED_EXTENSIONS = ['.pdf', '.csv', '.xlsx', '.xls', '.txt'];

function isAcceptedFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
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
      <div
        class="rounded-3xl bg-surface border border-border shadow-lg px-3 py-2 flex items-end gap-2"
      >
        <input
          #file_input
          type="file"
          class="hidden"
          multiple
          accept="image/*,.pdf,.csv,.xlsx,.xls,.txt"
          [attr.aria-label]="copy.attach"
          (change)="onFilesPicked($event)"
        />
        <button
          type="button"
          class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
          [attr.aria-label]="copy.attach"
          [attr.title]="copy.attach_title"
          [disabled]="store.is_agent_typing()"
          (click)="file_input.click()"
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
          <button
            type="button"
            class="min-w-11 min-h-11 px-2 py-1 rounded-2xl bg-surface text-text-primary touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            [attr.aria-label]="copy.hold_to_dictate"
            [attr.aria-pressed]="pipeline.recording()"
            (pointerdown)="voiceDown($event)"
            (pointerup)="voiceUp($event)"
            (pointercancel)="pipeline.cancelRecording()"
            (keydown.space)="voiceDown($event)"
            (keyup.space)="voiceUp($event)"
            (keydown.enter)="voiceDown($event)"
            (keyup.enter)="voiceUp($event)"
          >
            <app-icon
              [name]="pipeline.recording() ? 'square' : 'mic'"
              [size]="20"
            />
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
            <app-icon name="mic" [size]="20" />
          </button>
        }

        @if (can_send()) {
          <button
            type="button"
            class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-primary text-on-primary transition-opacity hover:opacity-90"
            [attr.aria-label]="copy.send"
            (click)="send()"
          >
            <app-icon name="send" [size]="18"></app-icon>
          </button>
        }
      </div>
      @if (voiceEnabled()) {
        <p class="text-xs text-text-secondary" role="status">
          {{ pipeline.errorMessage() || voiceHint() }}
        </p>
      }
      <p class="mt-2 text-center text-xs text-text-secondary">
        {{ copy.disclaimer }}
      </p>
    </div>
  `,
})
export class VexComposerComponent {
  protected readonly copy = VEX_COPY.composer;
  protected readonly pipeline = inject(VexiVoicePipelineService);
  private readonly realtime = inject(VexiRealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  readonly voiceEnabled = signal(false);
  readonly voiceHint = signal<string>(VEX_COPY.composer.voice_hint);
  private voiceHeld = false;

  constructor() {
    void this.realtime
      .voiceConsentEnabled()
      .then((enabled) => this.voiceEnabled.set(enabled));
    this.destroyRef.onDestroy(() => {
      this.voiceHeld = false;
      this.pipeline.cancelRecording();
      this.pipeline.interrupt();
    });
  }

  voiceDown(event: Event): void {
    event.preventDefault();
    if ((event as KeyboardEvent).repeat || !this.voiceEnabled()) return;
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
      if (!started)
        this.voiceHint.set(this.copy.mic_denied);
    });
  }

  voiceUp(event: Event): void {
    event.preventDefault();
    this.voiceHeld = false;
    const conversation = this.store.active_id();
    void this.pipeline.stopRecording().then((text) => {
      if (text && this.store.active_id() === conversation)
        this.store.sendVoiceMessage(text);
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
