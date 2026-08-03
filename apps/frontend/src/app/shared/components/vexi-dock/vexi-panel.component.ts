import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VexiFacade } from '../../../core/store/vexi/vexi.facade';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-vexi-panel',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vexi-panel" [class.vexi-panel--left]="anchorLeft()">
      <header class="vexi-panel__header">
        <button
          type="button"
          class="vexi-panel__icon-btn"
          (click)="showSidebar.set(!showSidebar())"
          [attr.aria-expanded]="showSidebar()"
          aria-label="Conversaciones"
        >
          <app-icon name="menu" [size]="18" />
        </button>

        <span class="vexi-panel__title">Vexi</span>

        <button
          type="button"
          class="vexi-panel__icon-btn"
          (click)="newConversation()"
          aria-label="Nueva conversación"
        >
          <app-icon name="plus" [size]="18" />
        </button>

        <button
          type="button"
          class="vexi-panel__icon-btn"
          (click)="closed.emit()"
          aria-label="Cerrar"
        >
          <app-icon name="x" [size]="18" />
        </button>
      </header>

      <div class="vexi-panel__body">
        @if (showSidebar()) {
          <aside class="vexi-panel__sidebar">
            @for (conversation of conversations(); track conversation.id) {
              <button
                type="button"
                class="vexi-panel__conversation"
                [class.is-active]="conversation.id === activeConversationId()"
                (click)="selectConversation(conversation.id)"
              >
                {{ conversation.title || 'Sin título' }}
              </button>
            } @empty {
              <p class="vexi-panel__empty">Sin conversaciones</p>
            }
          </aside>
        }

        <div #scroller class="vexi-panel__messages">
          @for (message of messages(); track message.id) {
            <div class="vexi-msg" [class.vexi-msg--user]="message.role === 'user'">
              {{ message.content }}
            </div>
          }

          @if (streamingContent()) {
            <div class="vexi-msg vexi-msg--streaming">
              {{ streamingContent() }}<span class="vexi-caret"></span>
            </div>
          } @else if (isSending()) {
            <div class="vexi-msg vexi-msg--typing" aria-label="Vexi está escribiendo">
              <span></span><span></span><span></span>
            </div>
          }

          @if (error(); as errorMessage) {
            <p class="vexi-panel__error" role="alert">{{ errorMessage }}</p>
          }
        </div>
      </div>

      <form class="vexi-panel__composer" (ngSubmit)="send()">
        <input
          class="vexi-panel__input"
          name="vexiMessage"
          autocomplete="off"
          placeholder="Pregúntale a Vexi…"
          [(ngModel)]="draft"
          [disabled]="isSending()"
        />
        <button
          type="submit"
          class="vexi-panel__send"
          [disabled]="!canSend()"
          aria-label="Enviar"
        >
          <app-icon name="send" [size]="18" />
        </button>
      </form>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .vexi-panel {
        position: absolute;
        bottom: calc(100% + 12px);
        right: 0;
        display: flex;
        flex-direction: column;
        width: 360px;
        max-height: min(70vh, 560px);
        background: var(--color-surface, #fff);
        border: 1px solid rgb(0 0 0 / 0.08);
        border-radius: 16px;
        box-shadow: 0 18px 48px rgb(0 0 0 / 0.18);
        overflow: hidden;
      }

      /* When the dock is parked on the left edge the panel must open rightward
         or it renders off-screen. */
      .vexi-panel--left {
        right: auto;
        left: 0;
      }

      .vexi-panel__header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid rgb(0 0 0 / 0.07);
      }

      .vexi-panel__title {
        flex: 1;
        font-weight: 600;
        font-size: 0.95rem;
      }

      .vexi-panel__icon-btn {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        cursor: pointer;
        color: inherit;
      }

      .vexi-panel__icon-btn:hover {
        background: rgb(0 0 0 / 0.06);
      }

      .vexi-panel__body {
        display: flex;
        flex: 1;
        min-height: 0;
      }

      .vexi-panel__sidebar {
        width: 140px;
        flex-shrink: 0;
        overflow-y: auto;
        border-right: 1px solid rgb(0 0 0 / 0.07);
        padding: 6px;
      }

      .vexi-panel__conversation {
        display: block;
        width: 100%;
        padding: 7px 8px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        text-align: left;
        font-size: 0.8rem;
        cursor: pointer;
        color: inherit;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vexi-panel__conversation.is-active {
        background: rgb(var(--color-primary-500, 34 197 94) / 0.14);
      }

      .vexi-panel__empty {
        padding: 8px;
        font-size: 0.78rem;
        opacity: 0.6;
      }

      .vexi-panel__messages {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .vexi-msg {
        max-width: 85%;
        padding: 8px 11px;
        border-radius: 12px;
        background: rgb(0 0 0 / 0.05);
        font-size: 0.87rem;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .vexi-msg--user {
        align-self: flex-end;
        background: rgb(var(--color-primary-500, 34 197 94) / 0.16);
      }

      .vexi-caret {
        display: inline-block;
        width: 2px;
        height: 1em;
        margin-left: 2px;
        vertical-align: text-bottom;
        background: currentColor;
        animation: vexi-blink 1s steps(2) infinite;
      }

      @keyframes vexi-blink {
        50% {
          opacity: 0;
        }
      }

      .vexi-msg--typing {
        display: flex;
        gap: 4px;
      }

      .vexi-msg--typing span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.45;
        animation: vexi-dot 1.2s ease-in-out infinite;
      }

      .vexi-msg--typing span:nth-child(2) {
        animation-delay: 0.15s;
      }
      .vexi-msg--typing span:nth-child(3) {
        animation-delay: 0.3s;
      }

      @keyframes vexi-dot {
        0%,
        60%,
        100% {
          transform: translateY(0);
          opacity: 0.45;
        }
        30% {
          transform: translateY(-4px);
          opacity: 1;
        }
      }

      .vexi-panel__error {
        font-size: 0.8rem;
        color: rgb(var(--color-danger-500, 239 68 68));
      }

      .vexi-panel__composer {
        display: flex;
        gap: 8px;
        padding: 10px;
        border-top: 1px solid rgb(0 0 0 / 0.07);
      }

      .vexi-panel__input {
        flex: 1;
        min-width: 0;
        padding: 8px 11px;
        border: 1px solid rgb(0 0 0 / 0.12);
        border-radius: 10px;
        font-size: 0.87rem;
        background: transparent;
        color: inherit;
      }

      .vexi-panel__send {
        display: grid;
        place-items: center;
        width: 36px;
        border: 0;
        border-radius: 10px;
        background: rgb(var(--color-primary-500, 34 197 94));
        color: #fff;
        cursor: pointer;
      }

      .vexi-panel__send:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      @media (max-width: 480px) {
        .vexi-panel {
          width: calc(100vw - 24px);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .vexi-caret,
        .vexi-msg--typing span {
          animation: none;
        }
      }
    `,
  ],
})
export class VexiPanelComponent {
  private readonly facade = inject(VexiFacade);
  private readonly scroller =
    viewChild.required<ElementRef<HTMLElement>>('scroller');

  /** Flips the panel origin when the dock is parked on the left edge. */
  readonly anchorLeft = input(false);
  readonly closed = output<void>();

  protected draft = '';

  // Read the facade's signal parallels straight through. Mirroring them into
  // local signals with manual subscriptions is what the previous widget did,
  // and it is exactly the pattern `vendix-zoneless-signals` rules out.
  protected readonly conversations = this.facade.conversations;
  protected readonly messages = this.facade.messages;
  protected readonly activeConversationId = this.facade.activeConversationId;
  protected readonly streamingContent = this.facade.streamingContent;
  protected readonly isSending = this.facade.isSending;
  protected readonly error = this.facade.error;

  protected readonly showSidebar = signal(false);
  protected readonly canSend = computed(() => !this.isSending());

  constructor() {
    this.facade.loadConversations();

    // Pin to the newest content whenever the transcript grows or a stream
    // ticks. `afterRenderEffect` runs after the DOM is written, so
    // `scrollHeight` is already the post-update value — no setTimeout guess.
    afterRenderEffect(() => {
      this.messages();
      this.streamingContent();
      const el = this.scroller().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  protected send(): void {
    const content = this.draft.trim();
    if (!content || this.isSending()) return;

    const conversationId = this.activeConversationId();
    if (conversationId) {
      this.facade.sendMessage(conversationId, content);
    } else {
      this.facade.startConversation(content);
    }

    this.draft = '';
  }

  protected newConversation(): void {
    this.facade.createConversation();
    this.showSidebar.set(false);
  }

  protected selectConversation(id: number): void {
    this.facade.selectConversation(id);
    this.showSidebar.set(false);
  }
}
