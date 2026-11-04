import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import {
  StoreSeoService,
  plainDescription,
} from '../../private/modules/ecommerce/services/store-seo';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { withPageSeo } from '../app-page/app-page-seo';
import { BookingPageHomeViewComponent } from './booking-page-home-view.component';
import { BookingPageService } from './booking-page.service';
import { defaultBookingSearch } from './booking-page.util';

/**
 * `/` of a hotel booking domain (Apps · STORE_BOOKING): the booking first,
 * then — below and lighter — the amenities and products the owner picked.
 *
 * The booking is the PMS engine screen of the ecommerce (`HotelSearchComponent`,
 * unchanged): dates and guests → room types with photos, amenities, total,
 * deposit and cancellation policy, filtered by availability, allotments,
 * seasons and restrictions → "Reservar" holds the room and opens the payment.
 * The home only lands with a first search already run (tomorrow, one night,
 * two adults), so rates and policies show without filling the form.
 */
@Component({
  selector: 'app-booking-page-home',
  standalone: true,
  imports: [IconComponent, BookingPageHomeViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'loading') {
      <p class="px-6 py-24 text-center text-sm text-text-secondary">Cargando…</p>
    } @else if (state() === 'unavailable') {
      <section
        class="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center"
        data-testid="booking-page-unavailable"
      >
        <app-icon name="bed-double" [size]="40" class="text-text-secondary" />
        <h1 class="text-xl font-semibold text-text-primary">Esta página no está disponible</h1>
        <p class="max-w-md text-sm text-text-secondary">
          Las reservas en línea de este hotel ya no se publican en esta dirección.
        </p>
      </section>
    } @else {
      <app-booking-page-home-view
        [productIds]="productIds()"
        [page]="page()"
        [storeName]="storeSeo.storeName()"
        [hasSearch]="hasSearch()"
      />
    }
  `,
})
export class BookingPageHomeComponent {
  private readonly bookingPage = inject(BookingPageService);
  protected readonly storeSeo = inject(StoreSeoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<'loading' | 'ready' | 'unavailable'>('loading');
  readonly productIds = computed(() => this.bookingPage.config()?.product_ids ?? []);

  /** The owner's own page; `null` keeps the page exactly as it was (apps-f2 S5). */
  readonly page = computed(() => this.bookingPage.config()?.page ?? null);

  /** The search screen reads its dates from the URL once, on creation. */
  readonly hasSearch = toSignal(
    this.route.queryParamMap.pipe(map((q) => !!q.get('arrival_date') && !!q.get('departure_date'))),
    { initialValue: false },
  );

  constructor() {
    this.bookingPage
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((config) => {
        if (!config) {
          this.state.set('unavailable');
          return;
        }
        this.state.set('ready');
        if (!this.route.snapshot.queryParamMap.get('arrival_date')) {
          this.router.navigate([], {
            relativeTo: this.route,
            replaceUrl: true,
            queryParams: defaultBookingSearch(),
          });
        }
      });

    // The booking home is the domain's indexable page; dated searches point
    // their canonical back to it. Released to the store defaults on leave.
    effect(() => {
      const name = this.storeSeo.storeName();
      if (!name || this.state() !== 'ready') return;
      const page = this.page();
      this.storeSeo.apply(this, withPageSeo({
        title: `Reservas | ${name}`,
        description: plainDescription(
          null,
          `Reserva en línea en ${name}: habitaciones disponibles, tarifas y políticas de cancelación, con check-in en línea.`,
        ),
        canonicalPath: '/',
        robots: 'index, follow',
        image: null,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'LodgingBusiness',
          name,
          url: `${this.storeSeo.origin}/`,
        },
      }, page));
    });
    this.destroyRef.onDestroy(() => this.storeSeo.release(this));
  }
}
