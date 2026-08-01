import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import {DOCUMENT} from '@angular/common';

import {IconComponent} from '../icon/icon.component';

/**
 * Contador de instancias para generar ids únicos de `aria-describedby`.
 * No usamos random porque el id debe ser estable entre render y hydration.
 */
let ackInstanceCounter = 0;

/**
 * Bloque de verificación obligatoria para flujos donde la IA precarga datos
 * que el usuario debe revisar antes de confirmar una carga.
 *
 * El consumidor NO deshabilita su botón de confirmación: lo deja habilitado y,
 * si el check no está marcado, llama a `requestAttention()` — que hace scroll
 * hasta este bloque, enfoca la casilla y la resalta. Así el clic siempre
 * produce feedback en vez de un botón inerte que parece un cuelgue.
 *
 * Usa checkbox nativo (no `ngModel`) a propósito: este componente se proyecta
 * dentro de modales cuyos ancestros pueden tener un `formGroup`, y un `ngModel`
 * sin `standalone: true` en ese contexto lanza NG01350 y aborta la detección
 * de cambios.
 *
 * @example
 * ```html
 * <app-ai-review-ack
 *   #ackBlock
 *   [(acknowledged)]="aiAck"
 *   [itemCount]="items().length"
 *   entityLabel="productos"
 * />
 * ```
 * ```ts
 * private readonly ackBlock = viewChild<AiReviewAckComponent>('ackBlock');
 *
 * onConfirm(): void {
 *   if (this.submitting()) return;
 *   if (!this.aiAck()) { this.ackBlock()?.requestAttention(); return; }
 *   // ...
 * }
 * ```
 */
@Component({
  selector: 'app-ai-review-ack',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div
      class="rounded-xl border transition-all duration-200"
      [class]="containerClasses()"
      [class.ai-ack--attention]="attentionActive()"
    >
      <label
        class="flex items-start gap-3 cursor-pointer select-none"
        [class.p-3]="variant() === 'compact'"
        [class.p-4]="variant() !== 'compact'"
      >
        <input
          #ackCheckbox
          type="checkbox"
          class="mt-0.5 w-4 h-4 shrink-0 rounded cursor-pointer border-amber-400 text-emerald-600 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
          [checked]="acknowledged()"
          [disabled]="disabled()"
          [attr.aria-describedby]="descriptionId"
          (change)="onToggle($event)"
        />
        <div class="min-w-0">
          <p class="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
            <app-icon
              [name]="acknowledged() ? 'shield-check' : 'alert-triangle'"
              [size]="14"
              [class]="acknowledged() ? 'text-emerald-600' : 'text-amber-600'"
            ></app-icon>
            {{ acknowledged() ? 'Verificación confirmada' : 'Verificación obligatoria' }}
          </p>
          <p
            [id]="descriptionId"
            class="text-text-secondary mt-1 leading-relaxed"
            [class]="descriptionClasses()"
          >
            Comprendo que debo revisar la información precargada por la inteligencia
            artificial y que no debo confiar plenamente en los datos extraídos
            automáticamente.
            @if (reviewedLine()) {
              <span class="font-medium text-text-primary">{{ reviewedLine() }}</span>
            }
          </p>
        </div>
      </label>

      @if (attentionActive()) {
        <p
          role="alert"
          class="flex items-center gap-1.5 px-4 pb-3 -mt-1 text-xs font-semibold text-amber-700"
        >
          <app-icon name="alert-triangle" [size]="12"></app-icon>
          Marca esta casilla para poder continuar.
        </p>
      }
    </div>
  `,
  styles: [
    `
      @keyframes aiAckPulse {
        0%,
        100% {
          transform: translateX(0);
        }
        20% {
          transform: translateX(-4px);
        }
        40% {
          transform: translateX(4px);
        }
        60% {
          transform: translateX(-2px);
        }
        80% {
          transform: translateX(2px);
        }
      }

      .ai-ack--attention {
        animation: aiAckPulse 0.45s ease-in-out;
      }

      /* Respetamos la preferencia del sistema: sin desplazamiento, solo el ring. */
      @media (prefers-reduced-motion: reduce) {
        .ai-ack--attention {
          animation: none;
        }
      }
    `,
  ],
})
export class AiReviewAckComponent {
  /** Estado del check. Two-way: `[(acknowledged)]="aiAck"`. */
  readonly acknowledged = model<boolean>(false);

  /** Cantidad de registros que la IA extrajo. Se muestra solo si es > 1. */
  readonly itemCount = input<number | null>(null);

  /** Etiqueta en plural de la entidad ('productos', 'socios', 'paradas'). */
  readonly entityLabel = input<string>('registros');

  /** `compact` reduce padding y tipografía para formularios densos. */
  readonly variant = input<'default' | 'compact'>('default');

  /** Bloquea el check mientras hay una operación en vuelo. */
  readonly disabled = input<boolean>(false);

  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly ackCheckbox =
    viewChild<ElementRef<HTMLInputElement>>('ackCheckbox');

  /** True mientras el bloque está resaltado tras un intento de continuar. */
  readonly attentionActive = signal(false);

  protected readonly descriptionId = `ai-review-ack-desc-${++ackInstanceCounter}`;

  private attentionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearAttentionTimer());
  }

  protected readonly reviewedLine = computed(() => {
    const count = this.itemCount();
    if (count === null || count <= 1) return null;
    return `Revisé los ${count} ${this.entityLabel()} extraídos.`;
  });

  protected readonly descriptionClasses = computed(() =>
    this.variant() === 'compact' ? 'text-[11px]' : 'text-xs',
  );

  protected readonly containerClasses = computed(() => {
    if (this.attentionActive()) {
      return 'border-amber-500 bg-amber-100 ring-2 ring-amber-400 shadow-md';
    }
    if (this.acknowledged()) {
      return 'border-emerald-300 bg-emerald-50';
    }
    return 'border-amber-200 bg-amber-50';
  });

  protected onToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.acknowledged.set(checked);
    if (checked) {
      // Ya cumplió: apagamos el resalte para no dejar la alerta colgada.
      this.attentionActive.set(false);
      this.clearAttentionTimer();
    }
  }

  /**
   * Trae el bloque al centro de la vista, enfoca la casilla y la resalta.
   * El consumidor la llama cuando el usuario intenta confirmar sin marcar.
   *
   * `preventScroll: true` en el focus evita que el navegador haga su propio
   * salto y pelee con el `scrollIntoView` suave que acabamos de disparar.
   */
  requestAttention(): void {
    this.hostRef.nativeElement.scrollIntoView({
      behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });

    this.attentionActive.set(true);
    this.ackCheckbox()?.nativeElement.focus({preventScroll: true});

    this.clearAttentionTimer();
    this.attentionTimer = setTimeout(() => {
      this.attentionActive.set(false);
      this.attentionTimer = null;
    }, 2600);
  }

  /** Vuelve al estado inicial. Obligatorio al cerrar o reiniciar el flujo. */
  reset(): void {
    this.acknowledged.set(false);
    this.attentionActive.set(false);
    this.clearAttentionTimer();
  }

  private prefersReducedMotion(): boolean {
    const view = this.document.defaultView;
    return !!view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  private clearAttentionTimer(): void {
    if (this.attentionTimer !== null) {
      clearTimeout(this.attentionTimer);
      this.attentionTimer = null;
    }
  }
}
