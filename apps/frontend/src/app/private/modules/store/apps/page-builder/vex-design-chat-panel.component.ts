import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { AppPageDocument, clonePage } from '../templates';
import {
  DesignChatAppKind,
  VexDesignChatService,
  VexDesignStreamChunk,
} from '../services/vex-design-chat.service';

export type VexDesignProposalStatus = 'pending' | 'applied' | 'discarded';

export interface VexDesignChangeProposal {
  /** Documento validado resultante de los cambios de este mensaje. */
  document: AppPageDocument;
  /** Borrador previo al mensaje para revertir al pulsar «Descartar». */
  previousDocument: AppPageDocument;
  /** Resumen legible en español (ej. «Portada: fondo oscuro; imagen de la galería»). */
  summary: string;
  /** Último bloque tocado (`hero` o id de bloque) para resaltarlo en la vista previa. */
  touchedBlockId: string | null;
  status: VexDesignProposalStatus;
}

export interface VexDesignChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposal?: VexDesignChangeProposal;
  streaming?: boolean;
  error?: boolean;
}

export interface VexDesignApplyEvent {
  document: AppPageDocument;
  touchedBlockId: string | null;
  summary: string;
}

export interface VexDesignDiscardEvent {
  document: AppPageDocument;
  touchedBlockId: string | null;
}

const SUGGESTIONS: Record<DesignChatAppKind, readonly string[]> = {
  product_page: [
    'Pon la portada con fondo oscuro y estilo elegante',
    'Aplica el estilo Boutique editorial a la página',
    'Agrega una sección de preguntas frecuentes',
  ],
  service_page: [
    'Aplica el estilo Belleza y bienestar',
    'Cambia el título de la portada para invitar a reservar',
    'Agrega una sección de testimonios de clientes',
  ],
  booking: [
    'Aplica el estilo Hospitalidad cálida',
    'Pon la portada con estilo oscuro moderno',
    'Agrega una sección de comodidades del hotel',
  ],
};

/**
 * Apps F4 — panel lateral de chat de diseño con Vex dentro del editor de apps.
 *
 * Mantiene el mismo lenguaje visual del editor, no bloquea las demás columnas,
 * soporta foco automático al abrir, cierre con Esc, región `aria-live` para
 * lectores de pantalla, botón «Detener» durante el streaming, y acciones
 * «Aplicar» / «Descartar» por mensaje con resumen legible.
 */
