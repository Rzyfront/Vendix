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
 * - Clean, on-brand Vendix experience on a **white** background, NOT a raw error
 *   page. A soft `var(--color-primary)` halo sits behind the mascot for warmth.
 * - The Vendix mascot cat (`/vendixcat.png`) with a gentle CSS float animation.
 *   The `kind` no longer changes the illustration (single PNG), only the copy.
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
          class="dre-card w-full max-w-md rounded-3xl bg-white px-6 py-10 text-center shadow-xl ring-1 ring-black/5 sm:px-9 sm:py-12"
        >
          <!-- Vendix logo -->
          <img
            src="/vlogo.png"
            alt="Vendix"
            class="mx-auto mb-6 h-8 w-auto opacity-95"
          />

          <!-- Vendix mascot cat with a soft brand halo behind it -->
          <div class="relative mx-auto mb-6 flex items-center justify-center">
            <div class="dre-halo" aria-hidden="true"></div>
            <img
              class="dre-cat relative w-44 sm:w-52"
              src="/vendixcat.png"
              [attr.alt]="catAriaLabel()"
            />
          </div>

          <h2
            id="dre-title"
            class="text-2xl font-bold leading-tight text-gray-900 sm:text-3xl"
          >
            {{ title() }}
          </h2>

          <p
            id="dre-subtitle"
            class="mx-auto mt-4 max-w-sm text-base leading-relaxed text-gray-500"
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
      background: #ffffff;
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
        rgba(var(--color-primary-rgb, 46, 204, 113), 0.14) 0%,
        transparent 68%
      );
      pointer-events: none;
    }

    .dre-cat {
      transform-box: fill-box;
      transform-origin: 50% 100%;
      animation: dre-float 3.6s ease-in-out infinite;
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

    @keyframes dre-float {
      0%,
      100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-6px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .dre-overlay,
      .dre-card,
      .dre-cat {
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
      ? 'Gatito Vendix con expresión triste'
      : 'Gatito Vendix saludando',
  );

  onRetry(): void {
    this.retry.emit();
  }
}
