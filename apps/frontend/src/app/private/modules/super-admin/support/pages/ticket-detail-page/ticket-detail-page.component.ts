import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { TicketDetailComponent } from '../../../../store/settings/support/components/ticket-detail/ticket-detail.component';

/**
 * Wrapper component for super-admin support ticket detail.
 * Delegates to the shared ticket-detail component from store settings.
 */
@Component({
  selector: 'app-ticket-detail-page',
  standalone: true,
  imports: [RouterModule, TicketDetailComponent],
  template: `
    <app-ticket-detail></app-ticket-detail>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
  `]
})
export class TicketDetailPageComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
}
