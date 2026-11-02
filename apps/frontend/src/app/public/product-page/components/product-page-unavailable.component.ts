import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/** Shown on a product page domain whose page is not published. */
@Component({
  selector: 'app-product-page-unavailable',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <app-icon name="shopping-bag" [size]="40" class="text-text-secondary" />
      <h1 class="text-xl font-semibold text-text-primary">Esta página no está disponible</h1>
      <p class="max-w-md text-sm text-text-secondary">
        El producto que buscas ya no se publica en esta dirección.
      </p>
    </section>
  `,
})
export class ProductPageUnavailableComponent {}
