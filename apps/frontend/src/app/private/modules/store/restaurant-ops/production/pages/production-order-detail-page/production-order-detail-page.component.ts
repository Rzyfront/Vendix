import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs/operators';
import { CardComponent, StickyHeaderComponent } from '../../../../../../../shared/components';
import { ProductionOrderDetailComponent } from '../../components/production-order-detail/production-order-detail.component';

/** Route host (`production/orders/:id`) of the shared production order detail. */
@Component({
  selector: 'app-production-order-detail-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StickyHeaderComponent, CardComponent, ProductionOrderDetailComponent],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Orden de producción"
        icon="flame"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/restaurant-ops/production"
      />
      <div class="px-2 py-3 md:p-4">
        <app-card [responsive]="true">
          <app-production-order-detail [orderId]="orderId()" />
        </app-card>
      </div>
    </div>
  `,
})
export class ProductionOrderDetailPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly orderId = toSignal(
    this.route.paramMap.pipe(
      map((p) => {
        const n = Number(p.get('id'));
        return Number.isFinite(n) && n > 0 ? n : null;
      }),
    ),
    { initialValue: null },
  );
}
