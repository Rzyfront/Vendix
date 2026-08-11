import { Component, computed, input } from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * Tonos disponibles para el ícono de cabecera. Son los mismos siete que ya
 * usaba la vista monolítica, para que las secciones conserven su color al
 * repartirse entre pestañas y el usuario las reconozca.
 */
export type SettingsSectionTone =
  | 'blue'
  | 'pink'
  | 'green'
  | 'teal'
  | 'purple'
  | 'orange'
  | 'indigo';

/**
 * Tarjeta de una sección de configuración: cabecera (ícono + título + pista) y
 * cuerpo proyectado.
 *
 * Extraída de `general-settings.component.html`, donde el mismo bloque de
 * cabecera estaba copiado 13 veces. Ahora que cada grupo vive en su propia
 * página, esta pieza es lo que mantiene las seis páginas visualmente idénticas.
 *
 * `hint` explica el EFECTO del grupo, no el nombre de sus campos: es la única
 * línea que el usuario lee antes de tocar algo.
 */
@Component({
  selector: 'app-settings-section',
  standalone: true,
  imports: [IconComponent],
  template: `
    <section class="settings-section" [attr.id]="anchorId() || null">
      <div class="section-header">
        <div [class]="iconClasses()">
          <app-icon [name]="icon()" size="18"></app-icon>
        </div>
        <div class="section-heading">
          <h2 class="section-title">{{ title() }}</h2>
          @if (hint()) {
            <p class="section-hint">{{ hint() }}</p>
          }
        </div>
      </div>
      <div class="section-body">
        <ng-content></ng-content>
      </div>
    </section>
  `,
  styleUrls: ['./settings-section.component.scss'],
})
export class SettingsSectionComponent {
  readonly icon = input.required<string>();
  readonly title = input.required<string>();
  readonly iconTone = input<SettingsSectionTone>('teal');
  readonly hint = input<string>('');

  /**
   * `id` del `<section>`. Conserva las anclas `section-XXX` de la vista
   * monolítica: el scroll programático ya no existe, pero los enlaces con
   * fragmento y las pruebas E2E que apuntan a esos ids siguen resolviendo.
   */
  readonly anchorId = input<string>('');

  protected readonly iconClasses = computed(
    () => `section-icon section-icon--${this.iconTone()}`,
  );
}
