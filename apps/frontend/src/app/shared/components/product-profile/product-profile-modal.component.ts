import { Component, computed, input, model } from '@angular/core';
import { ModalComponent } from '../modal/modal.component';
import { IconComponent } from '../icon/icon.component';
import { ProductProfileComponent } from './product-profile.component';
import {
  ProductProfileProduct,
  ProductProfileRecipe,
  ProductProfileVariant,
} from './product-profile.interface';

/**
 * Envoltorio de la ficha para abrirla como modal desde cualquier módulo
 * (KDS, producción, fórmulas, recetas).
 *
 * El wrapper solo aporta el chrome (`app-modal`); el contenido y la densidad
 * viven en `ProductProfileComponent`, así inline y modal se ven idénticos.
 */
@Component({
  selector: 'app-product-profile-modal',
  standalone: true,
  imports: [ModalComponent, ProductProfileComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="title()"
      size="xl-mid"
      [dialog]="true"
      [showCloseButton]="true"
      (cancel)="isOpen.set(false)"
    >
      <span slot="header">
        <app-icon name="chef-hat" [size]="20" class="text-primary" />
      </span>
      @if (product(); as p) {
        <app-product-profile
          [product]="p"
          [variant]="variant()"
          [recipe]="recipe()"
          [showMoney]="showMoney()"
        />
      }
    </app-modal>
  `,
})
export class ProductProfileModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly product = input<ProductProfileProduct | null>(null);
  readonly variant = input<ProductProfileVariant | null>(null);
  readonly recipe = input<ProductProfileRecipe | null>(null);
  readonly showMoney = input<boolean>(true);

  readonly title = computed<string>(() => this.product()?.name ?? 'Ficha del producto');
}
