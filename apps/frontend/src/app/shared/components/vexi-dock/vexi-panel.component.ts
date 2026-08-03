import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { VexiFacade } from '../../../core/store/vexi/vexi.facade';
import { markdownToHtml } from '../../utils/markdown.util';
import { IconComponent } from '../icon/icon.component';
import { VexiAvatarComponent } from './vexi-avatar.component';
import { VexiConfirmationCardComponent } from './vexi-confirmation-card.component';
import { VexiToolTraceComponent } from './vexi-tool-trace.component';

/** One rendered transcript entry. `html` is only produced for Vexi's turns. */
interface RenderedMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  html: string;
}

/**
 * Cold-start prompts. Read-only questions plus one navigation, so a first-time
 * owner sees what Vexi is for without having to invent a phrasing.
 */
/**
 * What Vexi says while it waits on a tool. Present continuous throughout: the
 * phrase has to read as something still happening, or a rotation makes it look
 * like each step already finished.
 */
const WORKING_PHRASES: readonly string[] = [
  'Buscando en tus datos…',
  'Revisando los registros…',
  'Cruzando la información…',
  'Consultando el detalle…',
  'Verificando lo que encontré…',
];

/** Tools came back; now it is making sense of what they returned. */
const REASONING_PHRASES: readonly string[] = [
  'Leyendo lo que encontré…',
  'Ordenando los resultados…',
  'Sacando conclusiones…',
  'Armando la respuesta…',
];

/** No tools involved — just composing an answer. */
const THINKING_PHRASES: readonly string[] = [
  'Pensándolo…',
  'Dame un segundo…',
  'Preparando la respuesta…',
];

/** How long each phrase stays up. Long enough to read, short enough to move. */
const PHRASE_ROTATE_MS = 2200;

const SUGGESTIONS: readonly string[] = [
  '¿Qué productos tengo bajo stock?',
  '¿Cómo van las ventas de hoy?',
  'Llévame al Punto de Venta',
];