@Component({
  selector: 'app-vex-design-chat-panel',
  standalone: true,
  imports: [IconComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'onEscape($event)',
  },
  template: `
    <aside
      class="flex h-full min-h-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      role="region"
      aria-label="Chat de diseño con Vex"
      data-testid="vex-design-chat-panel"
    >
      <!-- Estado accesible anunciado a lectores de pantalla -->
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="vex-design-live-status">
        {{ liveStatus() }}
      </div>

      <!-- Cabecera del panel -->
      <header class="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <span class="vx-ai-badge-soft inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
            <app-icon name="sparkles" [size]="12" />
            Vex
          </span>
          <h2 class="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            Diseño asistido
          </h2>
        </div>

        <div class="flex items-center gap-1">
          @if (hasAppliedChanges()) {
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)]"
              [disabled]="streaming()"
              (click)="resetAll()"
              title="Revertir todos los cambios al documento previo a esta conversación"
              data-testid="vex-design-reset-all"
            >
              <app-icon name="rotate-ccw" [size]="12" />
              Descartar todo
            </button>
          }
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)]"
            aria-label="Cerrar chat de diseño"
            (click)="close.emit()"
            data-testid="vex-design-close"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </div>
      </header>

      <!-- Historial / estado vacío -->
      <div
        #messagesContainer
        class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        data-testid="vex-design-messages"
      >
        @if (messages().length === 0) {
          <div class="space-y-3 py-4" data-testid="vex-design-empty">
            <div class="vx-ai-surface rounded-xl p-3">
              <p class="text-xs font-semibold text-[var(--color-text-primary)]">
                Cuéntale a Vex cómo quieres ver tu página
              </p>
              <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
                Cada cambio modifica solo tu borrador para que lo veas en la vista previa y decidas si aplicarlo o descartarlo. Nada se guarda ni se publica solo.
              </p>
            </div>

            <div class="space-y-1.5">
              <p class="text-[11px] font-medium text-[var(--color-text-secondary)]">Ideas para empezar</p>
              @for (suggestion of suggestions(); track suggestion) {
                <button
                  type="button"
                  class="block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-primary)]"
                  (click)="sendPrompt(suggestion)"
                  data-testid="vex-design-suggestion"
                >
                  {{ suggestion }}
                </button>
              }
            </div>
          </div>
        } @else {
          @for (msg of messages(); track msg.id) {
            <div
              class="flex flex-col gap-1.5"
              [class.items-end]="msg.role === 'user'"
              [class.items-start]="msg.role === 'assistant'"
              [attr.data-testid]="'vex-design-msg-' + msg.role"
            >
              <div
                class="max-w-[92%] rounded-xl px-3 py-2 text-xs leading-relaxed"
                [class]="msg.role === 'user'
                  ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary,#fff)]'
                  : msg.error
                    ? 'border border-[var(--color-error,#dc2626)] bg-[var(--color-background)] text-[var(--color-error,#dc2626)]'
                    : 'border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-primary)]'"
              >
                @if (msg.streaming && !msg.content) {
                  <span class="inline-flex items-center gap-2 text-[var(--color-text-secondary)]">
                    <span class="vx-ai-dot-pulse inline-block h-2 w-2 rounded-full" aria-hidden="true"></span>
                    {{ activeStepLabel() || 'Vex está preparando el cambio…' }}
                  </span>
                } @else {
                  <p class="whitespace-pre-wrap break-words">{{ msg.content }}</p>
                }
              </div>

              @if (msg.proposal; as proposal) {
                <div
                  class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs shadow-sm"
                  data-testid="vex-design-proposal"
                  [attr.data-status]="proposal.status"
                >
                  <div class="flex items-start justify-between gap-2">
                    <p class="font-medium text-[var(--color-text-primary)]" data-testid="vex-design-proposal-summary">
                      {{ proposal.summary }}
                    </p>
                    @if (proposal.status === 'applied') {
                      <span class="shrink-0 rounded-full bg-[var(--color-background)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success,#16a34a)]">
                        Aplicado
                      </span>
                    } @else if (proposal.status === 'discarded') {
                      <span class="shrink-0 rounded-full bg-[var(--color-background)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
                        Descartado
                      </span>
                    }
                  </div>

                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    @if (proposal.status !== 'applied') {
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-on-primary,#fff)] hover:opacity-90 disabled:opacity-50"
                        [disabled]="streaming()"
                        (click)="applyProposal(msg.id)"
                        data-testid="vex-design-apply"
                      >
                        <app-icon name="check" [size]="12" />
                        Aplicar
                      </button>
                    }
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:opacity-50"
                      [disabled]="streaming() || proposal.status === 'discarded'"
                      (click)="discardProposal(msg.id)"
                      data-testid="vex-design-discard"
                    >
                      <app-icon name="rotate-ccw" [size]="12" />
                      Descartar
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        }
      </div>

      <!-- Barra de error -->
      @if (errorMessage(); as error) {
        <div
          class="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-error,#dc2626)] bg-[var(--color-background)] px-2.5 py-2 text-xs text-[var(--color-error,#dc2626)]"
          role="alert"
          data-testid="vex-design-error"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <app-icon name="alert-circle" [size]="14" />
            <span class="truncate">{{ error }}</span>
          </span>
          @if (lastPrompt()) {
            <button
              type="button"
              class="shrink-0 font-semibold underline"
              (click)="retryLast()"
              data-testid="vex-design-retry"
            >
              Reintentar
            </button>
          }
        </div>
      }

      <!-- Barra de estado de carga + botón Detener -->
      @if (streaming()) {
        <div
          class="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-xs"
          data-testid="vex-design-loading"
        >
          <span class="flex min-w-0 items-center gap-2 text-[var(--color-text-secondary)]">
            <app-icon name="loader" [size]="13" [spin]="true" />
            <span class="truncate">{{ activeStepLabel() || 'Vex está diseñando…' }}</span>
          </span>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
            (click)="stop()"
            data-testid="vex-design-stop"
          >
            <app-icon name="square" [size]="11" />
            Detener
          </button>
        </div>
      }

      <!-- Entrada de mensaje -->
      <form
        class="border-t border-[var(--color-border)] p-2.5"
        (submit)="onSubmit($event)"
      >
        <label class="sr-only" for="vex-design-input">Describe el cambio de diseño para Vex</label>
        <div class="flex items-end gap-2">
          <textarea
            #promptInput
            id="vex-design-input"
            rows="2"
            maxlength="2000"
            placeholder="Ej: Pon la portada con la foto de la galería y fondo oscuro…"
            class="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
            [value]="promptText()"
            [disabled]="streaming()"
            (input)="promptText.set($any($event.target).value)"
            (keydown)="onTextareaKeydown($event)"
            data-testid="vex-design-input"
          ></textarea>
          <app-button
            type="submit"
            variant="ai"
            size="sm"
            [disabled]="streaming() || !promptText().trim()"
            [loading]="streaming()"
            aria-label="Enviar a Vex"
            data-testid="vex-design-send"
          >
            <app-icon name="send" [size]="14" />
          </app-button>
        </div>
      </form>
    </aside>
  `,
})
export class VexDesignChatPanelComponent {
  private readonly chatService = inject(VexDesignChatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kind = input.required<DesignChatAppKind>();
  readonly draft = input.required<AppPageDocument>();
  readonly open = input<boolean>(false);

  readonly close = output<void>();
  readonly applyDraft = output<VexDesignApplyEvent>();
  readonly discardDraft = output<VexDesignDiscardEvent>();

  private readonly promptInput = viewChild<ElementRef<HTMLTextAreaElement>>('promptInput');
  private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');

  readonly messages = signal<VexDesignChatMessage[]>([]);
  readonly promptText = signal('');
  readonly streaming = signal(false);
  readonly activeStepLabel = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly liveStatus = signal('');
  readonly lastPrompt = signal<string | null>(null);
  readonly conversationId = signal<number | null>(null);

  /** Documento previo a la primera modificación de esta conversación. */
  private readonly initialDocument = signal<AppPageDocument | null>(null);
  private activeSub: Subscription | null = null;
  private messageSeq = 0;

  readonly suggestions = computed(() => SUGGESTIONS[this.kind()] ?? SUGGESTIONS.product_page);
  readonly hasAppliedChanges = computed(() =>
    this.messages().some((m) => m.proposal?.status === 'applied'),
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelActiveStream());

    // Al abrir el panel, mueve el foco al campo de entrada sin bloquear el editor.
    effect(() => {
      if (!this.open()) return;
      queueMicrotask(() => {
        this.promptInput()?.nativeElement.focus();
      });
    });

    // Desplaza el historial al final cuando llegan mensajes nuevos.
    effect(() => {
      this.messages();
      queueMicrotask(() => {
        const container = this.messagesContainer()?.nativeElement;
        if (container) container.scrollTop = container.scrollHeight;
      });
    });
  }

  onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.close.emit();
  }

  onTextareaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendPrompt(this.promptText());
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.sendPrompt(this.promptText());
  }

  retryLast(): void {
    const prompt = this.lastPrompt();
    if (prompt) this.sendPrompt(prompt);
  }

  /** Envía un pedido a Vex reutilizando el handshake + SSE del editor. */
  sendPrompt(rawText: string): void {
    const content = rawText.trim();
    if (!content || this.streaming()) return;

    this.cancelActiveStream();
    this.errorMessage.set(null);
    this.lastPrompt.set(content);
    this.promptText.set('');
    this.streaming.set(true);
    this.activeStepLabel.set('Conectando con Vex…');
    this.liveStatus.set('Vex está preparando los cambios en el borrador.');

    const draftBeforeTurn = clonePage(this.draft());
    if (!this.initialDocument()) {
      this.initialDocument.set(clonePage(draftBeforeTurn));
    }

    const userMsgId = this.nextId('user');
    const assistantMsgId = this.nextId('assistant');

    this.messages.update((list) => [
      ...list,
      { id: userMsgId, role: 'user', content },
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
    ]);

    const summaries: string[] = [];
    let latestDoc: AppPageDocument | null = null;
    let latestTouchedBlock: string | null = null;

    this.activeSub = this.chatService
      .createStreamIntent(this.kind(), {
        content,
        draft: draftBeforeTurn,
        conversationId: this.conversationId(),
      })
      .pipe(
        switchMap((intent) => {
          this.conversationId.set(intent.conversation_id);
          this.activeStepLabel.set('Vex está analizando tu borrador…');
          return this.chatService.streamDesign(this.kind(), intent.conversation_id, intent.stream_id);
        }),
      )
      .subscribe({
        next: (chunk: VexDesignStreamChunk) => {
          if (chunk.type === 'tool_call') {
            this.activeStepLabel.set(this.labelForTool(chunk.tool?.name));
            return;
          }
          if (chunk.type === 'design_draft' && chunk.document) {
            latestDoc = chunk.document;
            if (chunk.touched_block_id) latestTouchedBlock = chunk.touched_block_id;
            if (chunk.summary) summaries.push(chunk.summary);

            const proposal: VexDesignChangeProposal = {
              document: clonePage(latestDoc),
              previousDocument: clonePage(draftBeforeTurn),
              summary: summaries.join('; '),
              touchedBlockId: latestTouchedBlock,
              status: 'pending',
            };
            this.updateMessage(assistantMsgId, (msg) => ({ ...msg, proposal }));
            this.liveStatus.set(`Cambio listo para aplicar: ${proposal.summary}`);
            return;
          }
          if (chunk.type === 'text' && chunk.content) {
            this.updateMessage(assistantMsgId, (msg) => ({
              ...msg,
              content: msg.content + chunk.content!,
            }));
            return;
          }
          if (chunk.type === 'error') {
            const errText = chunk.error || 'Vex no pudo completar el cambio.';
            this.finishWithError(assistantMsgId, errText);
            return;
          }
          if (chunk.type === 'done') {
            this.finalizeAssistantMessage(assistantMsgId, summaries);
          }
        },
        error: (err) => {
          const message =
            parseApiError(err).userMessage ||
            (err instanceof Error ? err.message : null) ||
            'No se pudo comunicar con Vex.';
          this.finishWithError(assistantMsgId, message);
        },
        complete: () => {
          if (this.streaming()) {
            this.finalizeAssistantMessage(assistantMsgId, summaries);
          }
        },
      });
  }

  /** Detiene el stream activo inmediatamente. */
  stop(): void {
    if (!this.streaming()) return;
    this.cancelActiveStream();
    this.streaming.set(false);
    this.activeStepLabel.set(null);
    this.messages.update((list) =>
      list.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              content: m.content || 'Generación detenida.',
            }
          : m,
      ),
    );
    this.liveStatus.set('Generación detenida.');
  }

  /** Aplica la propuesta de un mensaje al borrador del editor y refresca la vista previa. */
  applyProposal(messageId: string): void {
    const msg = this.messages().find((m) => m.id === messageId);
    if (!msg?.proposal) return;
    const proposal = msg.proposal;

    this.updateMessage(messageId, (current) => ({
      ...current,
      proposal: current.proposal ? { ...current.proposal, status: 'applied' } : undefined,
    }));

    this.applyDraft.emit({
      document: clonePage(proposal.document),
      touchedBlockId: proposal.touchedBlockId,
      summary: proposal.summary,
    });
    this.liveStatus.set(`Cambio aplicado en la vista previa: ${proposal.summary}`);
  }

  /** Descarta el cambio del mensaje y revierte el borrador al documento previo. */
  discardProposal(messageId: string): void {
    const msg = this.messages().find((m) => m.id === messageId);
    if (!msg?.proposal) return;
    const proposal = msg.proposal;
    const convId = this.conversationId();

    this.updateMessage(messageId, (current) => ({
      ...current,
      proposal: current.proposal ? { ...current.proposal, status: 'discarded' } : undefined,
    }));

    if (convId) {
      // Mantiene la pila del backend sincronizada sin bloquear la reversión local.
      this.chatService
        .discardLast(this.kind(), convId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          error: () => {
            // Si ya estaba descartado en servidor, prevalece la reversión local.
          },
        });
    }

    this.discardDraft.emit({
      document: clonePage(proposal.previousDocument),
      touchedBlockId: proposal.touchedBlockId,
    });
    this.liveStatus.set('Cambio descartado. Se restauró el borrador anterior.');
  }

  /** Revierte el borrador al documento previo al inicio de la conversación. */
  resetAll(): void {
    const initial = this.initialDocument();
    if (!initial) return;
    const convId = this.conversationId();

    this.messages.update((list) =>
      list.map((m) =>
        m.proposal ? { ...m, proposal: { ...m.proposal, status: 'discarded' } } : m,
      ),
    );

    if (convId) {
      this.chatService
        .resetConversation(this.kind(), convId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          error: () => {
            // La reversión local al documento inicial siempre se respeta.
          },
        });
    }

    this.discardDraft.emit({
      document: clonePage(initial),
      touchedBlockId: null,
    });
    this.liveStatus.set('Se descartaron todos los cambios de la conversación.');
  }

  private finalizeAssistantMessage(messageId: string, summaries: string[]): void {
    this.streaming.set(false);
    this.activeStepLabel.set(null);
    this.activeSub = null;
    this.updateMessage(messageId, (msg) => ({
      ...msg,
      streaming: false,
      content:
        msg.content.trim() ||
        (summaries.length > 0
          ? `Listo, preparé el cambio: ${summaries.join('; ')}.`
          : 'Listo.'),
    }));
    if (summaries.length > 0) {
      this.liveStatus.set(`Vex terminó. Puedes aplicar o descartar: ${summaries.join('; ')}.`);
    } else {
      this.liveStatus.set('Vex terminó de responder.');
    }
  }

  private finishWithError(messageId: string, message: string): void {
    this.cancelActiveStream();
    this.streaming.set(false);
    this.activeStepLabel.set(null);
    this.errorMessage.set(message);
    this.updateMessage(messageId, (msg) => ({
      ...msg,
      streaming: false,
      error: true,
      content: msg.content || message,
    }));
    this.liveStatus.set(`Error: ${message}`);
  }

  private updateMessage(
    id: string,
    updater: (msg: VexDesignChatMessage) => VexDesignChatMessage,
  ): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? updater(m) : m)));
  }

  private cancelActiveStream(): void {
    this.activeSub?.unsubscribe();
    this.activeSub = null;
  }

  private nextId(prefix: string): string {
    this.messageSeq += 1;
    return `${prefix}-${this.messageSeq}`;
  }

  private labelForTool(name?: string): string {
    switch (name) {
      case 'vex_design_read':
        return 'Leyendo el borrador actual…';
      case 'vex_design_patch':
        return 'Aplicando cambio en el borrador…';
      case 'vex_design_discard':
        return 'Deshaciendo el último cambio…';
      default:
        return 'Vex está trabajando…';
    }
  }
}
