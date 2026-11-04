import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AppPageViewComponent } from '../app-page/app-page-view.component';
import type { StoreHomePublic } from './store-home.service';

/** Vendix's own brand, used when neither the store nor its organization has one. */
const VENDIX_LOGO = 'vlogomono.png';
const VENDIX_SITE_FALLBACK = 'https://vendix.online';
const VENDIX_TAGLINE_FALLBACK =
  'El Sistema Operativo Comercial Todo-en-Uno para Latinoamérica.';

/** Brand the domain resolver already knows, used when the read brings none. */
export interface StoreHomeDomainFallback {
  name: string | null;
  slug: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}

/**
 * The store home as it is drawn (F6-B): the brand, the entry button, the
 * owner's page and the links to the published apps. The public page
 * (`StoreHomeComponent`) feeds it the public read; the editor's preview feeds
 * it the draft and the same data, so both paint the same page.
 *
 * An entry page, not a store: no catalog, cart, products or prices. The
 * button opens `/auth/login`, the same login and `app_type` switch every
 * store domain already uses.
 */
@Component({
  selector: 'app-store-home-view',
  standalone: true,
  imports: [RouterModule, AppPageViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `

    <div class="flex min-h-screen flex-col bg-background" data-testid="store-home">
      @if (page() && hasPageHero()) {
        <main class="flex-1">
          <app-app-page-view kind="store_home" [page]="page()" part="hero" [blockIds]="blockIds()" />
          <section
            id="app-page-main"
            class="flex flex-col items-center gap-3 px-4 py-8 text-center"
            data-testid="store-home-entry"
          >
            <a
              routerLink="/auth/login"
              class="inline-flex min-h-12 items-center justify-center rounded-xl px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:shadow-md"
              [style.background]="buttonColor()"
              data-testid="store-home-login"
            >
              Ingresar a la plataforma
            </a>
          </section>
          @if (showApps()) {
            <section class="mx-auto w-full max-w-6xl px-4 pb-8" data-testid="store-home-apps" [attr.data-block-id]="blockIds() ? appsBlockId() : null">
              @if (appsTitle()) {
                <h2 class="text-xl font-bold text-text-primary md:text-2xl">{{ appsTitle() }}</h2>
              }
              @if (appsSubtitle()) {
                <p class="mt-1 text-sm text-text-secondary">{{ appsSubtitle() }}</p>
              }
              <ul class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                @for (app of apps(); track app.url) {
                  <li>
                    <a
                      [href]="app.url"
                      class="block rounded-2xl border border-border bg-surface p-5 text-base font-semibold text-text-primary transition hover:shadow-sm"
                    >
                      {{ app.name }}
                    </a>
                  </li>
                }
              </ul>
            </section>
          }
          <app-app-page-view kind="store_home" [page]="page()" part="blocks" [blockIds]="blockIds()" />
        </main>
      } @else {
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
      @if (page()) {
        @if (showApps()) {
          <section class="mx-auto w-full max-w-6xl px-4 py-8" data-testid="store-home-apps" [attr.data-block-id]="blockIds() ? appsBlockId() : null">
            @if (appsTitle()) {
              <h2 class="text-xl font-bold text-text-primary md:text-2xl">{{ appsTitle() }}</h2>
            }
            @if (appsSubtitle()) {
              <p class="mt-1 text-sm text-text-secondary">{{ appsSubtitle() }}</p>
            }
            <ul class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              @for (app of apps(); track app.url) {
                <li>
                  <a
                    [href]="app.url"
                    class="block rounded-2xl border border-border bg-surface p-5 text-base font-semibold text-text-primary transition hover:shadow-sm"
                  >
                    {{ app.name }}
                  </a>
                </li>
              }
            </ul>
          </section>
        }
        <app-app-page-view kind="store_home" [page]="page()" part="blocks" [blockIds]="blockIds()" />
      }
      }

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
export class StoreHomeViewComponent {
  /** The public read (or the preview's equivalent); `null` when it failed, `undefined` while it loads. */
  readonly home = input<StoreHomePublic | null | undefined>(undefined);
  readonly fallback = input<StoreHomeDomainFallback | null>(null);
  /** Editor preview: marks the hero, the apps and each section with `data-block-id`. */
  readonly blockIds = input(false);

  readonly name = computed(
    () =>
      this.home()?.store_name ||
      this.home()?.branding.name ||
      this.fallback()?.name ||
      this.fallback()?.slug ||
      'Tienda',
  );

  readonly logo = computed(
    () => this.home()?.branding.logo_url || this.fallback()?.logoUrl || VENDIX_LOGO,
  );

  /** The owner's own page; `null` keeps the home exactly as it was (apps-f2 S5). */
  readonly page = computed(() => this.home()?.page ?? null);
  readonly hasPageHero = computed(() => {
    const h = this.page()?.hero;
    return !!h && !!(h.title || h.subtitle || h.eyebrow || h.image_url);
  });
  private readonly appsBlock = computed(
    () => this.page()?.blocks.find((b) => b.type === 'apps') ?? null,
  );
  readonly appsBlockId = computed(() => this.appsBlock()?.id ?? null);
  readonly apps = computed(() => this.home()?.apps ?? []);
  readonly showApps = computed(() => this.apps().length > 0 && this.appsBlock()?.enabled !== false);
  readonly appsTitle = computed(() => this.blockText(this.appsBlock()?.props['title']));
  readonly appsSubtitle = computed(() => this.blockText(this.appsBlock()?.props['subtitle']));

  private blockText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readonly primary = computed(
    () =>
      this.page()?.brand?.primary_color ||
      this.home()?.branding.primary_color ||
      this.fallback()?.primaryColor ||
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
