import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import {
  formatItineraryDate,
  formatPlanDuration,
} from '../../../../../shared/utils/plan-itinerary.util';
import { CatalogService, PublicServicePlan } from '../../services/catalog.service';

/**
 * Ficha pública de un plan de varios días (QUI-1060 F2) dentro del detalle del
 * servicio: duración, eventos próximos con cupos, precio por tamaño de grupo,
 * incluye / no incluye / recomendaciones e itinerario por día. Los planes no se
 * compran en línea (F1): el llamado a la acción es contactar a la tienda.
 */
@Component({
  selector: 'app-plan-public-info',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CurrencyPipe],
  template: `
    @if (plan(); as plan) {
      <section class="plan-info flex flex-col gap-4 my-3" data-testid="plan-public-info">
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-primary">
          <span class="inline-flex items-center gap-1">
            <app-icon name="calendar" [size]="14" />
            {{ duration() }}
          </span>
          @if (groupLabel()) {
            <span class="inline-flex items-center gap-1">
              <app-icon name="users" [size]="14" />
              {{ groupLabel() }}
            </span>
          }
        </div>

        @if (plan.pax_prices.length > 0) {
          <div class="info-section">
            <h4 class="info-label">Precio por tamaño de grupo</h4>
            <ul class="flex flex-col gap-1 text-sm">
              @for (tier of plan.pax_prices; track tier.min_pax) {
                <li class="flex justify-between gap-3 border-b border-border py-1 last:border-b-0">
                  <span class="text-text-secondary">{{ paxRange(tier.min_pax, tier.max_pax) }}</span>
                  <span class="font-semibold text-text-primary">{{ tier.price | currency }}</span>
                </li>
              }
            </ul>
            <p class="mt-1 text-xs text-text-secondary">Precio total del paquete para el grupo.</p>
          </div>
        }

        @if (plan.departure_mode !== 'on_demand') {
          <div class="info-section">
            <h4 class="info-label">Próximos eventos</h4>
            @if (plan.departures.length === 0) {
              <p class="text-sm text-text-secondary">No hay eventos con cupos por ahora.</p>
            } @else {
              <ul class="flex flex-col gap-1 text-sm">
                @for (dep of plan.departures; track dep.departure_date) {
                  <li class="flex flex-wrap justify-between gap-x-3 border-b border-border py-1 last:border-b-0">
                    <span class="text-text-primary">{{ formatDate(dep.departure_date) }}</span>
                    <span class="text-text-secondary">
                      {{ dep.seats_available }} {{ dep.seats_available === 1 ? 'cupo disponible' : 'cupos disponibles' }}
                      @if (dep.price != null) {
                        · {{ dep.price | currency }}
                      }
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        }
        @if (plan.departure_mode !== 'fixed') {
          <p class="text-sm text-text-secondary">También puedes elegir tu propia fecha de inicio.</p>
        }

        @if (plan.includes) {
          <div class="info-section">
            <h4 class="info-label">Incluye</h4>
            <p class="text-sm text-text-primary whitespace-pre-line">{{ plan.includes }}</p>
          </div>
        }
        @if (plan.excludes) {
          <div class="info-section">
            <h4 class="info-label">No incluye</h4>
            <p class="text-sm text-text-primary whitespace-pre-line">{{ plan.excludes }}</p>
          </div>
        }
        @if (plan.recommendations) {
          <div class="info-section">
            <h4 class="info-label">Recomendaciones</h4>
            <p class="text-sm text-text-primary whitespace-pre-line">{{ plan.recommendations }}</p>
          </div>
        }

        @if (plan.itinerary.length > 0) {
          <div class="info-section">
            <h4 class="info-label">Itinerario</h4>
            <ol class="flex flex-col gap-3">
              @for (day of plan.itinerary; track day.day_number) {
                <li>
                  <p class="text-sm font-semibold text-text-primary">Día {{ day.day_number }}</p>
                  <ul class="mt-1 flex flex-col gap-1 border-l-2 border-border pl-3">
                    @for (act of day.activities; track $index) {
                      <li class="text-sm">
                        @if (act.start_time) {
                          <span class="text-text-secondary">{{ act.start_time }} · </span>
                        }
                        <span class="text-text-primary">{{ act.title }}</span>
                        @if (act.description) {
                          <p class="text-xs text-text-secondary whitespace-pre-line">{{ act.description }}</p>
                        }
                      </li>
                    }
                  </ul>
                </li>
              }
            </ol>
          </div>
        }

        <div class="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2" data-testid="plan-contact">
          <p class="text-sm text-text-primary">
            Este plan se reserva directamente con {{ storeName() || 'la tienda' }}. Escríbenos para separar tu cupo.
          </p>
          @if (whatsappUrl(); as url) {
            <a
              [href]="url"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              <app-icon name="message-circle" [size]="16" />
              Consultar por WhatsApp
            </a>
          } @else if (supportEmail(); as email) {
            <a
              [href]="'mailto:' + email + '?subject=' + mailSubject()"
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              <app-icon name="mail" [size]="16" />
              Escribir a {{ email }}
            </a>
          }
        </div>
      </section>
    }
  `,
})
export class PlanPublicInfoComponent {
  private readonly catalog = inject(CatalogService);
  private readonly tenant = inject(TenantFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly productId = input.required<number>();
  readonly productName = input('');

  readonly plan = signal<PublicServicePlan | null>(null);
  readonly supportEmail = signal<string | null>(null);

  readonly storeName = computed(() => this.tenant.domainConfig()?.store_name ?? '');
  readonly duration = computed(() => {
    const p = this.plan();
    return p ? formatPlanDuration(p.duration_days, p.duration_nights) : '';
  });
  readonly groupLabel = computed(() => {
    const p = this.plan();
    if (!p || (p.min_pax == null && p.max_pax == null)) return '';
    if (p.min_pax != null && p.max_pax != null) return `Grupos de ${p.min_pax} a ${p.max_pax} personas`;
    return p.min_pax != null ? `Grupos desde ${p.min_pax} personas` : `Grupos hasta ${p.max_pax} personas`;
  });

  private readonly message = computed(
    () => `Hola, quiero información del plan «${this.productName()}».`,
  );
  readonly mailSubject = computed(() => encodeURIComponent(`Plan ${this.productName()}`));
  readonly whatsappUrl = computed(() => {
    const phone = (
      this.tenant.domainConfig()?.customConfig?.ecommerce?.checkout?.whatsapp_number || ''
    ).replace(/\D/g, '');
    return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(this.message())}` : null;
  });

  constructor() {
    effect(() => {
      const id = this.productId();
      untracked(() => this.load(id));
    });
  }

  paxRange(min: number, max: number): string {
    return min === max
      ? `${min} ${min === 1 ? 'persona' : 'personas'}`
      : `${min} a ${max} personas`;
  }

  formatDate(date: string): string {
    return formatItineraryDate(date);
  }

  private load(id: number): void {
    this.catalog
      .getServicePlan(id)
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((plan) => {
        this.plan.set(plan);
        if (plan && !this.whatsappUrl()) this.loadSupportEmail();
      });
  }

  /** Sin WhatsApp: el correo de soporte que la tienda publica en su pie de página. */
  private loadSupportEmail(): void {
    this.catalog
      .getPublicConfig()
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        const email = res?.data?.ecommerce?.footer?.store_info?.support_email;
        this.supportEmail.set(typeof email === 'string' && email.trim() ? email.trim() : null);
      });
  }
}
