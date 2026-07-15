import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';
import { StoreAvailabilityService } from '../../../core/services/store-availability.service';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

/**
 * Full-screen branded overlay shown on the public storefront
 * (STORE_ECOMMERCE) when the backend reports the store as unavailable.
 *
 * Background: the store's ecommerce slider (first photo with a `url`), read
 * from `domainConfig.customConfig.ecommerce.slider.photos` — the same source
 * the home page uses — with a dark gradient overlay for legibility. When the
 * store has no slider photo, the fallback is a translucent scrim with
 * `backdrop-blur` so the catalog stays visible-but-blurred behind. Foreground:
 * the store logo, a reopening message, and a dismiss CTA. Brand colors come
 * from the CSS variables applied by `ThemeService` (`var(--color-primary)`,
 * `var(--color-primary-rgb)`, ...).
 *
 * Dismiss only hides the overlay (the router-outlet stays mounted behind it),
 * so closing the banner reveals the catalog in read-only mode. The banner
 * reappears on any customer action via `StoreAvailabilityService.reopen()`.
 *
 * Zoneless-safe: pure signal/computed reads, no manual change detection.
 */
@Component({
  selector: 'app-store-unavailable-banner',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  template: `
    <div
      class="fixed inset-0 z-[9999] overflow-y-auto store-unavailable-fade"
      role="dialog"
      aria-modal="true"
      aria-labelledby="store-unavailable-title"
    >
      <!-- Background: store slider photo, or a blurred scrim over the catalog -->
      <div class="absolute inset-0" aria-hidden="true">
        @if (backgroundImage(); as bg) {
          <img
            [src]="bg"
            alt=""
            class="h-full w-full object-cover"
            aria-hidden="true"
          />
          <div
            class="absolute inset-0"
            style="background: linear-gradient(160deg, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0.82) 100%);"
          ></div>
        } @else {
          <!-- No slider photo: blur the storefront behind through a light translucent scrim -->
          <div
            class="h-full w-full backdrop-blur-xl"
            style="background: linear-gradient(160deg, rgba(15, 23, 42, 0.32) 0%, rgba(15, 23, 42, 0.5) 100%);"
          ></div>
        }
      </div>

      <!-- Content card -->
      <div
        class="relative flex min-h-full items-center justify-center p-4 sm:p-6"
      >
        <div
          class="w-full max-w-md rounded-3xl border border-white/15 bg-white/10 px-6 py-9 text-center shadow-2xl backdrop-blur-xl sm:px-9 sm:py-11 store-unavailable-card"
        >
          <!-- Logo / branded fallback -->
          @if (logoUrl(); as logo) {
            <img
              [src]="logo"
              [alt]="storeName()"
              class="mx-auto mb-7 h-16 w-auto max-w-[70%] rounded-xl object-contain drop-shadow"
            />
          } @else {
            <div
              class="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
              style="background: var(--color-primary, #4f46e5);"
            >
              <app-icon name="store" [size]="34" class="text-white" />
            </div>
          }

          <!-- Status badge -->
          <div
            class="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20"
          >
            <app-icon name="clock" [size]="24" class="text-white" />
          </div>

          <h2
            id="store-unavailable-title"
            class="text-2xl font-bold leading-tight text-white sm:text-3xl"
          >
            Tienda temporalmente no disponible
          </h2>

          @if (storeName(); as name) {
            <p class="mt-1 text-sm font-medium uppercase tracking-wide text-white/70">
              {{ name }}
            </p>
          }

          <p class="mt-4 text-base leading-relaxed text-white/85">
            {{ message() }}
          </p>

          <div class="mt-8">
            <app-button
              variant="primary"
              size="lg"
              [fullWidth]="true"
              (clicked)="onDismiss()"
            >
              Entendido, ver tienda
            </app-button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .store-unavailable-fade {
      animation: store-unavailable-fade-in 0.25s ease-out;
    }
    .store-unavailable-card {
      animation: store-unavailable-card-in 0.3s ease-out;
    }
    @keyframes store-unavailable-fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes store-unavailable-card-in {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .store-unavailable-fade,
      .store-unavailable-card {
        animation: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StoreUnavailableBannerComponent {
  private readonly tenantFacade = inject(TenantFacade);
  private readonly availability = inject(StoreAvailabilityService);

  private readonly ecommerce = computed(
    () => this.tenantFacade.domainConfig()?.customConfig?.ecommerce ?? null,
  );

  private readonly branding = computed(
    () => this.tenantFacade.domainConfig()?.customConfig?.branding ?? null,
  );

  /** First slider photo that carries a usable `url` (same source as home). */
  readonly backgroundImage = computed<string | null>(() => {
    const photos = this.ecommerce()?.slider?.photos ?? [];
    return photos.find((p) => !!p?.url)?.url ?? null;
  });

  /** Store logo: ecommerce.inicio → branding → resolved domain logo. */
  readonly logoUrl = computed<string | null>(() => {
    const config = this.tenantFacade.domainConfig();
    return (
      this.ecommerce()?.inicio?.logo_url ??
      this.branding()?.logo_url ??
      config?.store_logo_url ??
      null
    );
  });

  readonly storeName = computed<string>(() => {
    const config = this.tenantFacade.domainConfig();
    return (
      config?.store_name ?? this.branding()?.name ?? config?.organization_name ?? ''
    );
  });

  readonly message = computed<string>(
    () =>
      this.ecommerce()?.general?.unavailable_message?.trim() ||
      'Estamos cerrados por el momento. Vuelve pronto: te esperamos para atenderte.',
  );

  onDismiss(): void {
    this.availability.dismiss();
  }
}
