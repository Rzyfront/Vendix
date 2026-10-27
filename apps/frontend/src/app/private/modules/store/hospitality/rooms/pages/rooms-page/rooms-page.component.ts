import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  EmptyStateComponent,
  StickyHeaderComponent,
} from '../../../../../../../shared/components/index';

/**
 * Hospitality Suite — H0.1. Rooms landing page.
 *
 * Empty shell that proves the "Hotelería" menu and its industry gating. Room
 * types and rooms (H0.2) fill this page later; until then it only renders the
 * empty state.
 */
@Component({
  selector: 'app-hospitality-rooms-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StickyHeaderComponent, EmptyStateComponent],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Habitaciones"
        subtitle="Tipos de habitación y habitaciones de tu hotel"
        icon="bed-double"
        variant="glass"
      />

      <app-empty-state
        icon="bed-double"
        title="Aún no tienes tipos de habitación"
        description="Aquí verás los tipos de habitación y las habitaciones de tu hotel."
        [showActionButton]="false"
      />
    </div>
  `,
})
export class HospitalityRoomsPageComponent {}
