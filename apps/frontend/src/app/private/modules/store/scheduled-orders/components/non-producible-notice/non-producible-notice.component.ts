import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/**
 * Non-blocking notice (QUI-999) for a non-producible line of a scheduled
 * order. Shown in the POS scheduled step and in the agenda detail. It explains
 * where the line goes and how to manage it from Production. It never blocks
 * the payment.
 */
@Component({
  selector: 'app-non-producible-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <p class="flex items-start gap-1.5 text-xs leading-snug text-text-secondary" role="note">
      <app-icon name="info" [size]="13" class="mt-0.5 shrink-0"></app-icon>
      <span>
        @if (productName()) {
          <span class="font-semibold text-text-primary">{{ productName() }}.</span>
        }
        {{ lead() }}
        Para gestionarlo en Producción, márcalo como 'Producido en lote'.
        @if (productId() != null) {
          <a
            class="font-semibold text-primary underline"
            target="_blank"
            rel="noopener"
            [routerLink]="['/admin/products/edit', productId()]"
            >Ver producto</a
          >
        }
      </span>
    </p>
  `,
})
export class NonProducibleNoticeComponent {
  readonly productId = input<number | null>(null);
  readonly productName = input<string | null>(null);
  /** `prepared` dishes go to the kitchen on the order day; the rest leave stock. */
  readonly productType = input<string | null>(null);

  protected readonly lead = computed(() =>
    this.productType() === 'prepared'
      ? 'Este producto no es producible: se enviará a cocina el día del pedido.'
      : 'Este producto no es producible: sale del stock.',
  );
}
