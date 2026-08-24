import { Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export type AlertBannerVariant = 'warning' | 'info' | 'danger' | 'success';

/**
 * Tono cromático del banner.
 *
 * `palette` es la paleta fija de Tailwind con la que nació el componente y con
 * la que se pintan hoy 153 usos repartidos por toda la aplicación. Es el
 * default y no se toca: repintarla sería un cambio visual en 85 archivos que
 * nadie pidió.
 *
 * `token` usa los tokens del tema (`--color-warning`, `--color-error-light`…),
 * que es lo que exige `vendix-frontend-theme` para código nuevo y lo que ya
 * usaban a mano los avisos de la captura fiscal. Sin este tono, unificarlos en
 * este componente los habría sacado del tema para meterlos en una paleta fija.
 */
export type AlertBannerTone = 'palette' | 'token';

@Component({
  selector: 'app-alert-banner',
  standalone: true,
  imports: [NgClass, IconComponent],
  /**
   * El host se pinta como BLOQUE. Sin esto un elemento a medida se muestra
   * inline, y un elemento inline ignora los márgenes verticales: la clase
   * space-y-* del contenedor —que separa poniendo margin-top al hermano— no
   * separaba nada, y medido en el navegador el aviso quedaba a 0 px del control
   * de arriba y a 0 px del de abajo. Eso es exactamente lo que se veía como
   * «los avisos están muy pegados a las secciones»: no era el color ni el
   * padding interno, era que el margen no se aplicaba.
   *
   * Va en el host y no en cada consumidor porque el problema es del componente:
   * los 153 usos repartidos por la aplicación lo tienen todos.
   */
  host: { class: 'block' },
  template: `
    <!--
      role="alert" SIEMPRE, y no como input opcional.

      Un banner de esta familia existe para decir por qué algo no se puede
      hacer —una resolución vencida, una clave técnica dudosa, un rango de
      habilitación—. Sin el rol, un lector de pantalla no lo anuncia al
      aparecer, y el usuario que no ve la pantalla se queda sin el único
      motivo que se le dio.
    -->
    <div
      role="alert"
      class="flex gap-3 rounded-xl border p-3"
      [ngClass]="containerClasses()"
    >
      <app-icon
        [name]="icon()"
        [size]="18"
        [ngClass]="iconClasses()"
        class="mt-0.5 flex-shrink-0"
      ></app-icon>
      <div class="min-w-0 flex-1">
        @if (heading()) {
          <p class="text-sm font-semibold" [ngClass]="textClasses()">
            {{ heading() }}
          </p>
        }
        <!--
          «div», no «span». El cuerpo de un aviso lleva a veces una lista de
          detalles del servidor, y un «<ul>» dentro de un «<span>» es anidamiento
          inválido: el navegador lo tolera, el HTML no, y el primer estilo que
          dependa del flujo se comporta distinto de como se lee el código.
        -->
        <div
          class="text-sm"
          [class.font-medium]="!heading()"
          [class.mt-0.5]="!!heading()"
          [class.leading-relaxed]="!!heading()"
          [ngClass]="textClasses()"
        >
          <ng-content></ng-content>
        </div>
        <!--
          Ranura de acciones. Existe porque los avisos que valía la pena
          unificar traían botón —«Reintentar», «Reemplazar por las del
          perfil»— y sin sitio para él habrían seguido siendo divs a mano.
        -->
        <ng-content select="[bannerActions]"></ng-content>
      </div>
    </div>
  `,
})
export class AlertBannerComponent {
  readonly variant = input<AlertBannerVariant>('info');
  readonly icon = input('info');
  /** Tono cromático. Ver `AlertBannerTone`. */
  readonly tone = input<AlertBannerTone>('palette');
  /**
   * Título en negrita sobre el cuerpo. Vacío = una sola línea, como siempre.
   *
   * Con título el cuerpo pasa a peso normal y `leading-relaxed`: un párrafo
   * explicativo en seminegrita se lee como un grito.
   */
  readonly heading = input<string>('');

  private static readonly PALETTE: Record<
    AlertBannerVariant,
    { container: string; icon: string; text: string }
  > = {
    warning: {
      container: 'bg-yellow-50 border-yellow-200',
      icon: 'text-yellow-600',
      text: 'text-yellow-800',
    },
    info: {
      container: 'bg-blue-50 border-blue-200',
      icon: 'text-blue-600',
      text: 'text-blue-800',
    },
    danger: {
      container: 'bg-red-50 border-red-200',
      icon: 'text-red-600',
      text: 'text-red-800',
    },
    success: {
      container: 'bg-green-50 border-green-200',
      icon: 'text-green-600',
      text: 'text-green-800',
    },
  };

  private static readonly TOKEN: Record<
    AlertBannerVariant,
    { container: string; icon: string; text: string }
  > = {
    warning: {
      container: 'border-warning/30 bg-warning-light',
      icon: 'text-warning',
      text: 'text-warning',
    },
    info: {
      container:
        // `border-primary/25`, no `border-[var(--color-primary)]/25`: el valor
        // arbitrario con la variable cruda no compone alfa —Tailwind no puede
        // inyectar el canal dentro de un `var()` ya resuelto—, mientras el
        // token `primary.DEFAULT` sí está declarado como
        // `rgba(var(--color-primary-rgb), <alpha-value>)`.
        'border-primary/25 bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)]',
      icon: 'text-[var(--color-primary)]',
      text: 'text-text-primary',
    },
    danger: {
      container: 'border-error bg-error-light',
      icon: 'text-error',
      text: 'text-error',
    },
    success: {
      container: 'border-success/30 bg-success-light',
      icon: 'text-success',
      text: 'text-success',
    },
  };

  private readonly palette = computed(() =>
    this.tone() === 'token'
      ? AlertBannerComponent.TOKEN[this.variant()]
      : AlertBannerComponent.PALETTE[this.variant()],
  );

  readonly containerClasses = computed(() => this.palette().container);
  readonly iconClasses = computed(() => this.palette().icon);
  readonly textClasses = computed(() => this.palette().text);
}
