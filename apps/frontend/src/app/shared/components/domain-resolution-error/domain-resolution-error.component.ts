import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

/**
 * Kind of domain-resolution failure driving the error view.
 * - `not_found`: the store/domain does not exist (bad link or removed store).
 * - `transient`: a temporary/network failure after retries (default).
 */
export type DomainResolutionErrorKind = 'not_found' | 'transient';

/**
 * Full-screen branded error overlay shown when public domain/tenant resolution
 * fails **definitively** (after the resolver's retries are exhausted).
 *
 * Design goals:
 * - Beautiful, on-brand Vendix experience (green gradient built from
 *   `var(--color-primary)` / `var(--color-primary-rgb)`), NOT a raw error page.
 * - An illustrated, hand-drawn cat (inline SVG) animated with pure CSS
 *   `@keyframes` (tail sway, ear twitch, eye blink, gentle breathing). Its
 *   expression changes with `kind`: sad/confused for `not_found`, calm/neutral
 *   for `transient`.
 * - Fully accessible: `role="dialog"`, labelled/described, keyboard-focusable
 *   retry action, and it respects `prefers-reduced-motion` (static cat).
 *
 * Zoneless-safe: pure signal-based `input()` / `output()` / `computed()`; no
 * manual change detection and none of the legacy decorator/emitter APIs.
 *
 * Branding-independent: during a resolution failure the tenant branding may not
 * be loaded, so this component reads NO dynamic tenant config. It relies solely
 * on `var(--color-primary)` (which already carries the Vendix default) with
 * hard-coded Vendix fallbacks.
 *
 * Wiring (done by the caller, e.g. AppComponent):
 *   <app-domain-resolution-error
 *     [kind]="resolutionError()!.kind"
 *     (retry)="onRetryResolution()" />
 */
