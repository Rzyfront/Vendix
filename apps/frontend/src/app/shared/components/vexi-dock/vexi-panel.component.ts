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
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VexiFacade } from '../../../core/store/vexi/vexi.facade';
import {
  VexiApiService,
  VexiAttachment,
} from '../../../core/services/vexi-api.service';
import { markdownToHtml } from '../../utils/markdown.util';
import { IconComponent } from '../icon/icon.component';
import { VexiVoicePipelineService } from '../../../core/services/vexi-voice-pipeline.service';
import {
  VexiAvatarComponent,
  type VexiExpression,
} from './vexi-avatar.component';
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
      <!-- Asa de arrastre. Existe porque el dock esconde su avatar mientras este
           panel está abierto, y esa avatar ERA el único asa: sin estas barras el
           conjunto quedaría inmóvil justo cuando más molesta su posición.

           Va arriba y abajo porque el panel se ancla contra cualquiera de las
           cuatro esquinas y el borde que queda a mano cambia con la posición.

           El arrastre no se maneja acá: la posición, la máquina de gestos y el
           regreso al borde viven en el dock, y un segundo escritor de la posición
           dejaría al settle sin saber de uno de los dos. Lo que sale de acá son
           los eventos crudos.

           (Sin comillas invertidas en este literal: una sola cierra la plantilla
           y Angular falla con "Code 1010".) -->
      <span
        class="vexi-panel__grip"
        role="separator"
        aria-label="Arrastra para mover a Vexi"
        (pointerdown)="gripDown.emit($event)"
        (pointermove)="gripMove.emit($event)"
        (pointerup)="gripUp.emit($event)"
        (pointercancel)="gripCancel.emit($event)"
      ></span>

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

        <!-- Alterna en las dos direcciones desde el mismo control. El hilo no se
             toca: son dos vistas de la misma conversación, así que lo dicho y lo
             escrito conviven y cambiar de modo no pierde nada. -->
        <button
          type="button"
          class="vexi-panel__icon-btn"
          [class.is-active]="voiceUi()"
          (click)="toggleVoiceUi()"
          [attr.aria-pressed]="voiceUi()"
          [attr.aria-label]="
            voiceUi() ? 'Volver a escribir' : 'Hablar con Vexi'
          "
          [title]="voiceUi() ? 'Volver a escribir' : 'Hablar con Vexi'"
        >
          <app-icon [name]="voiceUi() ? 'message-square' : 'mic'" [size]="18" />
        </button>

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

      <!-- Modo voz: la avatar arriba, animada mientras habla, y los captions
           DEBAJO de ella. Va acá, hermana de la cabecera, y no dentro de
           .vexi-panel__body: ese body es flex en FILA para poner el cajón de
           conversaciones al costado, así que un tercer hermano ahí se acomodaba
           AL LADO de los captions y les robaba el ancho —el texto quedaba
           partido en columnas de siete caracteres. La raíz .vexi-panel sí es
           flex column, que es la dirección que este bloque necesita.
           Sigue fuera de #scroller, así que tampoco se va con el scroll. -->
      @if (voiceUi()) {
        <div class="vexi-voice__stage">
          <span
            class="vexi-voice__portrait"
            [class.is-speaking]="voiceSpeaking()"
            aria-hidden="true"
          >
            <app-vexi-avatar
              [expression]="voiceExpression()"
              [voice]="voiceSpeaking()"
            />
          </span>
          <p class="vexi-voice__status" role="status">{{ voiceStatus() }}</p>
        </div>
      }

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

        <div
          #scroller
          class="vexi-panel__messages"
          [class.vexi-panel__messages--captions]="voiceUi()"
        >
          <!-- El estado vacío es del modo chat. En modo voz sobra y estorba: el
               escenario de arriba ya muestra la avatar y el estado, así que
               renderizar los dos daba DOS avatares a la vez —una en el escenario
               y otra chica dentro del hilo— más un bloque de bienvenida y sus
               chips de sugerencia debajo del botón de micrófono. Los chips además
               escriben en el composer de texto, que en modo voz no existe. -->
          @if (showEmptyState() && !voiceUi()) {
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

          <!-- Modo voz sin nada dicho todavía: el área de captions queda
               vacía a propósito. No va ningún cartel de relleno — el estado ya
               lo dice la avatar de arriba y la instrucción ya la dice el botón
               de micrófono de abajo; un texto en el medio solo compite con los
               dos por la atención. -->

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

      <!-- Trabajo de fondo. Vive fuera del transcript porque sobrevive al turno
           que lo lanzó: la conversación sigue, y la tira tiene que seguir
           visible mientras el trabajo corre. -->
      @if (activeTask(); as task) {
        <div class="vexi-panel__task" role="status">
          <!-- spin es un input del propio app-icon. Una clase con @keyframes
               aquí no llegaría: el componente declara "class" como input
               (alias de cls), así que la clase acabaría dentro del i-lucide y
               no en el elemento animado. -->
          <app-icon [name]="taskIcon()" [size]="14" [spin]="!taskIsDone()" />
          <span class="vexi-panel__task-text">{{ taskLabel() }}</span>
          <button
            type="button"
            class="vexi-panel__task-close"
            (click)="dismissTask()"
            aria-label="Ocultar el trabajo"
            title="Ocultar. El trabajo sigue corriendo."
          >
            <app-icon name="x" [size]="12" />
          </button>
        </div>
      }

      <!-- Documentos ya subidos y esperando este turno. Se muestran ANTES de
           enviar porque el archivo se sube al elegirlo: la persona tiene que
           poder quitarlo si se equivocó, y ver que llegó antes de escribir. -->
      @if (attachments().length) {
        <ul class="vexi-panel__attachments" aria-label="Documentos adjuntos">
          @for (item of attachments(); track item.attachment_id) {
            <li class="vexi-panel__attachment">
              <app-icon name="file-text" [size]="14" />
              <span class="vexi-panel__attachment-name">{{
                item.original_name
              }}</span>
              <button
                type="button"
                class="vexi-panel__attachment-remove"
                (click)="removeAttachment(item.attachment_id)"
                [attr.aria-label]="'Quitar ' + item.original_name"
              >
                <app-icon name="x" [size]="12" />
              </button>
            </li>
          }
        </ul>
      }
      @if (attachmentError()) {
        <p class="vexi-panel__notice" role="status">{{ attachmentError() }}</p>
      }

      @if (voiceUi()) {
        <!-- Sostener graba, soltar envía. Determinista y sin VAD: la persona
             decide qué se manda, y un detector de voz sumaría un tercer árbitro
             al gesto que el dock ya arbitra. -->
        <div class="vexi-voice__composer">
          <button
            type="button"
            class="vexi-voice__mic"
            [class.is-recording]="voiceRecording()"
            (pointerdown)="onMicDown($event)"
            (pointerup)="onMicUp($event)"
            (pointercancel)="onMicCancel()"
            (keydown.space)="onMicDown($event)"
            (keydown.enter)="onMicDown($event)"
            (keyup.space)="onMicUp($event)"
            (keyup.enter)="onMicUp($event)"
            [attr.aria-pressed]="voiceRecording()"
            aria-label="Mantén presionado para hablar"
          >
            <app-icon [name]="voiceRecording() ? 'square' : 'mic'" [size]="26" />
          </button>
          <p class="vexi-voice__hint">{{ voiceHint() }}</p>
        </div>
      } @else {
      <form class="vexi-panel__composer" (submit)="send($event)">
        <!-- Un solo input de archivo para las dos vías. El atributo capture no se pone
             aquí: en escritorio convierte el botón en una cámara inexistente y
             el diálogo de archivos deja de abrirse. En móvil el propio selector
             ofrece la cámara, que es el camino que la persona ya conoce. -->
        <input
          #filePicker
          type="file"
          class="vexi-panel__file-input"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          (change)="onFilePicked($event)"
          aria-hidden="true"
          tabindex="-1"
        />
        <button
          type="button"
          class="vexi-panel__attach"
          [disabled]="isUploading()"
          (click)="openFilePicker()"
          aria-label="Adjuntar documento"
          title="Adjuntar una factura, un recibo o una foto"
        >
          <app-icon [name]="isUploading() ? 'loader' : 'paperclip'" [size]="18" />
        </button>
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
      }

      <!-- La segunda barra va acá, FUERA del @if que alterna los dos composers
           —el de texto y el de voz— para que exista en los dos modos. Metida
           dentro de una de las ramas desaparecería justo al pasar a voz, que es
           el modo en que el panel más estorba donde está. -->
      <span
        class="vexi-panel__grip"
        role="separator"
        aria-label="Arrastra para mover a Vexi"
        (pointerdown)="gripDown.emit($event)"
        (pointermove)="gripMove.emit($event)"
        (pointerup)="gripUp.emit($event)"
        (pointercancel)="gripCancel.emit($event)"
      ></span>
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

      /* Asa de arrastre: la rayita centrada de una hoja móvil, que es la
         convención que la gente ya sabe leer sin que nadie se lo explique.

         El flex 0 0 auto es obligatorio: el panel es flex en columna y su cuerpo
         crece con flex 1 1 auto, así que sin esto las dos barras se
         comprimirían a cero en cuanto la conversación llenara el alto —justo
         cuando el panel es más grande y más estorba su posición.

         El touch-action en none también: sin eso el navegador reclama el flujo
         del puntero para hacer scroll y pointermove deja de disparar a mitad del
         arrastre. Es la misma razón por la que .vexi-dock lo lleva.

         El área táctil es más alta que la rayita visible —12px de caja para 4px
         de barra— porque una diana de 4px no se agarra con el pulgar. */
      .vexi-panel__grip {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        height: 12px;
        cursor: grab;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent;
      }

      .vexi-panel__grip::before {
        content: '';
        display: block;
        width: 34px;
        height: 4px;
        border-radius: 999px;
        background: var(--color-border, rgba(0, 0, 0, 0.18));
        transition: background 160ms ease;
      }

      .vexi-panel__grip:hover::before {
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.55);
      }

      .vexi-panel__grip:active {
        cursor: grabbing;
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

      /* ── Modo voz ─────────────────────────────────────────────────────── */

      .vexi-voice__stage {
        display: grid;
        justify-items: center;
        gap: 6px;
        padding: 14px 12px 10px;
        border-bottom: 1px solid var(--color-border, rgba(0, 0, 0, 0.07));
        /* flex-shrink:0 es obligatorio aquí: el escenario es hermano de
           .vexi-panel__body —que crece con flex: 1 1 auto— dentro de la columna
           del panel, y sin esto los captions lo comprimen hasta hacerlo
           desaparecer en una conversación larga. */
        flex-shrink: 0;
      }

      /* position: relative NO es decorativo acá. app-vexi-avatar tiene
         :host { position: absolute; inset: 0 }, así que se resuelve contra el
         ancestro POSICIONADO más cercano, no contra su padre. Sin esto el avatar
         se escapaba de la caja de 96px y se estiraba hasta el panel entero:
         desbordaba por la izquierda y tapaba el texto. La regla ng-deep de abajo
         (width/height 100%) no podía salvarlo: ese 100% también se resolvía
         contra el panel. .vexi-empty__portrait ya lo documenta arriba; este
         bloque, añadido después para el modo voz, no lo siguió. Cualquier caja
         nueva que envuelva la avatar necesita position: relative y tamaño.

         Sin comillas invertidas en este comentario a propósito: el bloque styles
         es un template literal y una comilla invertida lo termina, con errores
         TS1005 a 200 líneas de distancia del backtick. */
      .vexi-voice__portrait {
        position: relative;
        display: block;
        width: 96px;
        height: 96px;
        transition: transform 180ms ease;
      }

      .vexi-voice__portrait.is-speaking {
        transform: scale(1.04);
      }

      .vexi-voice__portrait ::ng-deep app-vexi-avatar,
      .vexi-voice__portrait ::ng-deep .vexi-avatar {
        width: 100%;
        height: 100%;
      }

      /* El nacimiento: la contraparte del velo del dock.
         Allá la avatar se encoge y se va detrás del panel; acá nace creciendo y
         apareciendo, para que las dos mitades se lean como un solo movimiento y
         no como dos avatares distintas.

         Es animation y no transition porque estos retratos no cambian de estado:
         se INSERTAN. Una transition sobre un elemento que acaba de entrar al DOM
         no tiene valor previo del que partir y no dispara nada.

         Y va sobre app-vexi-avatar, no sobre la caja que la envuelve, por la
         misma regla de un transform un dueño que rige el dock:
         .vexi-voice__portrait ya es dueña de scale(1.04) cuando habla, y una
         animation sobre transform le arrebataría ese valor durante su corrida
         para devolverlo de golpe al terminar. El host de la avatar no tiene
         transform propio, y vexi-breathe vive en .vexi-avatar__body, que es
         descendiente: las dos capas se multiplican en vez de pelearse.

         (Sin comillas invertidas en todo el bloque styles: es un template
         literal y una sola comilla lo cierra, con errores TS1005 a doscientas
         lineas de distancia.) */
      @keyframes vexi-emerge {
        from {
          opacity: 0;
          transform: scale(0.62);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .vexi-voice__portrait ::ng-deep app-vexi-avatar,
      .vexi-empty__portrait ::ng-deep app-vexi-avatar {
        animation: vexi-emerge 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }

      /* La avatar de cada turno recibe la version corta y sin rebote a
         proposito. Un hilo con historial inserta las suyas TODAS a la vez al
         abrir el panel, y a 24px un pop con overshoot multiplicado por quince
         se lee como un parpadeo del hilo entero. Corta y plana, el hilo se
         asienta; y un turno nuevo sigue teniendo su entrada. */
      .vexi-turn__avatar ::ng-deep app-vexi-avatar {
        animation: vexi-emerge 140ms ease-out both;
      }

      .vexi-voice__status {
        margin: 0;
        font-size: 0.82rem;
        text-align: center;
        color: var(--color-text-secondary, rgba(0, 0, 0, 0.6));
      }

      /* Captions: el mismo transcript, leído a distancia. Solo cambia la escala
         y el ritmo — la tarjeta de confirmación, la traza de herramientas y el
         bloque de streaming se siguen renderizando sin tocarse. */
      .vexi-panel__messages--captions {
        font-size: 0.95rem;
        line-height: 1.55;
      }

      .vexi-voice__composer {
        display: grid;
        justify-items: center;
        gap: 6px;
        padding: 12px 10px 14px;
        border-top: 1px solid var(--color-border, rgba(0, 0, 0, 0.07));
        background: var(--color-surface, #fff);
      }

      .vexi-voice__mic {
        display: grid;
        place-items: center;
        width: 64px;
        height: 64px;
        border: 0;
        border-radius: 50%;
        background: var(--color-primary, #2ecc71);
        color: #fff;
        cursor: pointer;
        /* Sin esto, mantener presionado en móvil arrastra el panel y abre el
           menú de selección en vez de grabar. */
        touch-action: none;
        user-select: none;
        transition:
          background 140ms ease,
          transform 140ms ease;
      }

      .vexi-voice__mic:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.55);
        outline-offset: 3px;
      }

      .vexi-voice__mic.is-recording {
        background: var(--color-danger, #e74c3c);
        transform: scale(1.06);
        animation: vexi-mic-pulse 1.3s ease-in-out infinite;
      }

      @keyframes vexi-mic-pulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.45);
        }
        50% {
          box-shadow: 0 0 0 12px rgba(231, 76, 60, 0);
        }
      }

      .vexi-voice__hint {
        margin: 0;
        font-size: 0.76rem;
        color: var(--color-text-secondary, rgba(0, 0, 0, 0.55));
      }

      /* ── Adjuntos ─────────────────────────────────────────────────────── */

      /* The native control is hidden but NOT display:none and NOT removed from
         the DOM: a detached or undisplayed input cannot be opened by a
         programmatic click in Safari, which is where a phone camera capture
         actually happens. */
      .vexi-panel__file-input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      .vexi-panel__attach {
        display: grid;
        place-items: center;
        width: 36px;
        flex-shrink: 0;
        border: 0;
        border-radius: 10px;
        background: var(--color-surface-2, #f1f3f5);
        color: var(--color-text-secondary, #6b7280);
        cursor: pointer;
      }

      .vexi-panel__attach:disabled {
        opacity: 0.5;
        cursor: progress;
      }

      /* ── Trabajo de fondo ─────────────────────────────────────────────── */

      .vexi-panel__task {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 8px 12px 0;
        padding: 6px 6px 6px 10px;
        border-radius: 10px;
        background: var(--color-surface-2, #f1f3f5);
        color: var(--color-text-secondary, #6b7280);
        font-size: 0.74rem;
      }

      .vexi-panel__task-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vexi-panel__task-close {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        border: 0;
        padding: 2px;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }

      .vexi-panel__attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0;
        padding: 8px 12px 0;
        list-style: none;
      }

      .vexi-panel__attachment {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 100%;
        padding: 3px 6px 3px 8px;
        border-radius: 999px;
        background: var(--color-surface-2, #f1f3f5);
        color: var(--color-text-secondary, #6b7280);
        font-size: 0.72rem;
      }

      /* The name is the only part that can grow, so it is the only part that
         truncates. Without min-width:0 the flex item refuses to shrink below its
         text width and the chip overflows the panel. */
      .vexi-panel__attachment-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vexi-panel__attachment-remove {
        display: grid;
        place-items: center;
        border: 0;
        padding: 2px;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        cursor: pointer;
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

        .vexi-voice__mic.is-recording {
          animation: none;
        }

        .vexi-voice__portrait,
        .vexi-voice__mic {
          transition: none;
        }

        /* El nacimiento se apaga entero, no se acorta: lo que molesta de este
           efecto con reduced-motion es el crecimiento, y sin el crecimiento el
           desvanecido solo no comunica nada. La avatar aparece ya puesta. */
        .vexi-voice__portrait ::ng-deep app-vexi-avatar,
        .vexi-empty__portrait ::ng-deep app-vexi-avatar,
        .vexi-turn__avatar ::ng-deep app-vexi-avatar {
          animation: none;
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

        /* En un teléfono la avatar a 96px se come el espacio de los captions,
           que es lo que la persona necesita leer mientras Vexi habla. */
        .vexi-voice__portrait {
          width: 72px;
          height: 72px;
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
  private readonly filePicker =
    viewChild.required<ElementRef<HTMLInputElement>>('filePicker');
  private readonly chatApi = inject(VexiApiService);

  /** Flips the panel origin when the dock is parked on the left edge. */
  readonly anchorLeft = input(false);

  /**
   * Opens straight into voice mode.
   *
   * Set by the dock when the store runs the `pipeline` engine: there the
   * press-and-hold gesture has no WebRTC session to open, so it opens this panel
   * already listening instead of dropping the person into a text composer they
   * did not ask for.
   */
  readonly openInVoice = input(false);

  readonly closed = output<void>();

  /**
   * Eventos crudos de las dos barras de arrastre, para que el dock los conduzca.
   *
   * Salen sin interpretar —sin umbral, sin decidir si es tap o arrastre— porque
   * la máquina de gestos, la posición y el regreso al borde ya viven en el dock.
   * Interpretarlos acá significaría un segundo escritor de la posición, y el
   * `settle` no sabría de uno de los dos.
   *
   * Son cuatro y no uno porque el arrastre necesita el flujo completo: el `down`
   * captura el puntero, los `move` mueven, y hacen falta las DOS salidas —`up` y
   * `cancel`— porque el sistema operativo puede quitar el puntero a mitad
   * (llamada, notificación, gesto de navegación) y sin el `cancel` el dock se
   * quedaría creyendo que todavía lo están arrastrando.
   */
  readonly gripDown = output<PointerEvent>();
  readonly gripMove = output<PointerEvent>();
  readonly gripUp = output<PointerEvent>();
  readonly gripCancel = output<PointerEvent>();

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
  protected readonly activeTask = this.facade.activeTask;

  protected readonly sidebarOpen = signal(false);

  // ── Modo voz ────────────────────────────────────────────────────────────

  private readonly voice = inject(VexiVoicePipelineService);

  /**
   * Which of the two views of this panel is showing.
   *
   * Runtime state, not a setting: the person flips it mid-conversation with the
   * header icon. What engine answers a voice turn *is* a setting
   * (`store_settings.vexi.voice_engine`) — two independent axes that must not be
   * conflated.
   */
  protected readonly voiceUi = linkedSignal(() => this.openInVoice());

  protected readonly voiceRecording = this.voice.recording;
  protected readonly voiceSpeaking = this.voice.speaking;

  /**
   * The pose, driven by what is actually happening.
   *
   * `wow` while listening rather than a listening pose because the sheet has no
   * such sprite and the names *are* the filenames — inventing one would 404
   * silently while still typechecking.
   */
  protected readonly voiceExpression = computed<VexiExpression>(() => {
    if (this.voice.state() === 'error') return 'error';
    if (this.voiceRecording()) return 'wow';
    if (this.voiceSpeaking()) return 'excited';
    if (this.isSending() || this.voice.state() === 'transcribing') {
      return 'thinking';
    }
    return 'idle';
  });

  /** One line under the avatar, in the person's terms. */
  protected readonly voiceStatus = computed(() => {
    if (this.voice.state() === 'error') {
      return this.voice.errorMessage() ?? 'Algo salió mal con el micrófono.';
    }
    if (this.voiceRecording()) return 'Te escucho…';
    if (this.voice.state() === 'transcribing') return 'Entendiendo lo que dijiste…';
    if (this.voiceSpeaking()) return 'Hablando';
    if (this.pendingProposal()) return 'Esperando tu confirmación';
    if (this.isSending()) return 'Pensando…';
    return 'Mantén presionado el micrófono y habla';
  });

  /** What the mic button says about itself. */
  protected readonly voiceHint = computed(() => {
    if (this.micPromptPending()) {
      return 'Dale permiso al micrófono y vuelve a mantener presionado.';
    }
    if (this.voiceRecording()) return 'Suelta para enviar';
    return 'Mantén presionado para hablar';
  });

  /**
   * True right after the browser's permission dialog ate the first hold.
   *
   * The dialog steals the gesture that opened it, so that hold can never be a
   * recording. Saying so is the difference between "grant permission and try
   * again" and a button that appears broken.
   */
  private readonly micPromptPending = signal(false);

  // ── Trabajo de fondo ────────────────────────────────────────────────────

  /**
   * Whether the job has settled.
   *
   * Reads `live_status` first: it comes from BullMQ and can report `completed`
   * before the `vexi.task.finished` listener has written the row, so trusting only
   * the persisted `status` would spin for one extra poll after the work was done.
   */
  protected readonly taskIsDone = computed(() => {
    const task = this.activeTask();
    if (!task) return false;
    const state = task.live_status ?? task.status;
    return state === 'completed' || state === 'failed' || state === 'cancelled';
  });

  protected readonly taskFailed = computed(() => {
    const task = this.activeTask();
    if (!task) return false;
    const state = task.live_status ?? task.status;
    return state === 'failed' || state === 'cancelled';
  });

  protected readonly taskIcon = computed(() =>
    this.taskFailed()
      ? 'alert-circle'
      : this.taskIsDone()
        ? 'check-circle'
        : 'loader',
  );

  /**
   * One line about the job, in the person's terms.
   *
   * The goal is truncated rather than wrapped: the strip sits above the composer and
   * a three-line goal would push the input off a phone screen.
   */
  protected readonly taskLabel = computed(() => {
    const task = this.activeTask();
    if (!task) return '';

    const goal = task.goal
      ? task.goal.length > 70
        ? `${task.goal.slice(0, 70).trimEnd()}…`
        : task.goal
      : 'el trabajo que dejé corriendo';

    if (this.taskFailed()) {
      return `No pude terminar ${goal}. ${task.error ?? ''}`.trim();
    }
    if (this.taskIsDone()) {
      return `Terminé: ${goal}. Te lo cuento en la campana.`;
    }
    return `Trabajando en segundo plano: ${goal}`;
  });

  protected dismissTask(): void {
    this.facade.dismissTask();
  }

  /**
   * Documents staged for the next turn, already uploaded.
   *
   * Uploaded on pick rather than on send, for two reasons: the person sees
   * immediately that a 4 MB photo arrived, and the send path stays synchronous — an
   * `await` inside `send()` would let a second Enter fire a second turn while the
   * first was still uploading.
   */
  protected readonly attachments = signal<VexiAttachment[]>([]);
  protected readonly isUploading = signal(false);
  protected readonly attachmentError = signal<string | null>(null);

  protected readonly canSend = computed(
    () =>
      !this.isSending() &&
      !this.isUploading() &&
      // A document with no words is a legitimate turn: handing over an invoice IS
      // the message. Requiring text would force people to type "toma" first.
      (this.draft().trim().length > 0 || this.attachments().length > 0),
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

  protected openFilePicker(): void {
    this.attachmentError.set(null);
    // Reset first: picking the same file twice in a row fires no `change` event
    // if the value is still there, so the second attempt would look like nothing
    // happened.
    this.filePicker().nativeElement.value = '';
    this.filePicker().nativeElement.click();
  }

  /**
   * Uploads the picked document and stages its handle.
   *
   * Validation is deliberately left to the server. Mirroring the size and MIME rules
   * here would put a second copy of them in the client, and the copies drift — the
   * server's answer is the one that decides whether the vision application can read
   * the file anyway.
   */
  protected onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isUploading.set(true);
    this.attachmentError.set(null);

    this.chatApi
      .uploadAttachment(file, this.activeConversationId() ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (attachment) => {
          this.attachments.update((current) => [...current, attachment]);
          this.isUploading.set(false);
          this.composer().nativeElement.focus();
        },
        error: (error: unknown) => {
          this.isUploading.set(false);
          this.attachmentError.set(this.uploadFailureText(error));
        },
      });
  }

  protected removeAttachment(attachmentId: string): void {
    this.attachments.update((current) =>
      current.filter((item) => item.attachment_id !== attachmentId),
    );
  }

  /**
   * The server's own message when it wrote one for a person.
   *
   * The upload endpoint answers size and type problems with sentences aimed at the
   * user ("pesa 14 MB y el máximo son 10"), so paraphrasing them would lose the
   * number that makes them actionable. Anything else falls back to advice.
   */
  private uploadFailureText(error: unknown): string {
    const message = (error as { error?: { message?: unknown } })?.error?.message;

    return typeof message === 'string' && message.trim()
      ? message
      : 'No pude recibir el documento. Intenta con una foto más liviana o en otro formato.';
  }

  protected send(event?: Event): void {
    event?.preventDefault();

    const content = this.draft().trim();
    const attachmentIds = this.attachments().map((item) => item.attachment_id);

    if ((!content && !attachmentIds.length) || this.isSending()) return;

    // A document with no words still needs a sentence in the transcript, otherwise
    // the conversation shows an empty user bubble and the model gets an empty goal.
    const message =
      content ||
      (attachmentIds.length === 1
        ? 'Te paso este documento.'
        : 'Te paso estos documentos.');

    const conversationId = this.activeConversationId();
    if (conversationId) {
      this.facade.sendMessage(conversationId, message, attachmentIds);
    } else {
      this.facade.startConversation(message, undefined, attachmentIds);
    }

    this.draft.set('');
    // Cleared on send, not on response: the handles belong to that one turn, and
    // leaving them staged would re-attach the same invoice to the next question.
    this.attachments.set([]);
    this.attachmentError.set(null);

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
    // The mode is read here, at the moment of the approval, and not from a flag
    // the effect could consult later: the person can be listening when they tap
    // Aprobar and reading by the time the acknowledgement comes back, and what
    // decides whether it is spoken is how they gave the approval.
    this.facade.confirmProposal(this.voiceUi());
  }

  protected rejectProposal(): void {
    this.facade.rejectProposal();
  }

  // ── Modo voz ────────────────────────────────────────────────────────────

  /**
   * Switches between the two views of the same conversation.
   *
   * Entering warms the filler bank, because that audio's entire value is being
   * instant: synthesized on the first turn it *is* the latency it exists to hide.
   * Leaving stops whatever was playing — the person went back to reading.
   */
  protected toggleVoiceUi(): void {
    const next = !this.voiceUi();
    this.voiceUi.set(next);
    this.micPromptPending.set(false);

    if (next) {
      void this.voice.warm();
    } else {
      this.voice.interrupt();
      this.composer().nativeElement.focus();
    }
  }

  protected onMicDown(event: Event): void {
    // The button must not also fire a click, and on touch it must not scroll the
    // panel or pop the text-selection menu.
    event.preventDefault();

    const pointer = event as PointerEvent;
    if (pointer.pointerId !== undefined) {
      // Keeps every later pointer event on this button, so a small drag while
      // talking cannot silently end the recording somewhere else.
      (event.currentTarget as HTMLElement)?.setPointerCapture?.(
        pointer.pointerId,
      );
    }

    void this.beginVoiceTurn();
  }

  protected onMicUp(event: Event): void {
    event.preventDefault();
    void this.endVoiceTurn();
  }

  /** A system-level interruption (a call, a gesture the OS claimed). */
  protected onMicCancel(): void {
    this.voice.cancelRecording();
  }

  private async beginVoiceTurn(): Promise<void> {
    if (this.voiceRecording()) return;

    // Deliberately NOT gated on `isSending()`. Talking over Vexi is the barge-in:
    // `startRecording` stops the current playback and drops the frames still
    // arriving for that turn, and the effect's switchMap cancels its stream.
    const started = await this.voice.startRecording();
    this.micPromptPending.set(!started);
  }

  private async endVoiceTurn(): Promise<void> {
    const text = await this.voice.stopRecording();
    // Null covers three normal outcomes: the hold was too short, the recording
    // held no speech, or the transcriber heard nothing. None is an error, and a
    // toast for any of them would punish someone who changed their mind.
    if (!text) return;

    const conversationId = this.activeConversationId();
    if (conversationId) {
      this.facade.sendMessage(conversationId, text, undefined, true);
    } else {
      this.facade.startConversation(text, undefined, undefined, true);
    }
  }
}
