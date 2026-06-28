import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { PublicHeaderComponent } from '../../../../landing/components/public-header/public-header.component';

/**
 * Confirmation page shown after a successful PQR submission. Displays
 * the generated ticket_number prominently and provides two CTAs: copy
 * to clipboard and jump to the public tracking view.
 */
@Component({
  selector: 'app-pqr-thank-you',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, PublicHeaderComponent],
  templateUrl: './pqr-thank-you.component.html',
  styleUrls: ['./pqr-thank-you.component.scss'],
})
export class PqrThankYouComponent {
  private readonly route = inject(ActivatedRoute);

  readonly ticketNumber = toSignal(
    this.route.paramMap,
    { initialValue: this.route.snapshot.paramMap },
  );

  readonly ticket = computed(() => this.ticketNumber().get('ticket_number') ?? '');

  copy() {
    const v = this.ticket();
    if (!v) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(v).catch(() => undefined);
    }
  }
}