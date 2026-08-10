import { Component, computed, input, output } from '@angular/core';

import { IconComponent } from '../icon/icon.component';

/**
 * Botón de descarte para un ítem dentro de una precarga con IA.
 *
 * Hermano de `app-ai-review-ack` (QUI-583): aquel obliga a revisar la lista
 * completa antes de confirmar; este permite excluir de esa lista los ítems que
 * la revisión encontró mal. Sin él la decisión es todo-o-nada — se confirma la
 * carga entera o se descarta el escaneo y se vuelve a empezar—, así que un solo
 * ítem corrupto obliga a cargar basura y limpiarla después a mano.
 *
 * El estado NO vive acá: el consumidor mantiene un `signal<Set<string|number>>`
 * de claves descartadas y este componente solo refleja y emite. Es a propósito —
 * el consumidor necesita ese conjunto para filtrar el payload al confirmar y
 * para contar los activos en el footer, y una sola fuente de verdad evita que
 * la lista y el contador se desincronicen.
 *
 * Es un `<button>` real con `aria-pressed`, no un ícono clickeable: el descarte
 * es un toggle y un lector de pantalla debe poder anunciar su estado.
 *
 * @example
 * ```html
 * <app-ai-discard-toggle
 *   [discarded]="isDiscarded(item.id)"
 *   [label]="item.name"
 *   (toggled)="toggleDiscard(item.id)"
 * />
 * ```
 * ```ts
 * readonly discarded = signal<Set<string | number>>(new Set());
 *
 * isDiscarded(key: string | number): boolean {
 *   return this.discarded().has(key);
 * }
 *
 * toggleDiscard(key: string | number): void {
 *   const next = new Set(this.discarded());
 *   next.has(key) ? next.delete(key) : next.add(key);
 *   this.discarded.set(next);
 * }
 * ```
 */
@Component({
  selector: 'app-ai-discard-toggle',
  standalone: true,
  imports: [IconComponent],
  template: `
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-lg transition-colors duration-150 shrink-0
             focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
      [class]="buttonClasses()"
      [attr.aria-pressed]="discarded()"
      [attr.aria-label]="ariaLabel()"
      [attr.title]="ariaLabel()"
      (click)="toggled.emit()"
    >
      <app-icon
        [name]="discarded() ? 'rotate-ccw' : 'x'"
        [size]="size() === 'sm' ? 14 : 16"
      ></app-icon>
    </button>
  `,
})
export class AiDiscardToggleComponent {
  /** `true` cuando el ítem está marcado para NO cargarse. */
  readonly discarded = input.required<boolean>();

  /** Nombre del ítem, para que la etiqueta accesible diga cuál se descarta. */
  readonly label = input<string>('');

  readonly size = input<'sm' | 'md'>('md');

  /** El consumidor decide qué hacer: acá no se guarda estado. */
  readonly toggled = output<void>();

  protected readonly buttonClasses = computed(() => {
    const box = this.size() === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
    return this.discarded()
      ? `${box} bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:text-[var(--color-primary)]`
      : `${box} text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600`;
  });

  protected readonly ariaLabel = computed(() => {
    const name = this.label();
    const suffix = name ? ` ${name}` : '';
    return this.discarded() ? `Restaurar${suffix}` : `Descartar${suffix}`;
  });
}

/**
 * Clases para atenuar y tachar la fila de un ítem descartado.
 *
 * Vive junto al toggle para que las cinco superficies muestren el descarte
 * igual. Se expone como constante en vez de como directiva porque cada modal
 * arma su fila con una estructura distinta y solo necesita concatenar clases.
 */
export const AI_DISCARDED_ROW_CLASSES =
  'opacity-45 line-through decoration-[var(--color-text-muted)]';
