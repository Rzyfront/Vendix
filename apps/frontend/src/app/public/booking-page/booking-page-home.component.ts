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
import { HotelSearchComponent } from '../../private/modules/ecommerce/pages/hotel-booking/hotel-search.component';
import {
  StoreSeoService,
  plainDescription,
} from '../../private/modules/ecommerce/services/store-seo';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { ProductComplementsComponent } from '../product-page/components/product-complements.component';
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
  imports: [HotelSearchComponent, IconComponent, ProductComplementsComponent],
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
      <section class="mx-auto w-full max-w-4xl px-4 pt-8" data-testid="booking-page-hero">
        <p class="text-2xl font-bold text-text-primary md:text-3xl">{{ heading() }}</p>
        <p class="mt-1 text-sm text-text-secondary">
          Elige tus fechas, mira las habitaciones disponibles con su tarifa y su política de cancelación, y reserva en línea.
        </p>
      </section>

      @if (hasSearch()) {
        <app-hotel-search />
      }

      <section class="mx-auto w-full max-w-4xl px-4 pb-6" data-testid="booking-page-checkin-info">
        <div class="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <app-icon name="clipboard-check" [size]="20" class="mt-0.5 shrink-0 text-text-secondary" />
          <p class="text-text-secondary">
            <strong class="text-text-primary">Check-in en línea.</strong>
            Cuando tu reserva esté confirmada, en «Tu reserva» podrás registrar a los huéspedes y sus documentos antes de llegar.
          </p>
        </div>
      </section>

      @if (productIds().length > 0) {
        <div class="border-t border-border bg-surface-secondary/40" data-testid="booking-page-products">
          <app-product-complements [productIds]="productIds()" title="Para tu estadía" [compact]="true" />
        </div>
      }
    }
  `,
})
export class BookingPageHomeComponent {
  private readonly bookingPage = inject(BookingPageService);
  private readonly storeSeo = inject(StoreSeoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<'loading' | 'ready' | 'unavailable'>('loading');
  readonly productIds = computed(() => this.bookingPage.config()?.product_ids ?? []);
  /** The search screen reads its dates from the URL once, on creation. */
  readonly hasSearch = toSignal(
    this.route.queryParamMap.pipe(map((q) => !!q.get('arrival_date') && !!q.get('departure_date'))),
    { initialValue: false },
  );
  readonly heading = computed(() => {
    const name = this.storeSeo.storeName();
    return name ? `Reserva en ${name}` : 'Reserva tu habitación';
  });

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
      this.storeSeo.apply(this, {
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
      });
    });
    this.destroyRef.onDestroy(() => this.storeSeo.release(this));
  }
}
