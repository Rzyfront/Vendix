import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  model,
  signal,
} from '@angular/core';

import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * Sección plegable local para el editor de perfiles de plataforma.
 *
 * Mismo comportamiento que `InvoiceFormSectionComponent` del riel tienda, pero
 * local a este módulo para evitar importar desde `store/invoicing/`.
 *
 * El cuerpo NUNCA se desmonta con `@if`: usar `[class.hidden]` para ocultar
 * evita que los controles del formulario se den de baja del FormGroup.
 */
@Component({
  selector: 'app-platform-section-wrapper',
  standalone: true,
  imports: [BadgeComponent, IconComponent],
  // `display: block` en el host, o las secciones salen PEGADAS.
  //
  // Un elemento propio como `app-platform-section-wrapper` es desconocido para
  // el navegador y su display por defecto es `inline`. Los contenedores que
  // apilan estas secciones usan `space-y-6`, que aplica `margin-top` a los
  // hermanos — y `margin-top` NO tiene efecto sobre un elemento inline. El
  // hueco se pedia, se escribia en el padre y el navegador lo descartaba en
  // silencio. Se notaba porque un `<div>` normal en la misma pila (el bloque
  // de «Guardar como perfil») si quedaba separado: ese es block.
  //
  // Va en el host y no en cada uso: asi vale para las 9 secciones de la
  // creacion de facturas y para el editor de perfiles a la vez, y ningun uso
  // futuro puede olvidarse de ponerlo.
  host: { class: 'block' },
  template: `
    <!--
      Sin overflow-hidden.

      Lo llevaba para redondear las esquinas del header y del cuerpo, y de paso
      RECORTABA cualquier descendiente posicionado que se saliera de la caja:
      el desplegable de resultados del buscador de destinatarios era invisible
      por esto, con z-50 y todo (el apilado no salva de un recorte por
      overflow). El redondeo ahora lo pone cada hijo con rounded-t / rounded-b,
      que es lo que se necesitaba de verdad.

      El shadow-sm y el bg-surface son la separación entre secciones: cada una
      se lee como su propia tarjeta sobre el fondo del panel, en vez de una
      sucesión de rectángulos pegados donde no se ve dónde termina «Perfil» y
      empieza «Documento».
    -->
    <div
      class="rounded-lg border bg-surface shadow-sm"
      [class.border-border]="!hasErrors()"
      [class.border-danger/50]="hasErrors()"
    >
      <!-- Cabecera clickeable -->
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-t-lg px-3 py-2 text-left transition-colors"
        [class.rounded-b-lg]="!expanded()"
        [class.bg-surface-secondary]="!expanded()"
        [class.bg-danger/5]="hasErrors() && !expanded()"
        [class.bg-primary/5]="expanded()"
        (click)="toggle()"
      >
        <div class="flex items-center gap-2">
          <app-icon [name]="icon()" [size]="16" class="text-text-secondary"></app-icon>
          <span class="text-sm font-semibold text-text-primary">{{ title() }}</span>
          @if (summary()) {
            <span class="text-xs text-text-secondary">· {{ summary() }}</span>
          }
          @if (optional()) {
            <span class="text-[10px] text-text-tertiary">(opcional)</span>
          }
        </div>
        <div class="flex items-center gap-2">
          @if (errorCount() > 0) {
            <app-badge variant="error" size="sm">{{ errorCount() }}</app-badge>
          }
          <app-icon
            name="chevron-down"
            [size]="16"
            class="text-text-secondary transition-transform"
            [class.rotate-180]="expanded()"
          ></app-icon>
        </div>
      </button>

      <!-- Cuerpo — NO se desmonta con @if, se oculta -->
      <div
        class="rounded-b-lg border-t bg-surface px-3 py-3"
        [class.hidden]="!expanded()"
      >
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class PlatformSectionWrapperComponent {
  readonly title = input.required<string>();
  readonly icon = input('file-text');
  readonly summary = input<string | null>(null);
  readonly errorCount = input<number>(0);
  readonly optional = input(false);

  readonly expanded = model(true);

  readonly hasErrors = computed(() => this.errorCount() > 0);

  toggle(): void {
    this.expanded.set(!this.expanded());
  }
}
