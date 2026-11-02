import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { TenantFacade } from '../../core/store';
import { StoreHomeService } from './store-home.service';

/** Vendix's own brand, used when neither the store nor its organization has one. */
const VENDIX_LOGO = 'vlogomono.png';
const VENDIX_SITE_FALLBACK = 'https://vendix.online';
const VENDIX_TAGLINE_FALLBACK =
  'El Sistema Operativo Comercial Todo-en-Uno para Latinoamérica.';

/**
 * `/` of the store's `{tienda}-store` domain once the store home is published
 * (Apps · STORE_HOME, Fase 5). An entry page, not a store: the store's brand,
 * one button into the platform and a discreet footer about Vendix. No
 * catalog, cart, products or prices.
 *
 * The button opens `/auth/login`, the same login and `app_type` switch every
 * store domain already uses: the user lands in their own app.
 */
@Component({
  selector: 'app-store-home',
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen flex-col bg-background" data-testid="store-home">
      <main
        class="flex flex-1 items-center justify-center px-4 py-16"
        [style.background]="heroBackground()"
      >
        <section class="w-full max-w-xl text-center">
          <img
            [src]="logo()"
            [alt]="name()"
            class="mx-auto mb-6 h-24 w-24 rounded-2xl bg-white object-contain p-2 shadow-sm"
            data-testid="store-home-logo"
          />
          <h1 class="text-3xl font-bold text-white md:text-4xl" data-testid="store-home-name">
            {{ name() }}
          </h1>
          <a
            routerLink="/auth/login"
            class="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-8 py-3 text-base font-semibold shadow-sm transition hover:shadow-md"
            [style.color]="buttonColor()"
            data-testid="store-home-login"
          >
            Ingresar a la plataforma
          </a>
        </section>
      </main>

      <footer
        class="border-t border-border bg-surface px-4 py-5 text-center text-xs text-text-secondary"
        data-testid="store-home-footer"
      >
        <a
          [href]="siteUrl()"
          target="_blank"
          rel="noopener noreferrer"
          class="font-semibold text-text-primary hover:underline"
        >Vendix</a>
        <span> · {{ footerText() }}</span>
      </footer>
    </div>
  `,
})
export class StoreHomeComponent {
  private readonly tenant = inject(TenantFacade);
  private readonly home = toSignal(inject(StoreHomeService).load(), {
    initialValue: undefined,
  });
  private readonly domainConfig = this.tenant.domainConfig;
  /** Brand the domain resolver already sends (store settings). */
  private readonly domainBrand = computed(
    () => this.domainConfig()?.customConfig?.branding ?? null,
  );

  readonly name = computed(
    () =>
      this.home()?.store_name ||
      this.home()?.branding.name ||
      this.domainConfig()?.store_name ||
      this.domainBrand()?.name ||
      this.domainConfig()?.store_slug ||
      'Tienda',
  );

  readonly logo = computed(
    () =>
      this.home()?.branding.logo_url ||
      this.domainConfig()?.store_logo_url ||
      this.domainBrand()?.logo_url ||
      VENDIX_LOGO,
  );

  private readonly primary = computed(
    () =>
      this.home()?.branding.primary_color ||
      this.domainBrand()?.primary_color ||
      null,
  );

  readonly heroBackground = computed(() => {
    const primary = this.primary() ?? 'var(--color-primary)';
    const secondary = this.home()?.branding.secondary_color;
    return secondary
      ? `linear-gradient(135deg, ${primary}, ${secondary})`
      : primary;
  });

  readonly buttonColor = computed(() => this.primary() ?? 'var(--color-primary)');

  readonly footerText = computed(
    () => this.home()?.footer.text || VENDIX_TAGLINE_FALLBACK,
  );

  readonly siteUrl = computed(
    () => this.home()?.footer.site_url || VENDIX_SITE_FALLBACK,
  );
}