@Component({
  selector: 'app-vexi-panel',
  standalone: true,
  imports: [
    IconComponent,
    VexiAvatarComponent,
    VexiConfirmationCardComponent,
    VexiToolTraceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="vexi-panel" [class.vexi-panel--left]="anchorLeft()">
      <header class="vexi-panel__header">
        <button
          type="button"
          class="vexi-panel__icon-btn"
          (click)="sidebarOpen.set(!sidebarOpen())"
          [attr.aria-expanded]="sidebarOpen()"
          [attr.aria-label]="
            sidebarOpen() ? 'Ocultar conversaciones' : 'Ver conversaciones'
          "
        >
          <app-icon
            [name]="sidebarOpen() ? 'panel-left-close' : 'panel-left-open'"
            [size]="18"
          />
        </button>

        <span class="vexi-panel__heading">
          <span class="vexi-panel__title">Vexi</span>
          <span class="vexi-panel__subtitle">{{ statusLine() }}</span>
        </span>

        <button
          type="button"
          class="vexi-panel__icon-btn"
          (click)="newConversation()"
          aria-label="Nueva conversación"
        >
          <app-icon name="square-pen" [size]="18" />
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
        <!-- Kept in the DOM and collapsed by width instead of destroyed: an
             @if would drop and rebuild the list on every toggle, which cannot
             be animated and loses the scroll position of a long history. -->
        <aside
          class="vexi-panel__sidebar"
          [class.is-collapsed]="!sidebarOpen()"
          [attr.inert]="sidebarOpen() ? null : ''"
          [attr.aria-hidden]="!sidebarOpen()"
        >
          <div class="vexi-panel__sidebar-inner">
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
              <p class="vexi-panel__no-history">Sin conversaciones</p>
            }
          </div>
        </aside>

        <div #scroller class="vexi-panel__messages">
          @if (showEmptyState()) {
            <div class="vexi-empty">
              <span class="vexi-empty__portrait" aria-hidden="true">
                <app-vexi-avatar [expression]="'idle'" />
              </span>
              <p class="vexi-empty__title">Hola, soy Vexi</p>
              <p class="vexi-empty__text">
                Pregúntame por tu inventario, tus ventas o tu contabilidad. Si
                quieres, también te llevo al módulo que necesites.
              </p>
              <div class="vexi-empty__chips">
                @for (suggestion of suggestions; track suggestion) {
                  <button
                    type="button"
                    class="vexi-empty__chip"
                    (click)="useSuggestion(suggestion)"
                  >
                    {{ suggestion }}
                  </button>
                }
              </div>
            </div>
          }

          @for (message of renderedMessages(); track message.id) {
            @if (message.role === 'user') {
              <div class="vexi-msg vexi-msg--user">{{ message.text }}</div>
            } @else {
              <div class="vexi-turn">
                <span class="vexi-turn__avatar" aria-hidden="true">
                  <app-vexi-avatar [expression]="'idle'" />
                </span>
                <div
                  class="vexi-msg vexi-msg--assistant vexi-md"
                  [innerHTML]="message.html"
                ></div>
              </div>
            }
          }

          <!-- Guarded here as well as inside the component: an empty block
               element is still a flex item and would leave a phantom gap in
               the transcript on every turn that used no tools. -->
          @if (toolSteps().length) {
            <app-vexi-tool-trace [steps]="toolSteps()" />
          }

          @if (pendingProposal(); as proposal) {
            <app-vexi-confirmation-card
              [proposal]="proposal"
              (approve)="confirmProposal()"
              (reject)="rejectProposal()"
            />
          }

          @if (streamingHtml()) {
            <div class="vexi-turn">
              <span class="vexi-turn__avatar" aria-hidden="true">
                <app-vexi-avatar [expression]="'excited'" />
              </span>
              <div class="vexi-msg vexi-msg--assistant vexi-md">
                <span [innerHTML]="streamingHtml()"></span>
                <span class="vexi-caret"></span>
              </div>
            </div>
          } @else if (isSending()) {
            <div class="vexi-turn">
              <span class="vexi-turn__avatar" aria-hidden="true">
                <app-vexi-avatar [expression]="'thinking'" />
              </span>
              <div class="vexi-msg vexi-msg--assistant vexi-msg--working">
                <span
                  class="vexi-msg--typing"
                  aria-hidden="true"
                  ><span></span><span></span><span></span
                ></span>
                <!-- The phrase is what makes a fifteen-second turn tolerable:
                     three dots say "still alive", they do not say "I am doing
                     something for you". It rotates so the wait reads as work
                     in progress rather than as a stall. -->
                <span class="vexi-msg__phrase" role="status">{{
                  progressPhrase()
                }}</span>
              </div>
            </div>
          }

          <!-- Never the raw failure. A person who asked for their sales does
               not need an error code, they need to know Vexi came back
               empty-handed and what to try next. -->
          @if (error()) {
            <p class="vexi-panel__notice" role="status">{{ noticeText() }}</p>
          }
        </div>
      </div>

      <form class="vexi-panel__composer" (submit)="send($event)">
        <!-- Never disabled while sending. A disabled input cannot hold focus,
             so the browser blurs it the instant the flag flips and nothing
             hands the caret back when it re-enables — the cursor simply left
             the conversation on every message. Staying enabled also lets the
             next question be typed while Vexi is still answering; the send()
             method is what refuses to fire a second turn. -->
        <input
          #composer
          class="vexi-panel__input"
          name="vexiMessage"
          autocomplete="off"
          placeholder="Pregúntale a Vexi…"
          aria-label="Mensaje para Vexi"
          [value]="draft()"
          (input)="onDraftInput($event)"
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

      /* Grows with the conversation between a 450px floor and a 600px ceiling,
         rather than sitting at one fixed height. The floor is what an empty
         state needs to look deliberate; past the ceiling the message list takes
         over and scrolls. The tradeoff accepted here is that the box does
         reflow as Vexi streams — the min() against the viewport is what keeps a
         laptop from having the panel run under its own header.
         NOTE: no backticks anywhere in this stylesheet — it lives inside a
         template literal, so one backtick closes the string and Angular fails
         with "Code 1010: Failed to resolve styles ... to a string". */
      .vexi-panel {
        position: absolute;
        bottom: calc(100% + 12px);
        right: 0;
        display: flex;
        flex-direction: column;
        width: 360px;
        min-height: 450px;
        max-height: min(600px, calc(100vh - 120px));
        background: var(--color-surface, #fff);
        border: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
        border-radius: 16px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
        overflow: hidden;
        color: var(--color-text-primary, inherit);
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
        padding: 9px 10px;
        border-bottom: 1px solid
          rgba(var(--color-primary-rgb, 46, 204, 113), 0.18);
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb, 46, 204, 113), 0.18) 0%,
          rgba(var(--color-primary-rgb, 46, 204, 113), 0.04) 100%
        );
      }

      .vexi-panel__heading {
        display: flex;
        flex: 1;
        min-width: 0;
        flex-direction: column;
        line-height: 1.15;
      }

      .vexi-panel__title {
        font-weight: 600;
        font-size: 0.95rem;
      }

      .vexi-panel__subtitle {
        font-size: 0.68rem;
        color: var(--color-text-secondary, inherit);
        opacity: 0.75;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vexi-panel__icon-btn {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        border: 0;
        border-radius: 9px;
        background: transparent;
        cursor: pointer;
        color: inherit;
      }

      .vexi-panel__icon-btn:hover {
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.14);
      }

      .vexi-panel__icon-btn:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.8);
        outline-offset: -2px;
      }

      .vexi-panel__body {
        display: flex;
        /* Basis auto, not the 0 that a plain "flex: 1" implies: the panel's
           height is now content-driven, and a zero basis makes the content
           contribute nothing to it — the box would stay pinned at its 450px
           floor and never grow. */
        flex: 1 1 auto;
        min-height: 0;
      }

      .vexi-panel__sidebar {
        width: 148px;
        flex-shrink: 0;
        overflow: hidden;
        /* Anchors the absolutely-positioned inner list below. The list must NOT
           decide the panel's height: with dozens of saved conversations its
           intrinsic height pinned the panel at its 600px ceiling even for a
           one-message chat, so the panel never appeared to grow with the
           conversation. Taking the list out of flow leaves the message column
           as the only thing the height follows. */
        position: relative;
        border-right: 1px solid var(--color-border, rgba(0, 0, 0, 0.07));
        background: var(--color-surface-secondary, rgba(0, 0, 0, 0.02));
        transition:
          width 200ms ease,
          opacity 160ms ease;
      }

      .vexi-panel__sidebar.is-collapsed {
        width: 0;
        opacity: 0;
        border-right-width: 0;
      }

      .vexi-panel__sidebar-inner {
        position: absolute;
        inset: 0;
        width: 148px;
        overflow-y: auto;
        padding: 6px;
      }

      .vexi-panel__conversation {
        display: block;
        width: 100%;
        padding: 8px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        text-align: left;
        font-family: inherit;
        font-size: 0.78rem;
        cursor: pointer;
        color: inherit;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vexi-panel__conversation:hover {
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.1);
      }

      .vexi-panel__conversation.is-active {
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.18);
        font-weight: 600;
      }

      .vexi-panel__no-history {
        padding: 8px;
        margin: 0;
        font-size: 0.75rem;
        color: var(--color-text-muted, inherit);
        opacity: 0.7;
      }

      .vexi-panel__messages {
        /* Same reason as .vexi-panel__body: the list's own content is what
           makes the panel grow, so its basis must be auto. The zero min-height
           still lets it shrink and scroll once the 600px ceiling is reached. */
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 9px;
      }

      /* ── Empty state ─────────────────────────────────────────────────── */

      .vexi-empty {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        text-align: center;
        padding: 4px 2px;
      }

      /* The avatar is position:absolute + inset:0, so it needs a sized,
         positioned box to resolve against. */
      .vexi-empty__portrait {
        position: relative;
        display: block;
        width: 58px;
        height: 74px;
        flex-shrink: 0;
      }

      .vexi-empty__title {
        margin: 2px 0 0;
        font-size: 0.9rem;
        font-weight: 600;
      }

      .vexi-empty__text {
        margin: 0;
        max-width: 240px;
        font-size: 0.76rem;
        line-height: 1.4;
        color: var(--color-text-secondary, inherit);
        opacity: 0.85;
      }

      .vexi-empty__chips {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
        margin-top: 6px;
      }

      .vexi-empty__chip {
        padding: 7px 11px;
        border: 1px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.35);
        border-radius: 999px;
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.08);
        color: inherit;
        font-family: inherit;
        font-size: 0.73rem;
        cursor: pointer;
      }

      .vexi-empty__chip:hover {
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.18);
      }

      .vexi-empty__chip:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.8);
        outline-offset: 2px;
      }

      /* ── Transcript ──────────────────────────────────────────────────── */

      .vexi-turn {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        max-width: 92%;
      }

      .vexi-turn__avatar {
        position: relative;
        display: block;
        width: 24px;
        height: 30px;
        flex-shrink: 0;
      }

      .vexi-msg {
        padding: 8px 11px;
        font-size: 0.87rem;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      /* Asymmetric corners: the flat corner points at who is speaking, which
         is what makes a two-column transcript scannable without reading it. */
      .vexi-msg--assistant {
        border-radius: 14px 14px 14px 4px;
        background: var(--color-surface-secondary, rgba(0, 0, 0, 0.05));
        border: 1px solid var(--color-border, rgba(0, 0, 0, 0.06));
      }

      .vexi-msg--user {
        align-self: flex-end;
        max-width: 85%;
        border-radius: 14px 14px 4px 14px;
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.16);
        border: 1px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.24);
        white-space: pre-wrap;
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
        align-items: center;
        min-height: 34px;
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

      /* Deliberately not the error colour. Red is an alarm, and a search that
         came back empty is not an alarm — it is an answer. Painting it red
         made routine misses look like the product was broken. */
      .vexi-panel__notice {
        margin: 0;
        font-size: 0.8rem;
        color: var(--color-text-secondary, #6b7280);
        font-style: italic;
      }

      .vexi-msg--working {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .vexi-msg__phrase {
        font-size: 0.78rem;
        color: var(--color-text-secondary, #6b7280);
        /* Fades in on every change so the rotation reads as a sequence of
           steps rather than as text glitching in place. */
        animation: vexi-phrase-in 260ms ease;
      }

      @keyframes vexi-phrase-in {
        from {
          opacity: 0;
          transform: translateY(2px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* ── Composer ────────────────────────────────────────────────────── */

      .vexi-panel__composer {
        display: flex;
        gap: 8px;
        padding: 10px;
        border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.07));
        background: var(--color-surface, #fff);
      }

      .vexi-panel__input {
        flex: 1;
        min-width: 0;
        padding: 9px 11px;
        border: 1px solid var(--color-border, rgba(0, 0, 0, 0.12));
        border-radius: 10px;
        font-family: inherit;
        font-size: 0.87rem;
        background: transparent;
        color: inherit;
      }

      .vexi-panel__input:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.55);
        outline-offset: -1px;
      }

      .vexi-panel__send {
        display: grid;
        place-items: center;
        width: 40px;
        flex-shrink: 0;
        border: 0;
        border-radius: 10px;
        background: var(--color-primary, #2ecc71);
        color: #fff;
        cursor: pointer;
      }

      .vexi-panel__send:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      /* ── Markdown produced by markdownToHtml ─────────────────────────── */
      /* innerHTML content never receives the emulated-encapsulation
         attribute, so scoped selectors alone would not reach it. */

      :host ::ng-deep .vexi-md p {
        margin: 0 0 6px;
      }

      :host ::ng-deep .vexi-md p:last-child {
        margin-bottom: 0;
      }

      :host ::ng-deep .vexi-md h2,
      :host ::ng-deep .vexi-md h3 {
        margin: 8px 0 4px;
        font-size: 0.88rem;
        font-weight: 600;
      }

      :host ::ng-deep .vexi-md ul {
        margin: 4px 0;
        padding-left: 18px;
      }

      :host ::ng-deep .vexi-md li {
        margin: 2px 0;
      }

      :host ::ng-deep .vexi-md a {
        color: var(--color-primary, #2ecc71);
        text-decoration: underline;
      }

      :host ::ng-deep .vexi-md img {
        max-width: 100%;
        border-radius: 8px;
      }

      :host ::ng-deep .vexi-md br + br {
        display: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .vexi-caret,
        .vexi-msg--typing span {
          animation: none;
        }

        .vexi-panel__sidebar {
          transition: none;
        }
      }

      /* Mobile overrides last: source order decides which rule wins between
         two selectors of equal specificity. */
      @media (max-width: 480px) {
        .vexi-panel {
          width: calc(100vw - 24px);
        }

        .vexi-panel__sidebar {
          width: 132px;
        }

        .vexi-panel__sidebar-inner {
          width: 132px;
        }
      }
    `,
  ],
})
export class VexiPanelComponent {
  private readonly facade = inject(VexiFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scroller =
    viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly composer =
    viewChild.required<ElementRef<HTMLInputElement>>('composer');

  /** Flips the panel origin when the dock is parked on the left edge. */
  readonly anchorLeft = input(false);
  readonly closed = output<void>();

  protected readonly suggestions = SUGGESTIONS;

  /** Composer text. A signal, not a field: the template reads it. */
  protected readonly draft = signal('');

  // Read the facade's signal parallels straight through. Mirroring them into
  // local signals with manual subscriptions is what the previous widget did,
  // and it is exactly the pattern `vendix-zoneless-signals` rules out.
  protected readonly conversations = this.facade.conversations;
  protected readonly messages = this.facade.messages;
  protected readonly activeConversationId = this.facade.activeConversationId;
  protected readonly streamingContent = this.facade.streamingContent;
  protected readonly isSending = this.facade.isSending;
  protected readonly error = this.facade.error;
  protected readonly toolSteps = this.facade.toolSteps;
  protected readonly pendingProposal = this.facade.pendingProposal;

  protected readonly sidebarOpen = signal(false);
  protected readonly canSend = computed(
    () => !this.isSending() && this.draft().trim().length > 0,
  );

  // ── Muletillas de progreso ──────────────────────────────────────────────

  /** Index into the phrase list, advanced by a timer while Vexi is working. */
  private readonly phraseTick = signal(0);

  /**
   * What Vexi says it is doing while it works.
   *
   * Derived from the tool trace rather than picked at random, so the wording
   * tracks reality: with a tool running it reads as searching, once results
   * are back it reads as reasoning over them. A turn that chains ten tools can
   * take fifteen seconds, and three bouncing dots for fifteen seconds reads as
   * a hang.
   */
  protected readonly progressPhrase = computed(() => {
    const steps = this.toolSteps();
    const running = steps.some((step) => step.status === 'running');

    const phrases = running
      ? WORKING_PHRASES
      : steps.length
        ? REASONING_PHRASES
        : THINKING_PHRASES;

    return phrases[this.phraseTick() % phrases.length];
  });

  /**
   * The failure, said the way a person would say it.
   *
   * The raw message is never shown: it is written for whoever is reading the
   * logs, and by the time it reaches the panel the only thing the person can
   * act on is "it did not work, here is what to try". The backend already
   * turns an exhausted tool loop into a written answer, so what survives to
   * here is a genuine breakdown — network, session, provider — and those all
   * come down to the same advice.
   */
  protected readonly noticeText = computed(() => {
    const raw = (this.error() ?? '').toLowerCase();

    if (raw.includes('network') || raw.includes('conex')) {
      return 'Se me cayó la conexión a mitad de camino. Vuelve a intentarlo en un momento.';
    }
    if (raw.includes('401') || raw.includes('unauthor') || raw.includes('sesi')) {
      return 'Tu sesión venció. Vuelve a entrar y seguimos donde quedamos.';
    }
    return 'No pude completar eso. Inténtalo otra vez, o dímelo de otra forma y lo busco por otro lado.';
  });

  /**
   * `tool` and `system` turns are plumbing, not conversation: the trace already
   * shows what ran, and printing the raw tool payload would bury the answer.
   *
   * Vexi's turns go through markdown; the user's do not. Rendering what the
   * user typed as markdown would let a pasted asterisk silently change their
   * own words back at them.
   */
  protected readonly renderedMessages = computed<RenderedMessage[]>(() =>
    this.messages()
      .filter(
        (message) => message.role === 'user' || message.role === 'assistant',
      )
      .map((message) => ({
        id: message.id,
        role: message.role as 'user' | 'assistant',
        text: message.content,
        html: message.role === 'assistant' ? markdownToHtml(message.content) : '',
      })),
  );

  protected readonly streamingHtml = computed(() => {
    const content = this.streamingContent();
    return content ? markdownToHtml(content) : '';
  });

  protected readonly showEmptyState = computed(
    () =>
      this.renderedMessages().length === 0 &&
      !this.streamingContent() &&
      !this.isSending() &&
      this.toolSteps().length === 0,
  );

  protected readonly statusLine = computed(() => {
    if (this.pendingProposal()) return 'Esperando tu confirmación';
    if (this.streamingContent()) return 'Respondiendo…';
    if (this.isSending()) return 'Pensando…';
    return 'Tu copiloto de tienda';
  });

  constructor() {
    this.facade.loadConversations();

    // Rotate the progress phrase only while there is something to narrate.
    //
    // The interval is created and torn down by the busy state rather than
    // running for the panel's whole life: a timer ticking behind an idle panel
    // wakes the app for nothing, and in a zoneless app every tick is a signal
    // write that schedules a frame.
    let rotateTimer: ReturnType<typeof setInterval> | null = null;
    const stopRotating = () => {
      if (rotateTimer) {
        clearInterval(rotateTimer);
        rotateTimer = null;
      }
    };

    effect(() => {
      const busy = this.isSending();

      untracked(() => {
        if (!busy) {
          stopRotating();
          // Reset so the next turn opens on the first phrase instead of
          // resuming wherever the last one happened to stop.
          this.phraseTick.set(0);
          return;
        }
        if (rotateTimer) return;
        rotateTimer = setInterval(
          () => this.phraseTick.update((tick) => tick + 1),
          PHRASE_ROTATE_MS,
        );
      });
    });

    this.destroyRef.onDestroy(stopRotating);

    // Pin to the newest content whenever the transcript grows or a stream
    // ticks. `afterRenderEffect` runs after the DOM is written, so
    // `scrollHeight` is already the post-update value — no setTimeout guess.
    afterRenderEffect(() => {
      this.messages();
      this.streamingContent();
      this.toolSteps();
      this.pendingProposal();
      const el = this.scroller().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  protected onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected send(event?: Event): void {
    event?.preventDefault();

    const content = this.draft().trim();
    if (!content || this.isSending()) return;

    const conversationId = this.activeConversationId();
    if (conversationId) {
      this.facade.sendMessage(conversationId, content);
    } else {
      this.facade.startConversation(content);
    }

    this.draft.set('');

    // Explicit, not just a side effect of staying enabled: the send button and
    // the suggestion chips are also entry points, and after clicking one the
    // focus sits on that control. Sending should always leave the caret where
    // the next message gets typed.
    this.composer().nativeElement.focus();
  }

  protected useSuggestion(suggestion: string): void {
    if (this.isSending()) return;
    this.draft.set(suggestion);
    this.send();
  }

  protected newConversation(): void {
    this.facade.createConversation();
    this.sidebarOpen.set(false);
  }

  protected selectConversation(id: number): void {
    this.facade.selectConversation(id);
    this.sidebarOpen.set(false);
  }

  /**
   * Approving is a deliberate click and nothing else: no timeout applies it, no
   * keyboard shortcut reaches it, and the card never pre-focuses it.
   */
  protected confirmProposal(): void {
    this.facade.confirmProposal();
  }

  protected rejectProposal(): void {
    this.facade.rejectProposal();
  }
}