@Component({
  selector: 'app-domain-resolution-error',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  template: `
    <div
      class="dre-overlay fixed inset-0 z-[9999] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dre-title"
      aria-describedby="dre-subtitle"
    >
      <div
        class="relative flex min-h-full items-center justify-center p-4 sm:p-6"
      >
        <div
          class="dre-card w-full max-w-md rounded-3xl border border-white/15 bg-white/10 px-6 py-9 text-center shadow-2xl backdrop-blur-xl sm:px-9 sm:py-11"
        >
          <!-- Vendix logo -->
          <img
            src="/vlogomono.png"
            alt="Vendix"
            class="mx-auto mb-6 h-8 w-auto opacity-90 drop-shadow"
          />

          <!-- Illustrated cat with a soft brand halo behind it -->
          <div class="relative mx-auto mb-6 flex items-center justify-center">
            <div class="dre-halo" aria-hidden="true"></div>
            <svg
              class="dre-cat relative w-40 sm:w-48"
              viewBox="0 0 240 260"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              [attr.aria-label]="catAriaLabel()"
            >
              <!-- Tail (behind body) -->
              <path
                class="dre-tail"
                d="M165,208 C205,206 226,172 214,140 C207,122 224,110 232,126"
                fill="none"
                stroke="#e9eef2"
                stroke-width="20"
                stroke-linecap="round"
                stroke-linejoin="round"
              />

              <!-- Body -->
              <path
                d="M120,118 C84,118 68,158 68,196 C68,224 92,238 120,238 C148,238 172,224 172,196 C172,158 156,118 120,118 Z"
                fill="#eef2f5"
                stroke="#cbd5db"
                stroke-width="2"
              />

              <!-- Front paws -->
              <ellipse cx="104" cy="234" rx="17" ry="12" fill="#e3e9ee" />
              <ellipse cx="136" cy="234" rx="17" ry="12" fill="#e3e9ee" />

              <!-- Ears (left static, right twitches), drawn before head -->
              <path d="M80,54 L62,108 L116,88 Z" fill="#eef2f5" stroke="#cbd5db" stroke-width="2" stroke-linejoin="round" />
              <path d="M86,66 L76,100 L108,90 Z" fill="#f7b3c1" />
              <g class="dre-ear">
                <path d="M160,54 L178,108 L124,88 Z" fill="#eef2f5" stroke="#cbd5db" stroke-width="2" stroke-linejoin="round" />
                <path d="M154,66 L164,100 L132,90 Z" fill="#f7b3c1" />
              </g>

              <!-- Head -->
              <ellipse cx="120" cy="98" rx="56" ry="52" fill="#f4f7f9" stroke="#cbd5db" stroke-width="2" />

              <!-- Cheeks -->
              <ellipse cx="90" cy="118" rx="7" ry="4.5" fill="#f7b3c1" opacity="0.55" />
              <ellipse cx="150" cy="118" rx="7" ry="4.5" fill="#f7b3c1" opacity="0.55" />

              <!-- Whiskers -->
              <g stroke="#d6dde3" stroke-width="1.6" stroke-linecap="round" opacity="0.85">
                <path d="M92,112 L56,105" />
                <path d="M92,119 L54,119" />
                <path d="M92,126 L56,133" />
                <path d="M148,112 L184,105" />
                <path d="M148,119 L186,119" />
                <path d="M148,126 L184,133" />
              </g>

              <!-- Eyes (blink) -->
              <g class="dre-eye">
                <ellipse cx="100" cy="100" rx="13" ry="17" fill="#242a38" />
                <ellipse cx="100" cy="101" rx="8.5" ry="12" style="fill: var(--color-primary, #2ecc71)" />
                <ellipse cx="100" cy="101" rx="4.5" ry="8" fill="#0d1420" />
                <circle cx="96" cy="94" r="3.2" fill="#ffffff" />
              </g>
              <g class="dre-eye">
                <ellipse cx="140" cy="100" rx="13" ry="17" fill="#242a38" />
                <ellipse cx="140" cy="101" rx="8.5" ry="12" style="fill: var(--color-primary, #2ecc71)" />
                <ellipse cx="140" cy="101" rx="4.5" ry="8" fill="#0d1420" />
                <circle cx="136" cy="94" r="3.2" fill="#ffffff" />
              </g>

              <!-- Nose -->
              <path d="M112,112 Q120,107 128,112 L120,122 Z" fill="#f28fa3" />

              @if (isNotFound()) {
                <!-- Confused / sad expression -->
                <!-- Worried brows (inner corners raised) -->
                <path d="M84,80 L106,74" stroke="#3a4150" stroke-width="3" stroke-linecap="round" />
                <path d="M156,80 L134,74" stroke="#3a4150" stroke-width="3" stroke-linecap="round" />
                <!-- Frown -->
                <path
                  d="M120,122 L120,127 M104,136 Q120,126 136,136"
                  stroke="#3a4150"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  fill="none"
                />
                <!-- Tear under right eye -->
                <g class="dre-tear">
                  <path
                    d="M140,120 C135,127 135,134 140,136 C145,134 145,127 140,120 Z"
                    fill="#7ec8ef"
                  />
                  <circle cx="138" cy="128" r="1.4" fill="#ffffff" opacity="0.8" />
                </g>
                <!-- Floating question mark -->
                <g class="dre-float">
                  <circle cx="196" cy="46" r="17" fill="rgba(255,255,255,0.12)" />
                  <text
                    x="196"
                    y="55"
                    text-anchor="middle"
                    font-size="26"
                    font-weight="800"
                    font-family="system-ui, sans-serif"
                    style="fill: var(--color-primary, #2ecc71)"
                  >
                    ?
                  </text>
                </g>
              } @else {
                <!-- Calm / neutral expression (ω mouth) -->
                <path
                  d="M120,122 L120,128 M120,128 C114,135 107,133 105,126 M120,128 C126,135 133,133 135,126"
                  stroke="#3a4150"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  fill="none"
                />
              }
            </svg>
          </div>

          <h2
            id="dre-title"
            class="text-2xl font-bold leading-tight text-white sm:text-3xl"
          >
            {{ title() }}
          </h2>

          <p
            id="dre-subtitle"
            class="mx-auto mt-4 max-w-sm text-base leading-relaxed text-white/85"
          >
            {{ subtitle() }}
          </p>

          <div class="mt-8">
            <app-button
              variant="primary"
              size="lg"
              [fullWidth]="true"
              (clicked)="onRetry()"
            >
              <app-icon slot="icon" name="refresh" [size]="20" />
              Reintentar
            </app-button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .dre-overlay {
      background:
        radial-gradient(
          120% 90% at 50% 0%,
          rgba(var(--color-primary-rgb, 46, 204, 113), 0.35),
          transparent 55%
        ),
        linear-gradient(165deg, #0c2019 0%, #0f2a20 45%, #081712 100%);
      animation: dre-fade 0.3s ease-out;
    }

    .dre-card {
      animation: dre-pop 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .dre-halo {
      position: absolute;
      inset: 50% auto auto 50%;
      width: 15rem;
      height: 15rem;
      transform: translate(-50%, -50%);
      border-radius: 9999px;
      background: radial-gradient(
        circle,
        rgba(var(--color-primary-rgb, 46, 204, 113), 0.35) 0%,
        transparent 68%
      );
      filter: blur(4px);
      pointer-events: none;
    }

    .dre-cat {
      transform-box: fill-box;
      transform-origin: 50% 100%;
      animation: dre-breathe 3.6s ease-in-out infinite;
    }

    .dre-tail {
      transform-box: fill-box;
      transform-origin: 8% 92%;
      animation: dre-tail 2.8s ease-in-out infinite;
    }

    .dre-ear {
      transform-box: fill-box;
      transform-origin: 50% 100%;
      animation: dre-ear 5s ease-in-out infinite;
    }

    .dre-eye {
      transform-box: fill-box;
      transform-origin: 50% 50%;
      animation: dre-blink 5s ease-in-out infinite;
    }

    .dre-float {
      transform-box: fill-box;
      transform-origin: 50% 50%;
      animation: dre-float 2.4s ease-in-out infinite;
    }

    .dre-tear {
      transform-box: fill-box;
      transform-origin: 50% 0%;
      animation: dre-tear 2.8s ease-in-out infinite;
    }

    @keyframes dre-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes dre-pop {
      from {
        opacity: 0;
        transform: translateY(14px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    @keyframes dre-breathe {
      0%,
      100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.02);
      }
    }

    @keyframes dre-tail {
      0%,
      100% {
        transform: rotate(-7deg);
      }
      50% {
        transform: rotate(9deg);
      }
    }

    @keyframes dre-ear {
      0%,
      88%,
      100% {
        transform: rotate(0deg);
      }
      92% {
        transform: rotate(-9deg);
      }
      96% {
        transform: rotate(4deg);
      }
    }

    @keyframes dre-blink {
      0%,
      92%,
      100% {
        transform: scaleY(1);
      }
      95% {
        transform: scaleY(0.1);
      }
    }

    @keyframes dre-float {
      0%,
      100% {
        transform: translateY(0);
        opacity: 0.9;
      }
      50% {
        transform: translateY(-6px);
        opacity: 1;
      }
    }

    @keyframes dre-tear {
      0% {
        transform: translateY(0);
        opacity: 0;
      }
      20% {
        opacity: 1;
      }
      80% {
        opacity: 1;
      }
      100% {
        transform: translateY(16px);
        opacity: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .dre-overlay,
      .dre-card,
      .dre-cat,
      .dre-tail,
      .dre-ear,
      .dre-eye,
      .dre-float,
      .dre-tear {
        animation: none !important;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DomainResolutionErrorComponent {
  /** Failure variant. Defaults to `transient`. */
  readonly kind = input<DomainResolutionErrorKind>('transient');

  /** Emitted when the user taps "Reintentar". */
  readonly retry = output<void>();

  readonly isNotFound = computed<boolean>(() => this.kind() === 'not_found');

  readonly title = computed<string>(() =>
    this.isNotFound() ? 'No encontramos este comercio' : 'No pudimos conectar',
  );

  readonly subtitle = computed<string>(() =>
    this.isNotFound()
      ? 'El enlace puede estar mal escrito o la tienda ya no está disponible.'
      : 'Revisa tu conexión e inténtalo de nuevo.',
  );

  readonly catAriaLabel = computed<string>(() =>
    this.isNotFound()
      ? 'Gatito con expresión triste y confundida'
      : 'Gatito con expresión tranquila',
  );

  onRetry(): void {
    this.retry.emit();
  }
}
