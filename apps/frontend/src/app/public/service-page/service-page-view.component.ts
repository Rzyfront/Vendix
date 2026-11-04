import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  AppPageDocument,
  effectiveMode,
  modeSells,
} from '../../private/modules/store/apps/templates/app-page.types';
import { IconComponent } from '../../shared/components/icon/icon.component';

/**
 * The frame of a service page as it is drawn (F6-B): the store's brand, a link
 * back to the services, the cart link and the footer, around the projected
 * content. The public layout (`ServicePageLayoutComponent`) projects the router
 * outlet; the editor's preview projects the draft of the service list.
 */
@Component({
  selector: 'app-service-page-view',
  standalone: true,
  imports: [RouterModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex min-h-screen flex-col bg-background">
      <header class="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <a [routerLink]="homeLink()" class="flex min-w-0 items-center gap-3">
            @if (headerLogo()) {
              <img [src]="headerLogo()" [alt]="storeName()" class="h-9 w-auto max-w-[8rem] object-contain" />
            }
            <span class="truncate text-base font-semibold text-text-primary">{{ storeName() }}</span>
          </a>
          <nav class="flex items-center gap-1">
            <a
              [routerLink]="homeLink()"
              class="hidden rounded-full px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-secondary sm:inline-flex"
            >
              Servicios
            </a>
            @if (showCartLink()) {
              <a
                routerLink="/cart"
                class="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-text-primary hover:bg-surface-secondary"
                [attr.aria-label]="'Carrito, ' + cartCount() + ' producto(s)'"
              >
                <app-icon name="shopping-cart" [size]="22" />
                @if (cartCount() > 0) {
                  <span
                    class="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-primary px-1 text-center text-xs font-semibold leading-5 text-white"
                  >
                    {{ cartCount() }}
                  </span>
                }
              </a>
            }
          </nav>
        </div>
      </header>

      <main class="flex-1">
        <ng-content />
      </main>

      <footer class="border-t border-border py-6 text-center text-xs text-text-secondary">
        {{ storeName() }} · Hecho con Vendix
      </footer>
    </div>
  `,
})
export class ServicePageViewComponent {
  /** The owner's own page; `null` keeps the frame exactly as it was. */
  readonly page = input<AppPageDocument | null>(null);
  readonly storeName = input('Tienda');
  /** The store's logo; the page's own logo (`page.brand.logo_url`) wins. */
  readonly storeLogo = input<string | null>(null);
  readonly homeLink = input<string | unknown[]>('/');
  readonly cartCount = input(0);

  readonly headerLogo = computed(() => this.page()?.brand?.logo_url || this.storeLogo());
  /** Cart link only when the page sells (always, with no saved page). */
  readonly showCartLink = computed(() => {
    const page = this.page();
    return !page || (modeSells(effectiveMode('service_page', page)) && page.sales?.show_cart !== false);
  });
}
