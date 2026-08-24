import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  model,
  signal,
} from '@angular/core';

import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
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
 * ─── POR QUÉ LA SECCIÓN NO LLEVA `overflow-hidden` ───────────────────────────
 *
 * Lo llevó, y sólo estaba ahí para que el fondo de la cabecera no desbordara las
 * esquinas redondeadas. El precio era desproporcionado: `overflow-hidden`
 * RECORTA cualquier desplegable absoluto de la sección justo en su borde
 * inferior, y `z-index` no vence a `overflow` —el panel de impuestos de una
 * línea salía con `z-[10000]` y se cortaba igual.
 *
 * El redondeo se devuelve por partes: la cabecera lo lleva completo cuando la
 * sección está plegada (es el único hijo visible) y sólo arriba cuando está
 * desplegada; el cuerpo lo lleva abajo. Mismo resultado visual, sin recorte.
 *
 * Las clases del redondeo van por `[class.x]` con nombres SIN corchetes
 * arbitrarios: un valor tipo `bg-[var(--x)]` cerraría el binding antes de tiempo.
 *
 * ─── POR QUÉ LA CABECERA LLEVA CONTADOR DE ERRORES ───────────────────────────
 *
 * Ocho secciones plegadas pueden esconder el campo que el backend rechazó. Un
 * modal que dice "revisa el formulario" mientras el error vive tres secciones
 * más abajo, cerrado, es un callejón sin salida. El contador es lo que convierte
 * "algo está mal" en "está mal AHÍ".
 *
 * ─── POR QUÉ LA AYUDA NO ES UN `app-tooltip` ─────────────────────────────────
 *
 * `app-tooltip` está pensado para una frase: tope de 18rem y
 * `pointer-events: none`. Lo segundo es lo que lo descarta — el texto no se
 * puede seleccionar ni recorrer, y aquí la ayuda explica reglas fiscales de
 * varios párrafos que el operador necesita leer con calma, a veces copiar.
 *
 * Así que la ayuda es un panel propio: se abre al pasar por encima, se FIJA al
 * hacer clic, y sólo entonces se puede leer sin que se cierre al mover el ratón.
 * Cierra con Escape y con un clic fuera. Es la diferencia entre una pista y una
 * explicación, y estas secciones necesitan lo segundo.
 *
 * El botón de ayuda es HERMANO del botón de plegado, no hijo: un `<button>`
 * dentro de otro es HTML inválido, y el clic de dentro además plegaría la
 * sección que se acaba de intentar entender.
 *
 * ─── POR QUÉ LA TARJETA LLEVA SUPERFICIE PROPIA ──────────────────────────────
 *
 * Antes la sección era sólo un borde: el cuerpo heredaba el fondo de la página,
 * así que ocho formularios de campos fiscales se leían como una sola lámina
 * dividida por líneas de 1 px. Ahora el cuerpo pinta `--color-surface` y la
 * cabecera `--color-surface-secondary`: el escalón entre las dos es lo que hace
 * que la cabecera se lea como cabecera sin depender del tamaño de la letra.
 *
 * Cuando la sección tiene errores la cabecera se tiñe (`bg-error-light`). El
 * contador solo no basta: en una pantalla con ocho secciones plegadas hay que
 * poder encontrar la que falla de un barrido, y el color de la banda se ve desde
 * más lejos que un número de 11 px. El contador se queda porque el estado no
 * puede comunicarse SÓLO por color.
 *
 * ─── POR QUÉ EL HOST LLEVA `display: block` ──────────────────────────────────
 *
 * Un componente Angular no trae display propio: su host es `inline`. Y los
 * márgenes VERTICALES no aplican sobre un elemento inline no reemplazado, así
 * que el `space-y-6` del contenedor padre —que se traduce a `margin-top` en
 * `> * + *`— se calculaba y se descartaba: ocho secciones pegadas sin ningún
 * error visible, con la clase correcta puesta en el sitio correcto.
 *
 * Es la misma trampa que la nota del chevron de más abajo, en el otro sentido.
 * Se arregla acá y no en cada página para que la separación no dependa de que
 * quien use la sección se acuerde del detalle.
 */
