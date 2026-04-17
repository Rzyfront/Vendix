import { Component, input } from '@angular/core';
import { Product } from '../../interfaces';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [],
  template: `
    <div class="product-details">
      <!-- Product details implementation will go here -->
      <p>Componente de detalles del producto</p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ProductDetailsComponent {
  readonly product = input<Product>();
}
