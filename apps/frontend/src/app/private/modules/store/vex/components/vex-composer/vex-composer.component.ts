import {
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { VexApiService } from '../../services/vex-api.service';
import { VexChatStore } from '../../state/vex-chat.store';

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
  imports: [IconComponent],
  template: `
    <div class="w-full">
      @if (staged().length > 0) {
        <div class="flex flex-wrap gap-2 mb-2" aria-label="Archivos adjuntos">
          @for (file of staged(); track file.local_id) {
            <span
              class="inline-flex items-center gap-2 max-w-full pl-3 pr-1.5 py-1.5 rounded-xl border text-xs"
              [class.border-[var(--color-border)]]="file.status !== 'error'"
              [class.bg-[var(--color-surface)]]="file.status !== 'error'"
              [class.border-[var(--color-error)]]="file.status === 'error'"
              [class.bg-[rgba(var(--color-error-rgb),0.07)]]="file.status === 'error'"
            >
              @if (file.status === 'uploading') {
                <app-icon name="loader-2" [size]="14" [spin]="true"></app-icon>
              } @else {
                <app-icon name="file" [size]="14"></app-icon>
              }
              <span
                class="truncate max-w-40 text-[var(--color-text-primary)]"
                [title]="file.error || file.name"
              >
                {{ file.name }}
              </span>
              <button
                type="button"
                class="w-8 h-8 shrink-0 rounded-lg grid place-items-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                [attr.aria-label]="'Quitar ' + file.name"
                (click)="removeStaged(file.local_id)"
              >
                <app-icon name="x" [size]="14"></app-icon>
              </button>
            </span>
          }
        </div>
      }
      <div
        class="rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg px-3 py-2 flex items-end gap-2"
      >
        <input
          #file_input
          type="file"
          class="hidden"
          multiple
          accept="image/*,.pdf,.csv,.xlsx,.xls,.txt"
          aria-label="Adjuntar archivos"
          (change)="onFilesPicked($event)"
        />
        <button
          type="button"
          class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
          aria-label="Adjuntar archivos"
          title="Adjuntar (máx. 5 archivos de 15 MB)"
          [disabled]="store.is_agent_typing()"
          (click)="file_input.click()"
        >
          <app-icon name="plus" [size]="20"></app-icon>
        </button>

        <textarea
          #input
          rows="1"
          class="flex-1 min-w-0 resize-none bg-transparent outline-none border-0 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
          placeholder="Pregúntale a Vex"
          aria-label="Mensaje para Vex"
          [value]="text()"
          (input)="onInput($event)"
          (keydown)="onKeydown($event)"
          (paste)="onPaste($event)"
        ></textarea>

        <button
          type="button"
          disabled
          aria-disabled="true"
          class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] opacity-40 cursor-not-allowed"
          aria-label="Dictar por voz"
          title="Próximamente"
        >
          <app-icon name="mic" [size]="20"></app-icon>
        </button>

        @if (can_send()) {
          <button
            type="button"
            class="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-[var(--color-primary)] text-[var(--color-text-on-primary)] transition-opacity hover:opacity-90"
            aria-label="Enviar"
            (click)="send()"
          >
            <app-icon name="send" [size]="18"></app-icon>
          </button>
        }
      </div>
      <p class="mt-2 text-center text-xs text-[var(--color-text-secondary)]">
        Vex puede cometer errores. Verifica la información importante.
      </p>
    </div>
  `,
})
export class VexComposerComponent {
  readonly store = inject(VexChatStore);
  private readonly api = inject(VexApiService);
  private readonly toast = inject(ToastService);
  private readonly input = viewChild.required<ElementRef<HTMLTextAreaElement>>('input');

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
    this.text.set((event.target as HTMLTextAreaElement).value);
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
    const text = this.text().trim() || 'Te adjunté archivo(s). Revísalos.';
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
      this.toast.warning(`Máximo ${MAX_FILES} archivos por mensaje.`);
      return;
    }
    for (const file of files.slice(0, room)) {
      if (!isAcceptedFile(file)) {
        this.toast.warning(`${file.name || 'El archivo'} no es un tipo permitido.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        this.toast.warning(`${file.name} supera los 15 MB.`);
        continue;
      }
      void this.uploadOne(file);
    }
    if (files.length > room) {
      this.toast.warning(`Solo se adjuntaron ${room} archivo(s).`);
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
              ? { ...f, status: 'ready' as const, attachment_id: attachment.attachment_id }
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
        this.toast.error(message, 'No se pudo adjuntar');
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
