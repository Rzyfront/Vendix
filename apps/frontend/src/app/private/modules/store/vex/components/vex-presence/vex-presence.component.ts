import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexChatStore } from '../../state/vex-chat.store';
import { VexPresenceStore } from '../../state/vex-presence.store';
import { VexPresenceState, formatVexElapsed } from '../../state/vex-presence.state';
import { VEX_COPY } from '../../vex-copy';

const STATIC_ICONS: Record<VexPresenceState, string> = {
  listening_text: 'message-square',
  listening_voice: 'mic',
  thinking: 'brain',
  speaking: 'volume-2',
  silent: 'moon',
};

/**
 * The Vex mark, animated by the ONE presence state (`VexPresenceStore`):
 *
 * - `listening_text`: soft halo that pulses.
 * - `listening_voice`: round wave + mm:ss timer (generic wave: the voice
 *   pipeline does not expose the microphone level).
 * - `thinking`: continuous orbit (+ the progress line in the `chip` variant).
 * - `speaking`: stepped equalizer bars, visibly different from the wave.
 * - `silent`: still mark.
 *
 * Every state also has a text label; `live` makes the label an
 * `aria-live="polite"` region (only one instance per page should set it).
 * With `prefers-reduced-motion: reduce` the animations are replaced by a
 * static icon next to the same text.
 */
