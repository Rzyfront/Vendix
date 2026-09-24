import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../shared/components';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { ProductsService } from '../services/products.service';

@Component({
  selector: 'app-product-image-ai-enhance-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      size="lg"
      (cancel)="close()"
    >
      <div class="space-y-4">
        <div class="space-y-2 max-w-sm mx-auto">
          <div
            class="flex items-center gap-2 text-sm font-semibold text-gray-700"
          >
            <app-icon
              [name]="generatedImageUrl() ? 'sparkles' : 'image'"
              size="16"
            ></app-icon>
            {{
              generatedImageUrl()
                ? mode() === 'generate'
                  ? 'Resultado IA'
                  : 'Compara el resultado'
                : mode() === 'generate'
                  ? 'Resultado IA'
                  : 'Imagen actual'
            }}
          </div>
          <div
            class="ai-result-stage aspect-square rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center"
            [class.is-generating]="isGenerating()"
            [class.is-error]="!!errorMessage()"
          >
            @if (generatedImageUrl(); as generatedUrl) {
              @if (mode() === 'enhance') {
                @if (sourceImageUrl(); as sourceUrl) {
                  <div class="ai-compare relative z-[2] h-full w-full">
                    <img
                      [src]="generatedUrl"
                      alt="Imagen mejorada con IA"
                      class="absolute inset-0 h-full w-full object-contain bg-surface p-3"
                      draggable="false"
                    />
                    <div
                      class="absolute inset-0"
                      [style.clip-path]="compareClip()"
                    >
                      <img
                        [src]="sourceUrl"
                        alt="Imagen original"
                        class="h-full w-full object-contain bg-surface p-3"
                        draggable="false"
                      />
                    </div>
                    <div
                      class="ai-compare__divider"
                      [style.left.%]="comparePosition()"
                    >
                      <span class="ai-compare__grip"></span>
                    </div>
                    <span class="ai-compare__tag ai-compare__tag--left">
                      Original
                    </span>
                    <span class="ai-compare__tag ai-compare__tag--right">
                      IA
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      [value]="comparePosition()"
                      (input)="onCompareInput($event)"
                      class="ai-compare__range"
                      aria-label="Comparar imagen original con imagen mejorada"
                    />
                  </div>
                } @else {
                  <img
                    [src]="generatedUrl"
                    alt="Imagen mejorada con IA"
                    class="relative z-[2] h-full w-full object-contain bg-surface p-3"
                  />
                }
              } @else {
                <img
                  [src]="generatedUrl"
                  alt="Imagen generada con IA"
                  class="relative z-[2] h-full w-full object-contain bg-surface p-3"
                />
              }
            } @else if (isGenerating()) {
              @if (mode() === 'enhance') {
                @if (sourceImageUrl(); as sourceUrl) {
                  <img
                    [src]="sourceUrl"
                    alt="Imagen original"
                    class="absolute inset-0 z-[1] h-full w-full object-contain bg-surface p-3 blur-[6px] scale-105 saturate-150"
                  />
                }
              }
              <div class="ai-result-stage__placeholder">
                <div class="ai-holo-grid"></div>
                <div class="ai-holo-aurora"></div>
                <div class="ai-sparkle ai-sparkle--a"></div>
                <div class="ai-sparkle ai-sparkle--b"></div>
                <div class="ai-sparkle ai-sparkle--c"></div>
                <div class="ai-sparkle ai-sparkle--d"></div>
                <div class="ai-sparkle ai-sparkle--e"></div>
                <div class="ai-result-stage__halo"></div>
                <div class="ai-result-stage__icon">
                  <app-icon name="sparkles" size="38"></app-icon>
                </div>
                <p class="ai-result-stage__caption">
                  {{ generationMessage() }}
                </p>
              </div>
              <div class="ai-result-stage__shimmer"></div>
              <div class="ai-result-stage__scan"></div>
              <div class="ai-result-stage__prism"></div>
            } @else if (errorMessage(); as error) {
              <div class="ai-result-stage__error-state">
                <div class="ai-result-stage__error-icon">
                  <app-icon name="alert-triangle" size="30"></app-icon>
                </div>
                <p class="ai-result-stage__error-title">
                  {{
                    mode() === 'generate'
                      ? 'No se pudo generar la imagen'
                      : 'No se pudo mejorar la imagen'
                  }}
                </p>
                <p class="ai-result-stage__error-text">{{ error }}</p>
                <app-button
                  variant="outline-danger"
                  size="sm"
                  (clicked)="retryGeneration()"
                  [disabled]="!canRetry()"
                  customClasses="!rounded-lg"
                >
                  <app-icon
                    slot="icon"
                    name="refresh-cw"
                    size="14"
                  ></app-icon>
                  Reintentar
                </app-button>
              </div>
            } @else if (mode() === 'enhance') {
              @if (sourceImageUrl(); as sourceUrl) {
                <img
                  [src]="sourceUrl"
                  alt="Imagen actual"
                  class="relative z-[2] h-full w-full object-contain bg-surface p-3"
                />
              } @else {
                <div class="ai-result-stage__idle">
                  <div class="ai-result-stage__icon">
                    <app-icon name="image" size="30"></app-icon>
                  </div>
                  <p class="ai-result-stage__caption">Sin imagen</p>
                </div>
              }
            } @else {
              <div class="ai-result-stage__idle">
                <div class="ai-result-stage__icon">
                  <app-icon name="sparkles" size="30"></app-icon>
                </div>
                <p class="ai-result-stage__caption">
                  Describe la imagen y pulsa Generar
                </p>
              </div>
            }
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-semibold text-gray-700">
            {{ mode() === 'generate' ? '¿Qué imagen quieres crear?' : '¿Qué quieres mejorar?' }}
          </label>
          <textarea
            class="block w-full min-h-[96px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
            [placeholder]="mode() === 'generate' ? 'Ej. Botella de perfume sobre fondo de mármol blanco con iluminación suave de estudio...' : 'Ej. mejora la iluminación, deja el fondo blanco y haz que el producto se vea más nítido'"
            [value]="prompt()"
            [disabled]="isGenerating()"
            (input)="prompt.set($any($event.target).value)"
          ></textarea>
          @if (generatedImageUrl()) {
            <div class="flex items-center gap-1.5 text-xs text-primary-600 font-medium">
              <app-icon name="sparkles" size="13" class="shrink-0"></app-icon>
              <span>¿No te convenció el resultado? Modifica la instrucción y pulsa <strong>Generar</strong> para probar otra versión.</span>
            </div>
          } @else {
            <p class="text-xs text-gray-500">
              {{ mode() === 'generate'
                ? 'La IA generará una foto comercial cuadrada (1:1) optimizada para catálogo, POS y tienda virtual.'
                : 'La IA mantiene la imagen original como referencia y devuelve una alternativa editable antes de guardar.' }}
            </p>
          }
        </div>

        @if (errorMessage(); as error) {
          <div
            class="flex flex-col gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex min-w-0 items-start gap-2">
              <app-icon
                name="alert-triangle"
                size="16"
                class="mt-0.5 shrink-0"
              ></app-icon>
              <div>
                <p class="font-semibold">
                  {{ mode() === 'generate' ? 'No se pudo completar la generación.' : 'La imagen original no cambió.' }}
                </p>
                <p>{{ error }}</p>
              </div>
            </div>
            <app-button
              variant="outline-danger"
              size="sm"
              (clicked)="retryGeneration()"
              [disabled]="!canRetry()"
              customClasses="!rounded-lg"
            >
              <app-icon slot="icon" name="refresh-cw" size="14"></app-icon>
              Reintentar
            </app-button>
          </div>
        }

        @if (revisedPrompt()) {
          <div
            class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500"
          >
            Prompt ajustado por el modelo: {{ revisedPrompt() }}
          </div>
        }

        @if (generatedImageUrl() && remainingSlots() <= 0 && mode() === 'enhance') {
          <div
            class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            Ya tienes 5 imágenes. Puedes reemplazar la actual o dejar la anterior.
          </div>
        }
      </div>

      <div slot="footer" class="flex flex-wrap items-center justify-between gap-2 w-full">
        <div>
          @if (mode() === 'enhance') {
            <app-button
              variant="outline"
              (clicked)="leaveOriginal()"
              [disabled]="isGenerating()"
            >
              Dejar anterior
            </app-button>
          } @else {
            <app-button
              variant="outline"
              (clicked)="close()"
              [disabled]="isGenerating()"
            >
              Cancelar
            </app-button>
          }
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <app-button
            [variant]="!generatedImageUrl() ? 'primary' : 'outline'"
            (clicked)="generate()"
            [loading]="isGenerating()"
            [showTextWhileLoading]="true"
            [disabled]="!canGenerate()"
          >
            <app-icon slot="icon" name="sparkles" size="15"></app-icon>
            Generar
          </app-button>

          @if (generatedImageUrl()) {
            @if (mode() === 'enhance') {
              <app-button
                variant="outline"
                (clicked)="keepBoth()"
                [disabled]="remainingSlots() <= 0 || isGenerating()"
              >
                Conservar ambas
              </app-button>
              <app-button
                variant="primary"
                (clicked)="replaceOriginal()"
                [disabled]="isGenerating()"
              >
                <app-icon slot="icon" name="check" size="15"></app-icon>
                Reemplazar
              </app-button>
            } @else {
              <app-button
                variant="primary"
                (clicked)="confirmGenerated()"
                [disabled]="remainingSlots() <= 0 || isGenerating()"
              >
                <app-icon slot="icon" name="check" size="15"></app-icon>
                Agregar imagen
              </app-button>
            }
          }
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .ai-result-stage {
        position: relative;
        isolation: isolate;
      }

      .ai-result-stage.is-generating {
        background:
          radial-gradient(
            circle at 50% 50%,
            color-mix(in oklab, var(--color-primary) 10%, transparent),
            transparent 70%
          ),
          var(--color-surface-muted, #f8fafc);
        animation: ai-breathe 2.4s ease-in-out infinite;
      }

      .ai-result-stage.is-error {
        background:
          radial-gradient(
            circle at 50% 50%,
            color-mix(in oklab, var(--color-danger, #dc2626) 8%, transparent),
            transparent 70%
          ),
          var(--color-surface-muted, #f8fafc);
      }

      .ai-result-stage__placeholder,
      .ai-result-stage__error-state,
      .ai-result-stage__idle {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        text-align: center;
        padding: 1.5rem;
      }

      .ai-result-stage__icon,
      .ai-result-stage__error-icon {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 72px;
        height: 72px;
        border-radius: 9999px;
      }

      .ai-result-stage__icon {
        color: var(--color-primary);
        background: color-mix(in oklab, var(--color-primary) 12%, transparent);
        box-shadow:
          0 0 0 1px color-mix(in oklab, var(--color-primary) 25%, transparent),
          0 0 30px color-mix(in oklab, var(--color-primary) 35%, transparent);
        animation: ai-icon-breathe 3s ease-in-out infinite;
      }

      .ai-result-stage__error-icon {
        color: var(--color-danger, #dc2626);
        background: color-mix(
          in oklab,
          var(--color-danger, #dc2626) 12%,
          transparent
        );
        box-shadow:
          0 0 0 1px
            color-mix(in oklab, var(--color-danger, #dc2626) 25%, transparent),
          0 0 24px
            color-mix(in oklab, var(--color-danger, #dc2626) 30%, transparent);
      }

      .ai-result-stage__caption,
      .ai-result-stage__error-text {
        max-width: 280px;
        font-size: 0.875rem;
        line-height: 1.4;
      }

      .ai-result-stage__caption {
        color: var(--color-text-secondary, #64748b);
        animation: ai-soft-pulse 2.4s ease-in-out infinite;
      }

      .ai-result-stage__error-title {
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--color-danger, #dc2626);
      }

      .ai-result-stage__error-text {
        color: var(--color-text-secondary, #64748b);
      }

      .ai-result-stage__halo {
        position: absolute;
        inset: 50% auto auto 50%;
        width: 280px;
        height: 280px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: conic-gradient(
          from 0deg,
          color-mix(in oklab, var(--color-primary) 35%, transparent),
          color-mix(in oklab, var(--color-info, #6366f1) 25%, transparent),
          color-mix(in oklab, var(--color-success, #10b981) 25%, transparent),
          color-mix(in oklab, var(--color-primary) 35%, transparent)
        );
        filter: blur(40px);
        opacity: 0.45;
        z-index: 0;
        animation: ai-halo-spin 6s linear infinite;
      }

      .ai-result-stage__shimmer,
      .ai-result-stage__scan,
      .ai-result-stage__prism {
        position: absolute;
        pointer-events: none;
      }

      .ai-result-stage__shimmer {
        inset: 0;
        z-index: 3;
        background: linear-gradient(
          110deg,
          transparent 30%,
          color-mix(in oklab, white 30%, transparent) 50%,
          transparent 70%
        );
        background-size: 200% 100%;
        background-position: 200% 0;
        animation: ai-shimmer-sweep 2.4s ease-in-out infinite;
        mix-blend-mode: overlay;
      }

      .ai-result-stage__scan {
        left: 0;
        right: 0;
        top: 0;
        height: 2px;
        z-index: 4;
        background: linear-gradient(
          90deg,
          transparent,
          color-mix(in oklab, var(--color-primary) 75%, transparent),
          transparent
        );
        box-shadow: 0 0 14px
          color-mix(in oklab, var(--color-primary) 55%, transparent);
        animation: ai-scan-vertical 2.6s ease-in-out infinite;
      }

      .ai-result-stage__prism {
        inset: 0;
        z-index: 5;
        background: linear-gradient(
          120deg,
          transparent 30%,
          color-mix(in oklab, var(--color-primary) 14%, transparent) 45%,
          color-mix(in oklab, var(--color-info, #6366f1) 14%, transparent) 55%,
          transparent 70%
        );
        mix-blend-mode: screen;
        opacity: 0.55;
        background-size: 200% 100%;
        background-position: 200% 0;
        animation: ai-shimmer-sweep 3.4s ease-in-out infinite;
      }

      .ai-compare {
        touch-action: pan-y;
      }

      .ai-compare__divider {
        position: absolute;
        top: 0;
        bottom: 0;
        z-index: 3;
        width: 2px;
        transform: translateX(-50%);
        background: white;
        box-shadow: 0 0 12px rgba(0, 0, 0, 0.35);
        pointer-events: none;
      }

      .ai-compare:focus-within .ai-compare__divider {
        background: var(--color-primary);
        box-shadow: 0 0 16px
          color-mix(in oklab, var(--color-primary) 70%, transparent);
      }

      .ai-compare__grip {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 40px;
        height: 40px;
        transform: translate(-50%, -50%);
        border-radius: 9999px;
        background: white;
        box-shadow:
          0 2px 10px rgba(0, 0, 0, 0.3),
          0 0 0 1px color-mix(in oklab, var(--color-primary) 35%, transparent);
      }

      .ai-compare__grip::before,
      .ai-compare__grip::after {
        content: '';
        position: absolute;
        top: 50%;
        width: 8px;
        height: 8px;
        border-top: 2px solid var(--color-primary);
        border-right: 2px solid var(--color-primary);
      }

      .ai-compare__grip::before {
        left: 9px;
        transform: translateY(-50%) rotate(-135deg);
      }

      .ai-compare__grip::after {
        right: 9px;
        transform: translateY(-50%) rotate(45deg);
      }

      .ai-compare__tag {
        position: absolute;
        z-index: 4;
        top: 0.75rem;
        padding: 0.2rem 0.6rem;
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        border-radius: 9999px;
        color: white;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(4px);
        pointer-events: none;
      }

      .ai-compare__tag--left {
        left: 0.75rem;
      }

      .ai-compare__tag--right {
        right: 0.75rem;
        background: color-mix(in oklab, var(--color-primary) 85%, black);
      }

      .ai-compare__range {
        position: absolute;
        inset: 0;
        z-index: 5;
        width: 100%;
        height: 100%;
        margin: 0;
        opacity: 0;
        cursor: ew-resize;
      }

      .ai-holo-grid {
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image:
          linear-gradient(
            color-mix(in oklab, var(--color-primary) 18%, transparent) 1px,
            transparent 1px
          ),
          linear-gradient(
            90deg,
            color-mix(in oklab, var(--color-primary) 18%, transparent) 1px,
            transparent 1px
          );
        background-size: 36px 36px;
        background-position: 0 0;
        mask-image: radial-gradient(
          circle at 50% 50%,
          rgba(0, 0, 0, 0.9),
          rgba(0, 0, 0, 0) 70%
        );
        opacity: 0.55;
        animation: ai-holo-grid-drift 8s linear infinite;
      }

      .ai-holo-aurora {
        position: absolute;
        inset: -20%;
        z-index: 0;
        background:
          radial-gradient(
            circle at 30% 30%,
            color-mix(in oklab, var(--color-info, #6366f1) 45%, transparent),
            transparent 55%
          ),
          radial-gradient(
            circle at 70% 60%,
            color-mix(in oklab, var(--color-primary) 40%, transparent),
            transparent 55%
          ),
          radial-gradient(
            circle at 50% 80%,
            color-mix(in oklab, var(--color-success, #10b981) 30%, transparent),
            transparent 55%
          );
        filter: blur(48px);
        opacity: 0.5;
        animation: ai-holo-aurora-shift 9s ease-in-out infinite;
      }

      .ai-sparkle {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: color-mix(in oklab, var(--color-primary) 80%, white);
        box-shadow: 0 0 12px
          color-mix(in oklab, var(--color-primary) 80%, transparent);
        opacity: 0;
        z-index: 2;
      }

      .ai-sparkle--a {
        top: 18%;
        left: 22%;
        animation: ai-sparkle-twinkle 3s ease-in-out infinite;
      }
      .ai-sparkle--b {
        top: 32%;
        right: 18%;
        animation: ai-sparkle-twinkle 3.5s ease-in-out 0.4s infinite;
      }
      .ai-sparkle--c {
        bottom: 24%;
        left: 30%;
        animation: ai-sparkle-twinkle 4s ease-in-out 0.8s infinite;
      }
      .ai-sparkle--d {
        bottom: 18%;
        right: 28%;
        animation: ai-sparkle-twinkle 3.2s ease-in-out 1.2s infinite;
      }
      .ai-sparkle--e {
        top: 50%;
        left: 12%;
        animation: ai-sparkle-twinkle 3.8s ease-in-out 1.6s infinite;
      }

      @keyframes ai-breathe {
        0%,
        100% {
          box-shadow:
            inset 0 0 38px rgba(var(--color-primary-rgb), 0.09),
            0 0 0 rgba(var(--color-primary-rgb), 0);
        }
        50% {
          box-shadow:
            inset 0 0 48px rgba(var(--color-primary-rgb), 0.16),
            0 18px 48px rgba(var(--color-primary-rgb), 0.18);
        }
      }

      @keyframes ai-soft-pulse {
        0%,
        100% {
          opacity: 0.82;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.05);
        }
      }

      @keyframes ai-icon-breathe {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.08);
        }
      }

      @keyframes ai-halo-spin {
        from {
          transform: translate(-50%, -50%) rotate(0deg);
        }
        to {
          transform: translate(-50%, -50%) rotate(360deg);
        }
      }

      @keyframes ai-shimmer-sweep {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      @keyframes ai-scan-vertical {
        0% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(280px);
        }
        100% {
          transform: translateY(0);
        }
      }

      @keyframes ai-sparkle-twinkle {
        0%,
        100% {
          opacity: 0;
          transform: scale(0.6);
        }
        50% {
          opacity: 1;
          transform: scale(1.2);
        }
      }

      @keyframes ai-holo-grid-drift {
        0% {
          background-position: 0 0;
        }
        100% {
          background-position: 36px 36px;
        }
      }

      @keyframes ai-holo-aurora-shift {
        0%,
        100% {
          transform: translate(0, 0) scale(1);
        }
        50% {
          transform: translate(2%, -2%) scale(1.05);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ai-result-stage.is-generating,
        .ai-result-stage__caption,
        .ai-result-stage__icon,
        .ai-result-stage__halo,
        .ai-result-stage__shimmer,
        .ai-result-stage__scan,
        .ai-result-stage__prism,
        .ai-holo-grid,
        .ai-holo-aurora,
        .ai-sparkle {
          animation: none !important;
        }
      }
    `,
  ],
})
export class ProductImageAiEnhanceModalComponent {
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly enhanceSteps = [
    'Preparando la imagen de referencia...',
    'Analizando luz, fondo y encuadre...',
    'Aplicando la mejora con IA...',
    'Refinando detalles comerciales...',
    'Esperando la versión final...',
  ];
  private readonly generateSteps = [
    'Interpretando la descripción comercial...',
    'Componiendo la escena en formato 1:1...',
    'Generando iluminación y textura de producto...',
    'Aplicando acabado de catálogo...',
    'Esperando la versión final...',
  ];
  private generationIntervalId: ReturnType<typeof setInterval> | null = null;

  readonly mode = input<'enhance' | 'generate'>('enhance');
  readonly isOpen = model(false);
  readonly sourceImageUrl = input<string | null>(null);
  readonly productName = input('');
  readonly productType = input<'physical' | 'service'>('physical');
  readonly description = input('');
  readonly remainingSlots = input(0);

  readonly replace = output<string>();
  readonly keep = output<string>();
  readonly generated = output<string>();
  readonly leave = output<void>();

  readonly modalTitle = computed(() =>
    this.mode() === 'generate'
      ? 'Generar imagen con IA'
      : 'Mejorar imagen con IA',
  );
  readonly modalSubtitle = computed(() =>
    this.mode() === 'generate'
      ? 'Crea una imagen comercial desde cero describiendo tu producto'
      : 'Usa inteligencia artificial para perfeccionar la foto de tu producto',
  );

  readonly prompt = signal('');
  readonly generatedImageUrl = signal<string | null>(null);
  readonly revisedPrompt = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isGenerating = signal(false);
  readonly generationMessage = signal(this.enhanceSteps[0]);
  readonly generationStepIndex = signal(0);
  readonly comparePosition = signal(50);

  readonly canGenerate = computed(() => {
    const hasPrompt = this.prompt().trim().length >= 3;
    if (this.isGenerating()) return false;
    if (this.mode() === 'enhance') {
      return !!this.sourceImageUrl() && hasPrompt;
    }
    return hasPrompt;
  });
  readonly canRetry = computed(() => {
    return !!this.errorMessage() && this.canGenerate();
  });
  readonly compareClip = computed(
    () => `inset(0 ${100 - this.comparePosition()}% 0 0)`,
  );

  constructor() {
    effect(() => {
      if (!this.isOpen()) {
        this.reset();
      }
    });

    this.destroyRef.onDestroy(() => this.stopGenerationEffects());
  }

  generate(): void {
    if (!this.canGenerate()) return;

    if (this.mode() === 'enhance') {
      const imageUrl = this.sourceImageUrl();
      if (!imageUrl) return;

      this.isGenerating.set(true);
      this.errorMessage.set(null);
      this.generatedImageUrl.set(null);
      this.revisedPrompt.set(null);
      this.startGenerationEffects();

      this.productsService
        .enhanceProductImage({
          image_url: imageUrl,
          prompt: this.prompt().trim(),
          product_name: this.productName(),
          product_type: this.productType(),
          description: this.description(),
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result) => {
            if (!result?.image_url) {
              this.failGeneration(
                'La IA terminó sin devolver una imagen. Intenta con una instrucción más específica.',
              );
              return;
            }

            this.stopGenerationEffects();
            this.generatedImageUrl.set(result.image_url);
            this.revisedPrompt.set(result.revised_prompt || null);
            this.generationMessage.set('Imagen lista.');
            this.isGenerating.set(false);
            this.toastService.success('Imagen mejorada correctamente');
          },
          error: (error) => {
            const message = this.resolveGenerationError(error);
            this.failGeneration(message);
            this.toastService.error(
              message,
              'No se pudo mejorar la imagen',
              3500,
            );
          },
        });
    } else {
      this.isGenerating.set(true);
      this.errorMessage.set(null);
      this.generatedImageUrl.set(null);
      this.revisedPrompt.set(null);
      this.startGenerationEffects();

      this.productsService
        .generateProductImage({
          prompt: this.prompt().trim(),
          aspect_ratio: '1:1',
          product_name: this.productName(),
          product_type: this.productType(),
          description: this.description(),
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (result) => {
            if (!result?.image_url) {
              this.failGeneration(
                'La IA terminó sin devolver una imagen. Intenta con una instrucción más específica.',
              );
              return;
            }

            this.stopGenerationEffects();
            this.generatedImageUrl.set(result.image_url);
            this.revisedPrompt.set(result.revised_prompt || null);
            this.generationMessage.set('Imagen lista.');
            this.isGenerating.set(false);
            this.toastService.success('Imagen generada correctamente');
          },
          error: (error) => {
            const message = this.resolveGenerationError(error);
            this.failGeneration(message);
            this.toastService.error(
              message,
              'No se pudo generar la imagen',
              3500,
            );
          },
        });
    }
  }

  retryGeneration(): void {
    if (!this.canGenerate()) return;
    this.generate();
  }

  onCompareInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.valueAsNumber;
    if (value === undefined || Number.isNaN(value)) return;
    this.comparePosition.set(Math.min(100, Math.max(0, value)));
  }

  replaceOriginal(): void {
    const generated = this.generatedImageUrl();
    if (!generated) return;
    this.replace.emit(generated);
    this.close();
  }

  keepBoth(): void {
    const generated = this.generatedImageUrl();
    if (!generated || this.remainingSlots() <= 0) return;
    this.keep.emit(generated);
    this.close();
  }

  confirmGenerated(): void {
    const generated = this.generatedImageUrl();
    if (!generated) return;
    this.generated.emit(generated);
    this.close();
  }

  leaveOriginal(): void {
    this.leave.emit();
    this.close();
  }

  close(): void {
    this.isOpen.set(false);
  }

  private reset(): void {
    this.stopGenerationEffects();
    this.prompt.set('');
    this.generatedImageUrl.set(null);
    this.revisedPrompt.set(null);
    this.errorMessage.set(null);
    this.isGenerating.set(false);
    this.generationStepIndex.set(0);
    this.comparePosition.set(50);
    this.generationMessage.set(this.getCurrentSteps()[0]);
  }

  private getCurrentSteps(): string[] {
    return this.mode() === 'generate' ? this.generateSteps : this.enhanceSteps;
  }

  private startGenerationEffects(): void {
    this.stopGenerationEffects();
    const steps = this.getCurrentSteps();
    this.generationStepIndex.set(0);
    this.generationMessage.set(steps[0]);
    this.generationIntervalId = setInterval(() => {
      const nextIndex =
        (this.generationStepIndex() + 1) % steps.length;
      this.generationStepIndex.set(nextIndex);
      this.generationMessage.set(steps[nextIndex]);
    }, 1800);
  }

  private stopGenerationEffects(): void {
    if (!this.generationIntervalId) return;
    clearInterval(this.generationIntervalId);
    this.generationIntervalId = null;
  }

  private failGeneration(message: string): void {
    this.stopGenerationEffects();
    this.generatedImageUrl.set(null);
    this.revisedPrompt.set(null);
    this.errorMessage.set(message);
    this.generationMessage.set('No se pudo procesar la imagen.');
    this.isGenerating.set(false);
  }

  private resolveGenerationError(error: unknown): string {
    const message = extractApiErrorMessage(error);
    if (!message || message === 'Error desconocido') {
      return 'No se pudo procesar la imagen. Revisa la conexión o intenta con otra instrucción.';
    }

    return message;
  }
}
