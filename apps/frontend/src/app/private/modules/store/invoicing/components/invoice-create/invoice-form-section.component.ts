import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from '@angular/core';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/**
 * Sección plegable del modal de factura avanzada.
 *
 * ─── POR QUÉ NO SE REUSA `app-expandable-card` ───────────────────────────────
 *
 * Aquella desmonta su cuerpo con `@if (expanded())`. En una tarjeta de lectura
 * eso es correcto; dentro de un formulario NO lo es: al plegar "Líneas" se
 * destruyen los `app-tax-selector` de cada fila, y ese componente guarda la
 * selección en señales internas (`selectedId`, `isInclusive`). Al desplegar de
 * nuevo vuelven en blanco, aunque el impuesto siga en el payload — el usuario ve
 * que "se le borró" un dato que sí va a viajar, que es la peor combinación
 * posible en una pantalla que gasta numeración autorizada.
 *
 * Aquí el cuerpo NUNCA se desmonta: se oculta. Cuesta un poco de DOM y ahorra
 * una clase entera de bugs de estado fantasma.
 *
 * ─── POR QUÉ LA CABECERA LLEVA CONTADOR DE ERRORES ───────────────────────────
 *
 * Ocho secciones plegadas pueden esconder el campo que el backend rechazó. Un
 * modal que dice "revisa el formulario" mientras el error vive tres secciones
 * más abajo, cerrado, es un callejón sin salida. El contador es lo que convierte
 * "algo está mal" en "está mal AHÍ".
 */
@Component({
  selector: 'vendix-invoice-form-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section
      class="border rounded-lg overflow-hidden transition-colors"
      [class.border-error]="errorCount() > 0"
      [class.border-border]="errorCount() === 0"
    >
      <button
        type="button"
        class="w-full flex items-center gap-3 px-3 py-2.5 text-left bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors min-h-[44px]"
        [attr.aria-expanded]="expanded()"
        (click)="toggle()"
      >
        @if (icon()) {
          <app-icon
            [name]="icon()"
            [size]="16"
            class="shrink-0 text-[var(--color-text-secondary)]"
          />
        }

        <span class="flex-1 min-w-0">
          <span class="block text-sm font-semibold text-text-primary truncate">
            {{ title() }}
          </span>
          @if (summary()) {
            <span
              class="block text-xs text-[var(--color-text-secondary)] truncate"
            >
              {{ summary() }}
            </span>
          }
        </span>

        @if (badge()) {
          <span
            class="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-border"
          >
            {{ badge() }}
          </span>
        }

        @if (errorCount() > 0) {
          <span
            class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-error-light text-error"
            [attr.aria-label]="errorLabel()"
          >
            <app-icon name="alert-triangle" [size]="12" />
            {{ errorCount() }}
          </span>
        }

        @if (optional()) {
          <span
            class="shrink-0 text-[11px] text-[var(--color-text-muted)] hidden sm:inline"
          >
            Opcional
          </span>
        }

        <!--
          La rotación viaja por el input class (aliasado) y NO por una binding
          class.rotate-180. Esa forma escribe en el host app-icon, que es
          display:inline, y transform no aplica sobre un elemento inline no
          reemplazado: el chevron se quedaría quieto sin ningún error visible.
        -->
        <app-icon name="chevron-down" [size]="18" [class]="chevronClass()" />
      </button>

      <!--
        Oculto, no destruido. Ver la nota de arriba: desmontar el cuerpo borra la
        selección visible de impuestos de cada línea.
      -->
      <div
        class="p-3 border-t border-border"
        [class.hidden]="!expanded()"
        [attr.aria-hidden]="!expanded()"
      >
        <ng-content />
      </div>
    </section>
  `,
})
export class InvoiceFormSectionComponent {
  readonly title = input.required<string>();
  readonly icon = input<string>('');
  /** Resumen de una línea que se lee con la sección plegada. */
  readonly summary = input<string>('');
  /** Contador neutro (p. ej. "3 líneas"). */
  readonly badge = input<string>('');
  /** Marca la sección como no obligatoria para emitir. */
  readonly optional = input<boolean>(false);
  /** Cuántos campos de esta sección están en error AHORA. */
  readonly errorCount = input<number>(0);

  readonly expanded = model<boolean>(false);

  readonly chevronClass = computed(
    () =>
      'shrink-0 text-[var(--color-text-secondary)] transition-transform' +
      (this.expanded() ? ' rotate-180' : ''),
  );

  readonly errorLabel = computed(() => {
    const count = this.errorCount();
    return count === 1
      ? '1 campo con error en esta sección'
      : count + ' campos con error en esta sección';
  });

  toggle(): void {
    this.expanded.update((value) => !value);
  }
}