@Component({
  selector: 'vendix-vex-presence',
  standalone: true,
  imports: [IconComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="vex-presence inline-flex items-center gap-2 min-w-0 max-w-full"
      [class.vex-presence--chip]="variant() === 'chip'"
      [attr.data-state]="state()"
    >
      <span
        class="relative shrink-0 grid place-items-center"
        [class]="variant() === 'chip' ? 'w-6 h-6' : 'w-8 h-8'"
        aria-hidden="true"
      >
        @if (state() === 'listening_text') {
          <span class="vex-fx vex-halo"></span>
        }
        @if (state() === 'thinking') {
          <span class="vex-fx vex-orbit"><span class="vex-orbit-dot"></span></span>
        }
        <img
          src="assets/vex/vexicon-96.webp"
          alt=""
          class="relative w-full h-full object-contain"
          [class.opacity-60]="state() === 'silent'"
        />
      </span>

      @switch (state()) {
        @case ('listening_voice') {
          <span class="vex-fx vex-wave" aria-hidden="true">
            <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
          </span>
        }
        @case ('speaking') {
          <span class="vex-fx vex-eq" aria-hidden="true">
            <i></i><i></i><i></i><i></i>
          </span>
        }
      }
      @if (state() !== 'silent') {
        <app-icon
          class="vex-static text-primary shrink-0"
          [name]="static_icon()"
          [size]="16"
        />
      }

      <span
        class="text-xs font-semibold truncate"
        [class]="state() === 'silent' ? 'text-text-secondary' : 'text-text-primary'"
        [attr.role]="live() ? 'status' : null"
        [attr.aria-live]="live() ? 'polite' : null"
        aria-atomic="true"
      >
        {{ label() }}
      </span>

      @if (state() === 'listening_voice') {
        <span
          class="text-xs font-semibold tabular-nums text-text-secondary"
          aria-hidden="true"
        >
          {{ elapsed() }}
        </span>
      }

      @if (variant() === 'chip' && state() === 'thinking' && chat.stream_progress()) {
        <span class="text-xs text-text-secondary truncate" aria-hidden="true">
          · {{ chat.stream_progress() }}
        </span>
      }

      @if (variant() === 'chip' && presence.reading_aloud()) {
        <app-button
          variant="outline"
          size="xsm"
          [ariaLabel]="copy.stop_reading_aria"
          (clicked)="presence.stopReading()"
        >
          <app-icon name="square" [size]="12" slot="icon" />
          {{ copy.stop_reading }}
        </app-button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        min-width: 0;
        max-width: 100%;
      }

      .vex-static {
        display: none;
      }

      .vex-halo {
        position: absolute;
        inset: -0.4rem;
        border-radius: var(--radius-pill);
        background: rgba(var(--color-primary-rgb), 0.2);
        animation: vex-halo-pulse 1.4s ease-in-out infinite;
      }

      .vex-orbit {
        position: absolute;
        inset: -0.3rem;
        border-radius: var(--radius-pill);
        border: 0.125rem solid rgba(var(--color-primary-rgb), 0.2);
        animation: vex-orbit-spin 1.1s linear infinite;
      }

      .vex-orbit-dot {
        position: absolute;
        top: -0.1875rem;
        left: 50%;
        width: 0.375rem;
        height: 0.375rem;
        margin-left: -0.1875rem;
        border-radius: var(--radius-pill);
        background: var(--color-primary);
      }

      /* Listening wave: seven round bars, centered, smooth. */
      .vex-wave {
        display: inline-flex;
        align-items: center;
        gap: 0.125rem;
        height: 1.25rem;
      }

      .vex-wave i {
        width: 0.1875rem;
        height: 100%;
        border-radius: var(--radius-pill);
        background: var(--color-primary);
        transform: scaleY(0.25);
        animation: vex-wave-move 0.9s ease-in-out infinite;
      }

      .vex-wave i:nth-child(2n) {
        animation-delay: -0.3s;
      }

      .vex-wave i:nth-child(3n) {
        animation-delay: -0.6s;
      }

      /* Speaking equalizer: four square bars on the floor, stepped. */
      .vex-eq {
        display: inline-flex;
        align-items: flex-end;
        gap: 0.1875rem;
        height: 1rem;
      }

      .vex-eq i {
        width: 0.25rem;
        height: 100%;
        border-radius: var(--radius-sm);
        background: var(--color-primary);
        transform-origin: bottom;
        transform: scaleY(0.3);
        animation: vex-eq-move 0.8s steps(4, end) infinite alternate;
      }

      .vex-eq i:nth-child(2) {
        animation-duration: 0.55s;
      }

      .vex-eq i:nth-child(3) {
        animation-duration: 0.95s;
      }

      .vex-eq i:nth-child(4) {
        animation-duration: 0.65s;
      }

      @keyframes vex-halo-pulse {
        0%,
        100% {
          transform: scale(0.85);
          opacity: 0.35;
        }
        50% {
          transform: scale(1.15);
          opacity: 0.9;
        }
      }

      @keyframes vex-orbit-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes vex-wave-move {
        0%,
        100% {
          transform: scaleY(0.25);
        }
        50% {
          transform: scaleY(1);
        }
      }

      @keyframes vex-eq-move {
        to {
          transform: scaleY(1);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .vex-fx {
          display: none;
        }

        .vex-static {
          display: inline-flex;
        }
      }
    `,
  ],
})
export class VexPresenceComponent {
  protected readonly presence = inject(VexPresenceStore);
  protected readonly chat = inject(VexChatStore);
  protected readonly copy = VEX_COPY.presence;

  /** `header`: compact mark + label. `chip`: smaller, with progress line and «Detener». */
  readonly variant = input<'header' | 'chip'>('chip');
  /** Makes the label an `aria-live="polite"` region. Set it on ONE instance only. */
  readonly live = input(false);

  protected readonly state = this.presence.state;
  protected readonly static_icon = computed(() => STATIC_ICONS[this.state()]);
  protected readonly elapsed = computed(() =>
    formatVexElapsed(this.presence.recording_seconds()),
  );

  protected readonly label = computed(() => {
    switch (this.state()) {
      case 'listening_text':
        return this.copy.listening_text;
      case 'listening_voice':
        return this.copy.listening_voice;
      case 'thinking':
        return this.copy.thinking;
      case 'speaking':
        return this.presence.reading_aloud()
          ? this.copy.speaking_voice
          : this.copy.speaking_writing;
      default:
        return this.copy.silent;
    }
  });
}
