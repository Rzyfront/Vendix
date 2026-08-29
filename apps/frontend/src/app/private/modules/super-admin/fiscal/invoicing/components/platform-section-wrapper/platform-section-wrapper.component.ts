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
  template: `
    <div
      class="rounded-lg border overflow-hidden"
      [class.border-border]="!hasErrors()"
      [class.border-danger/50]="hasErrors()"
    >
      <!-- Cabecera clickeable -->
      <button
        type="button"
        class="flex w-full items-center justify-between px-3 py-2 text-left transition-colors"
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
        class="px-3 py-3 bg-surface border-t"
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
