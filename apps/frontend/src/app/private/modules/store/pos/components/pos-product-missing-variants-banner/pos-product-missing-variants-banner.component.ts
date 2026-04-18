import { Component, input, output } from '@angular/core';
import {
  AlertBannerComponent,
  ButtonComponent,
} from '../../../../../../shared/components';

@Component({
  selector: 'app-pos-product-missing-variants-banner',
  standalone: true,
  imports: [AlertBannerComponent, ButtonComponent],
  template: `
    <app-alert-banner variant="warning" icon="alert-triangle">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
        <span>
          <strong>{{ productName() }}</strong> tiene variantes habilitadas pero no hay ninguna configurada.
          Este producto no se puede vender hasta completar la configuración.
        </span>
        @if (showEditButton()) {
          <app-button
            size="xsm"
            variant="outline"
            (onClick)="editClick.emit()"
          >
            Configurar variantes
          </app-button>
        }
      </div>
    </app-alert-banner>
  `,
})
export class PosProductMissingVariantsBannerComponent {
  readonly productName = input.required<string>();
  readonly showEditButton = input<boolean>(true);
  readonly editClick = output<void>();
}
