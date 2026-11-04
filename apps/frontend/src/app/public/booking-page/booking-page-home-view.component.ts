import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HotelSearchComponent } from '../../private/modules/ecommerce/pages/hotel-booking/hotel-search.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import {
  AppPageDocument,
  effectiveMode,
  modeSells,
} from '../../private/modules/store/apps/templates/app-page.types';
import { AppPageViewComponent } from '../app-page/app-page-view.component';
import { ProductComplementsComponent } from '../product-page/components/product-complements.component';

/** A room type the editor's preview lists in place of the PMS engine. */
export interface BookingPreviewRoom {
  id: number;
  name: string;
  description: string | null;
  max_occupancy: number;
  bed_config: string | null;
  image_url: string | null;
}

/**
 * The booking home as it is drawn (F6-B): the owner's hero, the booking (the
 * PMS engine screen), the online check-in note, the owner's blocks and the
 * «para tu estadía» products. The public home (`BookingPageHomeComponent`)
 * feeds it the page config and the URL search; the editor's preview feeds it
 * the draft.
 *
 * `blockIds` (off on the public page: no extra attributes) marks the hero and
 * each section with `data-block-id` for the editor's preview. `previewRooms`
 * and `previewProducts` (editor only) draw the booking and the products from
 * plain data instead of calling the PMS engine and the ecommerce cards.
 */
@Component({
  selector: 'app-booking-page-home-view',
  standalone: true,
  imports: [HotelSearchComponent, IconComponent, ProductComplementsComponent, AppPageViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (page()) {
      <app-app-page-view kind="booking" [page]="page()" part="hero" [blockIds]="blockIds()" />
    }

    @if (showSearch()) {
      <section
        class="mx-auto w-full max-w-4xl px-4 pt-8"
        data-testid="booking-page-hero"
        [attr.id]="page() ? 'app-page-main' : null"
        [attr.data-block-id]="searchBlockId()"
      >
        <p class="text-2xl font-bold text-text-primary md:text-3xl">{{ heading() }}</p>
        <p class="mt-1 text-sm text-text-secondary">{{ subheading() }}</p>
      </section>

      @if (previewRooms(); as rooms) {
        <section class="mx-auto w-full max-w-4xl px-4 pt-4" data-testid="preview-rooms" [attr.data-block-id]="searchBlockId()">
          <div class="grid gap-3 md:grid-cols-2">
            @for (room of rooms; track room.id) {
              <article class="overflow-hidden rounded-xl border border-border bg-surface">
                <div class="aspect-video bg-surface-secondary">
                  @if (room.image_url) {
                    <img [src]="room.image_url" [alt]="room.name" class="h-full w-full object-cover" />
                  }
                </div>
                <div class="p-3">
                  <p class="text-sm font-semibold text-text-primary">{{ room.name }}</p>
                  <p class="text-xs text-text-secondary">
                    Hasta {{ room.max_occupancy }} huéspedes@if (room.bed_config) { · {{ room.bed_config }} }
                  </p>
                </div>
              </article>
            } @empty {
              <p class="text-sm text-text-secondary md:col-span-2">Aún no tienes habitaciones activas.</p>
            }
          </div>
        </section>
      } @else if (hasSearch()) {
        <app-hotel-search />
      }
    }

    @if (showCheckinInfo()) {
      <section class="mx-auto w-full max-w-4xl px-4 pb-6" data-testid="booking-page-checkin-info" [attr.data-block-id]="checkinBlockId()">
        <div class="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <app-icon name="clipboard-check" [size]="20" class="mt-0.5 shrink-0 text-text-secondary" />
          @if (checkinText(); as custom) {
            <p class="text-text-secondary">{{ custom }}</p>
          } @else {
            <p class="text-text-secondary">
              <strong class="text-text-primary">Check-in en línea.</strong>
              Cuando tu reserva esté confirmada, en «Tu reserva» podrás registrar a los huéspedes y sus documentos antes de llegar.
            </p>
          }
        </div>
      </section>
    }

    @if (page()) {
      <app-app-page-view kind="booking" [page]="page()" part="blocks" [blockIds]="blockIds()" />
    }

    @if (showProducts()) {
      <div class="border-t border-border bg-surface-secondary/40" data-testid="booking-page-products" [attr.data-block-id]="productsBlockId()">
        @if (previewProducts(); as picked) {
          <section class="mx-auto w-full max-w-6xl px-4 py-6" data-testid="preview-products">
            <h2 class="mb-3 text-lg font-semibold text-text-primary">{{ productsTitle() }}</h2>
            <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
              @for (item of picked; track item.id) {
                <article class="overflow-hidden rounded-xl border border-border bg-surface">
                  <div class="aspect-square bg-surface-secondary">
                    @if (item.image_url) {
                      <img [src]="item.image_url" [alt]="item.name" class="h-full w-full object-cover" />
                    }
                  </div>
                  <p class="truncate px-3 py-2 text-sm font-medium text-text-primary">{{ item.name }}</p>
                </article>
              }
            </div>
          </section>
        } @else {
          <app-product-complements [productIds]="productIds()" [title]="productsTitle()" [compact]="true" />
        }
      </div>
    }
  `,
})
export class BookingPageHomeViewComponent {
  readonly productIds = input<number[]>([]);
  /** The owner's own page; `null` keeps the page exactly as it was (apps-f2 S5). */
  readonly page = input<AppPageDocument | null>(null);
  readonly storeName = input<string | null>(null);
  /** The search screen of the PMS only loads once the URL carries the dates. */
  readonly hasSearch = input(false);
  readonly blockIds = input(false);
  readonly previewRooms = input<BookingPreviewRoom[] | null>(null);
  readonly previewProducts = input<{ id: number; name: string; image_url: string | null }[] | null>(null);

  private block(type: string) {
    return this.page()?.blocks.find((b) => b.type === type) ?? null;
  }
  private text(type: string, key: string): string | null {
    const v = this.block(type)?.props[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  private markId(type: string): string | null {
    return this.blockIds() ? (this.block(type)?.id ?? null) : null;
  }

  readonly searchBlockId = computed(() => this.markId('search'));
  readonly checkinBlockId = computed(() => this.markId('checkin_info'));
  readonly productsBlockId = computed(() => this.markId('products'));

  readonly showSearch = computed(() => this.block('search')?.enabled !== false);
  readonly showCheckinInfo = computed(() => this.block('checkin_info')?.enabled !== false);
  readonly checkinText = computed(() => this.text('checkin_info', 'text'));
  readonly subheading = computed(
    () =>
      this.text('search', 'subtitle') ??
      'Elige tus fechas, mira las habitaciones disponibles con su tarifa y su política de cancelación, y reserva en línea.',
  );
  /** Products only when the mode sells (always, with no saved page). */
  readonly showProducts = computed(() => {
    if (this.productIds().length === 0) return false;
    const page = this.page();
    if (!page) return true;
    return modeSells(effectiveMode('booking', page)) && this.block('products')?.enabled !== false;
  });
  readonly productsTitle = computed(() => this.text('products', 'title') ?? 'Para tu estadía');
  readonly heading = computed(() => {
    const custom = this.text('search', 'title');
    if (custom) return custom;
    const name = this.storeName();
    return name ? `Reserva en ${name}` : 'Reserva tu habitación';
  });
}
