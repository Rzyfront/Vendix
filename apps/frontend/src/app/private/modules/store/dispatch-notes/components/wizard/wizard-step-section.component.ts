import { Component, input } from '@angular/core';

import { IconComponent } from '../../../../../../shared/components';

/**
 * Wizard step section shell — contenedor presentacional COMÚN de las secciones
 * del wizard de remisión (dispatch notes).
 *
 * Estandariza dos cosas para que todos los pasos se vean uniformes:
 *   1. Cabecera: badge de icono + título + subtítulo opcional.
 *   2. Cuerpo: tarjeta suave con padding canónico (`p-4`, o `p-3` en `dense`)
 *      y `space-y` consistente, proyectando el contenido vía `<ng-content>`.
 *
 * Puramente presentacional: sin servicios ni lógica de negocio; sólo signals
 * `input()`. Patrón LOCAL del módulo dispatch-notes — candidato a promover a
 * `shared/components` si se reutiliza fuera de este wizard.
 *
 * Lenguaje visual tomado de `type-step` / `order-step` (tokens `var(--color-*)`,
 * `rounded-xl`, badge `bg-[var(--color-primary)]/10`).
 */
@Component({
  selector: 'app-wizard-step-section',
  standalone: true,
  imports: [IconComponent],
  template: `
    <section
      class="rounded-xl border border-border bg-[var(--color-surface)] overflow-hidden"
      [class.p-3]="dense()"
      [class.p-4]="!dense()"
    >
      @if (icon() || title()) {
        <header
          class="flex items-center gap-3"
          [class.mb-2]="dense()"
          [class.mb-3]="!dense()"
        >
          @if (icon()) {
            <span
              class="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] shrink-0"
            >
              <app-icon [name]="icon()" [size]="18"></app-icon>
            </span>
          }
          <div class="min-w-0">
            @if (title()) {
              <h3
                class="text-sm font-semibold text-[var(--color-text-primary)] truncate"
              >
                {{ title() }}
              </h3>
            }
            @if (subtitle()) {
              <p class="text-xs text-[var(--color-text-secondary)] leading-snug">
                {{ subtitle() }}
              </p>
            }
          </div>
        </header>
      }

      <div [class.space-y-3]="dense()" [class.space-y-4]="!dense()">
        <ng-content></ng-content>
      </div>
    </section>
  `,
})
export class WizardStepSectionComponent {
  /** Nombre de icono Lucide para el badge de la cabecera (opcional). */
  readonly icon = input<string>('');

  /** Título del paso/sección (opcional). */
  readonly title = input<string>('');

  /** Subtítulo/ayuda; si está vacío no se renderiza la línea. */
  readonly subtitle = input<string>('');

  /** Variante compacta: menos padding y espaciado. */
  readonly dense = input<boolean>(false);
}
