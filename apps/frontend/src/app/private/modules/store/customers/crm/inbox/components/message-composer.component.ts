import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { IconComponent, ToastService } from '../../../../../../../shared/components';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { CrmInboxService } from '../crm-inbox.service';
import { CrmConversation, CrmMessage, CrmTemplateInput } from '../crm-inbox.interface';
import { newClientRequestId } from '../crm-inbox.utils';
import { TemplatePickerModalComponent } from './template-picker-modal.component';

type ComposerMode = 'message' | 'note';

const MAX_LENGTH = 4096;

/**
 * Reply box of a conversation: free text, WhatsApp template or internal note.
 *
 * Each draft keeps one `client_request_id` until it is accepted, so a double
 * click or a retry after a network error never sends twice.
 */
@Component({
  selector: 'app-crm-message-composer',
  standalone: true,
  imports: [FormsModule, IconComponent, TemplatePickerModalComponent],
  template: `
    <div class="border-t border-[var(--color-border)] bg-surface p-3">
      <div class="mb-2 flex items-center gap-2" role="tablist" aria-label="Tipo de mensaje">
        <button
          type="button"
          role="tab"
          class="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold"
          [class]="mode() === 'message' ? 'bg-primary/10 text-primary-on-tint border border-primary/25' : 'border border-transparent text-[var(--color-text-secondary)] hover:bg-primary/5'"
          [attr.aria-selected]="mode() === 'message'"
          (click)="mode.set('message')"
        >
          <app-icon name="message-circle" [size]="12"></app-icon>
          Responder
        </button>
        <button
          type="button"
          role="tab"
          class="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold"
          [class]="mode() === 'note' ? 'bg-warning/10 text-warning border border-warning/25' : 'border border-transparent text-[var(--color-text-secondary)] hover:bg-warning/5'"
          [attr.aria-selected]="mode() === 'note'"
          (click)="mode.set('note')"
        >
          <app-icon name="sticky-note" [size]="12"></app-icon>
          Nota interna
        </button>
      </div>

      @if (mode() === 'message' && windowClosed()) {
        <div
          class="mb-2 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-2 text-xs text-[var(--color-text-primary)]"
          role="status"
        >
          <app-icon name="clock" [size]="14" class="mt-0.5 shrink-0 text-warning"></app-icon>
          <span>
            Pasaron más de 24 horas desde el último mensaje del cliente. En
            WhatsApp solo puedes enviarle una plantilla aprobada.
          </span>
        </div>
      }

      <div
        class="flex items-end gap-2 rounded-xl border p-2 focus-within:ring-2"
        [class]="mode() === 'note' ? 'border-warning/25 bg-warning/5 focus-within:ring-warning/20' : 'border-[var(--color-border)] bg-surface focus-within:ring-primary/20'"
      >
        <textarea
          class="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none disabled:cursor-not-allowed"
          rows="1"
          [attr.maxlength]="maxLength"
          [attr.aria-label]="mode() === 'note' ? 'Nota interna' : 'Mensaje'"
          [placeholder]="placeholder()"
          [disabled]="textDisabled()"
          [ngModel]="draft()"
          (ngModelChange)="onDraft($event)"
          (keydown)="onKeydown($event)"
        ></textarea>
        @if (mode() === 'message' && canUseTemplates()) {
          <button
            type="button"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:opacity-50"
            [class.bg-primary/10]="windowClosed()"
            aria-label="Enviar plantilla"
            title="Enviar plantilla"
            [disabled]="!canReply() || sending()"
            (click)="templateOpen.set(true)"
          >
            <app-icon name="file-text" [size]="16"></app-icon>
          </button>
        }
        <button
          type="button"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
          [class]="mode() === 'note' ? 'bg-warning/10 text-warning hover:bg-warning/15' : 'bg-primary text-on-primary hover:bg-primary/90'"
          [attr.aria-label]="mode() === 'note' ? 'Guardar nota' : 'Enviar mensaje'"
          [disabled]="!canSubmit()"
          (click)="submit()"
        >
          @if (sending()) {
            <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
          } @else {
            <app-icon [name]="mode() === 'note' ? 'sticky-note' : 'send'" [size]="16"></app-icon>
          }
        </button>
      </div>
      <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
        @if (!canReply()) {
          No tienes permiso para responder en esta bandeja.
        } @else if (mode() === 'note') {
          Solo la ve tu equipo; el cliente no la recibe.
        } @else {
          Ctrl + Enter para enviar.
        }
      </p>
    </div>

    <app-crm-template-picker-modal
      [(isOpen)]="templateOpen"
      [sending]="sending()"
      (picked)="sendTemplate($event)"
    ></app-crm-template-picker-modal>
  `,
})
export class MessageComposerComponent {
  private readonly inbox = inject(CrmInboxService);
  private readonly toast = inject(ToastService);
  private readonly templatePicker = viewChild(TemplatePickerModalComponent);

  readonly conversation = input.required<CrmConversation>();
  readonly canReply = input(false);
  /** A message or note was accepted by the API. */
  readonly sent = output<CrmMessage>();

  protected readonly maxLength = MAX_LENGTH;
  protected readonly mode = signal<ComposerMode>('message');
  protected readonly draft = signal('');
  protected readonly sending = signal(false);
  protected readonly templateOpen = signal(false);
  private requestId = newClientRequestId();
  /** Separate from the text draft: a template is a different send. */
  private templateRequestId = newClientRequestId();

  /** Only the id: a refreshed copy of the same conversation keeps the draft. */
  private readonly conversationId = computed(() => this.conversation().id);

  protected readonly windowClosed = computed(() => {
    const conversation = this.conversation();
    return conversation.channel === 'whatsapp' && !conversation.window_open;
  });

  protected readonly canUseTemplates = computed(
    () => this.conversation().channel === 'whatsapp',
  );

  protected readonly textDisabled = computed(
    () =>
      !this.canReply() ||
      this.sending() ||
      (this.mode() === 'message' && this.windowClosed()),
  );

  protected readonly canSubmit = computed(
    () => !this.textDisabled() && this.draft().trim().length > 0,
  );

  protected readonly placeholder = computed(() => {
    if (this.mode() === 'note') return 'Escribe una nota para tu equipo…';
    if (this.windowClosed()) return 'Usa una plantilla para escribirle';
    return 'Escribe un mensaje…';
  });

  constructor() {
    // A different conversation starts a fresh draft.
    effect(() => {
      void this.conversationId();
      untracked(() => {
        this.resetDraft();
        this.templateRequestId = newClientRequestId();
      });
    });
  }

  protected onDraft(value: string): void {
    this.draft.set(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.submit();
    }
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    const body = this.draft().trim();
    const id = this.conversation().id;
    this.sending.set(true);
    try {
      const message =
        this.mode() === 'note'
          ? await firstValueFrom(this.inbox.addNote(id, body))
          : await firstValueFrom(
              this.inbox.send(id, { body, client_request_id: this.requestId }),
            );
      this.resetDraft();
      this.sent.emit(message);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.sending.set(false);
    }
  }

  protected async sendTemplate(template: CrmTemplateInput): Promise<void> {
    if (this.sending()) return;
    const id = this.conversation().id;
    this.sending.set(true);
    try {
      const message = await firstValueFrom(
        this.inbox.send(id, {
          template,
          client_request_id: this.templateRequestId,
        }),
      );
      this.templateRequestId = newClientRequestId();
      this.templatePicker()?.reset();
      this.templateOpen.set(false);
      this.sent.emit(message);
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.sending.set(false);
    }
  }

  private resetDraft(): void {
    this.draft.set('');
    this.requestId = newClientRequestId();
  }
}
