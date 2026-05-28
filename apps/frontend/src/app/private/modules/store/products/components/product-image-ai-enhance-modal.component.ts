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
      title="Mejorar imagen con IA"
      subtitle="Genera una nueva versión a partir de la foto actual"
      size="lg"
      (cancel)="close()"
    >
      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <div
              class="flex items-center gap-2 text-sm font-semibold text-gray-700"
            >
              <app-icon name="image" size="16"></app-icon>
              Imagen actual
            </div>
            <div
              class="aspect-square rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center"
            >
              @if (sourceImageUrl(); as sourceUrl) {
                <img
                  [src]="sourceUrl"
                  alt="Imagen actual"
                  class="h-full w-full object-contain bg-white p-3"
                />
              } @else {
                <div class="text-sm text-gray-400">Sin imagen</div>
              }
            </div>
          </div>

          <div class="space-y-2">
            <div
              class="flex items-center gap-2 text-sm font-semibold text-gray-700"
            >
              <app-icon name="sparkles" size="16"></app-icon>
              Resultado IA
            </div>
            <div
              class="ai-result-stage aspect-square rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center"
              [class.is-generating]="isGenerating()"
              [class.is-error]="!!errorMessage()"
            >
              @if (generatedImageUrl(); as generatedUrl) {
                <img
                  [src]="generatedUrl"
                  alt="Imagen generada con IA"
                  class="relative z-[2] h-full w-full object-contain bg-white p-3"
                />
              } @else if (isGenerating()) {
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
                    No se pudo mejorar la imagen
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
              } @else {
                <div class="px-5 text-center">
                  <app-icon
                    name="sparkles"
                    size="28"
                    class="text-gray-300 mx-auto"
                  ></app-icon>
                  <p class="mt-2 text-sm text-gray-500">
                    Escribe la mejora y genera una nueva versión.
                  </p>
                </div>
              }
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-semibold text-gray-700">
            ¿Qué quieres mejorar?
          </label>
          <textarea
            class="block w-full min-h-[96px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:opacity-60"
            placeholder="Ej. mejora la iluminación, deja el fondo blanco y haz que el producto se vea más nítido"
            [value]="prompt()"
            [disabled]="isGenerating()"
            (input)="prompt.set($any($event.target).value)"
          ></textarea>
          <div
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          >
            <p class="text-xs text-gray-500">
              La IA mantiene la imagen original como referencia y devuelve una
              alternativa editable antes de guardar.
            </p>
            <app-button
              variant="primary"
              size="sm"
              (clicked)="generate()"
              [loading]="isGenerating()"
              [showTextWhileLoading]="true"
              [disabled]="!canGenerate()"
              customClasses="!rounded-lg"
            >
              <app-icon slot="icon" name="sparkles" size="15"></app-icon>
              Generar
            </app-button>
          </div>
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
                <p class="font-semibold">La imagen original no cambió.</p>
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

        @if (generatedImageUrl() && remainingSlots() <= 0) {
          <div
            class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            Ya tienes 5 imágenes. Puedes reemplazar la actual o dejar la
            anterior.
          </div>
        }
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        <app-button
          variant="outline"
          (clicked)="close()"
          [disabled]="isGenerating()"
        >
          Dejar anterior
        </app-button>
        <app-button
          variant="outline"
          (clicked)="keepBoth()"
          [disabled]="
            !generatedImageUrl() || remainingSlots() <= 0 || isGenerating()
          "
        >
          Conservar ambas
        </app-button>
        <app-button
          variant="primary"
          (clicked)="replaceOriginal()"
          [disabled]="!generatedImageUrl() || isGenerating()"
        >
          Reemplazar
        </app-button>
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
      .ai-result-stage__error-state {
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
  private readonly generationSteps = [
    'Preparando la imagen de referencia...',
    'Analizando luz, fondo y encuadre...',
    'Aplicando la mejora con IA...',
    'Refinando detalles comerciales...',
    'Esperando la versión final...',
  ];
  private generationIntervalId: ReturnType<typeof setInterval> | null = null;

  readonly isOpen = model(false);
  readonly sourceImageUrl = input<string | null>(null);
  readonly productName = input('');
  readonly productType = input<'physical' | 'service'>('physical');
  readonly description = input('');
  readonly remainingSlots = input(0);

  readonly replace = output<string>();
  readonly keep = output<string>();

  readonly prompt = signal('');
  readonly generatedImageUrl = signal<string | null>(null);
  readonly revisedPrompt = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isGenerating = signal(false);
  readonly generationMessage = signal(this.generationSteps[0]);
  readonly generationStepIndex = signal(0);

  readonly canGenerate = computed(() => {
    return (
      !!this.sourceImageUrl() &&
      this.prompt().trim().length >= 3 &&
      !this.isGenerating()
    );
  });
  readonly canRetry = computed(() => {
    return !!this.errorMessage() && this.canGenerate();
  });

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
          this.toastService.success('Imagen generada correctamente');
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
  }

  retryGeneration(): void {
    if (!this.canRetry()) return;
    this.generate();
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
    this.generationMessage.set(this.generationSteps[0]);
  }

  private startGenerationEffects(): void {
    this.stopGenerationEffects();
    this.generationStepIndex.set(0);
    this.generationMessage.set(this.generationSteps[0]);
    this.generationIntervalId = setInterval(() => {
      const nextIndex =
        (this.generationStepIndex() + 1) % this.generationSteps.length;
      this.generationStepIndex.set(nextIndex);
      this.generationMessage.set(this.generationSteps[nextIndex]);
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
    this.generationMessage.set('No se pudo generar la imagen.');
    this.isGenerating.set(false);
  }

  private resolveGenerationError(error: unknown): string {
    const message = extractApiErrorMessage(error);
    if (!message || message === 'Error desconocido') {
      return 'No se pudo generar la imagen. Revisa la conexión o intenta con otra instrucción.';
    }

    return message;
  }
}