@Component({
  selector: 'vendix-invoice-form-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [BadgeComponent, IconComponent],
  template: `
    <section
      class="border rounded-lg bg-[var(--color-surface)] shadow-sm transition-colors"
      [class.border-error]="errorCount() > 0"
      [class.border-border]="errorCount() === 0"
    >
      <!--
        El fondo va por «[style.background]» y no por dos clases de Tailwind: una
        clase con valor arbitrario —«bg-[var(--x)]»— NO se puede poner dentro de
        un «[class.x]» porque el corchete cierra la expresión del binding, y
        dejar las dos como clases estáticas haría que ganara la que el bundler
        emita última, que no es algo sobre lo que se pueda razonar.
      -->
      <div
        class="relative flex items-stretch transition-colors"
        [class.rounded-t-lg]="expanded()"
        [class.rounded-lg]="!expanded()"
        [style.background]="
          errorCount() > 0
            ? 'var(--color-error-light)'
            : 'var(--color-surface-secondary)'
        "
      >
      <button
        type="button"
        class="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--color-surface-hover)] transition-colors min-h-[44px]"
        [class.rounded-tl-lg]="expanded()"
        [class.rounded-l-lg]="!expanded()"
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
          <span class="shrink-0" [attr.aria-label]="errorLabel()">
            <app-badge variant="error" size="xs" badgeStyle="outline">
              <app-icon name="alert-triangle" [size]="11" class="mr-1" />
              {{ errorCount() }}
            </app-badge>
          </span>
        }

        @if (optional()) {
          <span class="shrink-0 hidden sm:inline">
            <app-badge variant="neutral" size="xs" badgeStyle="outline">
              Opcional
            </app-badge>
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

      @if (help()) {
        <!--
          El envoltorio escucha el ratón y el botón escucha el clic: pasar por
          encima ASOMA la ayuda, hacer clic la FIJA. Sin lo segundo, un texto de
          varios párrafos se cierra en cuanto el ratón se mueve para leerlo.
        -->
        <div
          class="relative flex items-center pl-1 pr-2"
          (mouseenter)="helpHover.set(true)"
          (mouseleave)="helpHover.set(false)"
        >
          <button
            type="button"
            class="rounded-md p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-primary"
            [class.text-primary]="helpPinned()"
            [attr.aria-expanded]="helpVisible()"
            [attr.aria-label]="helpLabel()"
            (click)="toggleHelp($event)"
          >
            <app-icon name="help-circle" [size]="16" />
          </button>

          @if (helpVisible()) {
            <!--
              whitespace-pre-line es lo que permite que la ayuda venga en
              párrafos: sin él los saltos del texto fuente se colapsan y una
              explicación de reglas fiscales queda como un muro de una línea.

              El clic de dentro se detiene para que no lo lea el cierre por clic
              fuera: seleccionar una cuenta del PUC para copiarla cerraría el
              panel a media selección.
            -->
            <div
              role="note"
              class="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] whitespace-pre-line rounded-lg border border-border bg-[var(--color-surface)] p-3 text-xs leading-relaxed text-[var(--color-text-secondary)] shadow-lg"
              (click)="$event.stopPropagation()"
            >
              {{ help() }}
            </div>
          }
        </div>
      }
      </div>

      <!--
        Oculto, no destruido. Ver la nota de arriba: desmontar el cuerpo borra la
        selección visible de impuestos de cada línea.
      -->
      <div
        class="p-3 sm:p-4 border-t border-border rounded-b-lg bg-[var(--color-surface)]"
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
  /**
   * Explicación larga de para qué sirve la sección. Admite saltos de línea.
   *
   * Vacío = no se pinta el icono de ayuda. Es deliberado: un icono que abre un
   * panel vacío enseña a no volver a pulsarlo.
   */
  readonly help = input<string>('');

  readonly expanded = model<boolean>(false);

  /** Asomada por el ratón. Se va sola al salir. */
  protected readonly helpHover = signal(false);
  /** Fijada por clic. Sólo la cierra otro clic, Escape, o un clic fuera. */
  protected readonly helpPinned = signal(false);

  protected readonly helpVisible = computed(
    () => this.helpPinned() || this.helpHover(),
  );

  protected readonly helpLabel = computed(
    () => 'Qué hace la sección ' + this.title(),
  );

  protected toggleHelp(event: Event): void {
    // Se detiene la propagación por dos razones distintas: el clic no debe
    // llegar al cierre-por-clic-fuera de este mismo componente, y tampoco al
    // botón de plegado si algún día el botón de ayuda quedara dentro de él.
    event.stopPropagation();
    this.helpPinned.update((pinned) => !pinned);
  }

  /**
   * Cierra lo FIJADO, no lo asomado: lo asomado ya se va con `mouseleave`, y
   * llamar a `helpHover.set(false)` desde aquí lo apagaría en mitad de un hover
   * legítimo si el usuario hace clic en cualquier otra parte de la pantalla.
   */
  @HostListener('document:click')
  protected closeHelpOnOutsideClick(): void {
    if (this.helpPinned()) this.helpPinned.set(false);
  }

  @HostListener('document:keydown.escape')
  protected closeHelpOnEscape(): void {
    if (this.helpPinned()) this.helpPinned.set(false);
    if (this.helpHover()) this.helpHover.set(false);
  }

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
