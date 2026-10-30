import { Component, computed, DestroyRef, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { applyMarketingPageMetadata, MARKETING_PAGES } from '../../../marketing-page-metadata';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { TenantFacade } from '../../../../core/store';

/**
 * Confirmation page shown after a successful PQR submission. Displays
 * the generated ticket_number prominently and provides two CTAs: copy
 * to clipboard and jump to the public tracking view.
 */
@Component({
  selector: 'app-pqr-thank-you',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  templateUrl: './pqr-thank-you.component.html',
  styleUrls: ['./pqr-thank-you.component.scss'],
})
export class PqrThankYouComponent {
  // SEO-TECH-04: noindex y sin canonical a la portada en el host comercial (en tiendas no toca nada).
  private readonly restoreMarketingMetadata = applyMarketingPageMetadata(
    inject(DOCUMENT),
    inject(Title),
    inject(Meta),
    MARKETING_PAGES.pqr,
  );
  private readonly marketingMetadataCleanup = inject(DestroyRef).onDestroy(
    this.restoreMarketingMetadata,
  );

  private readonly route = inject(ActivatedRoute);
  private readonly tenantFacade = inject(TenantFacade);

  readonly storeName = computed(
    () => this.tenantFacade.storeName() || this.tenantFacade.getCurrentStore()?.name || '',
  );

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