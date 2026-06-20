import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  afterNextRender,
  DestroyRef,
} from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { WeeklyReportService } from '../../services/weekly-report.service';
import {
  WeeklyReportSnapshot,
  WeeklySlide,
  WeeklySlideKind,
  WeeklyTier,
  WeeklyTip,
} from '../../interfaces/weekly-report.interface';

interface TierPalette {
  background: string;
  foreground: string;
  accent: string;
  chip: string;
}

const TIER_PALETTE: Record<WeeklyTier, TierPalette> = {
  ZERO: {
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    foreground: '#e2e8f0',
    accent: '#94a3b8',
    chip: 'rgba(148, 163, 184, 0.15)',
  },
  BELOW: {
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    foreground: '#eff6ff',
    accent: '#bfdbfe',
    chip: 'rgba(191, 219, 254, 0.18)',
  },
  ABOVE: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
    foreground: '#fffbeb',
    accent: '#fde68a',
    chip: 'rgba(253, 230, 138, 0.22)',
  },
  STELLAR: {
    background: 'linear-gradient(135deg, #ec4899 0%, #7c3aed 100%)',
    foreground: '#fdf2f8',
    accent: '#fbcfe8',
    chip: 'rgba(251, 207, 232, 0.22)',
  },
};

const TIER_LABEL: Record<WeeklyTier, string> = {
  ZERO: 'Semana en cero',
  BELOW: 'Vas en camino',
  ABOVE: '¡Buena semana!',
  STELLAR: '¡Semana increíble!',
};

/**
 * WeeklyReportStoriesComponent
 *
 * Takeover full-screen tipo stories (Swiper) con 9 slides póster:
 *   1. Cover (tier)
 *   2. Sales (revenue + ticket)
 *   3. Orders (best day)
 *   4. Top product
 *   5. Customers
 *   6. Channels
 *   7. Inventory
 *   8. Tips
 *   9. Closing
 *
 * Al cerrar, emite `viewed` (el padre marca `viewed_at` en backend).
 * Implementado zoneless: usa signals + toSignal, sin zone.js.
 */
@Component({
  selector: 'app-weekly-report-stories',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, IconComponent, CurrencyPipe],
  template: `
    <div
      class="stories-backdrop"
      (click)="onBackdropClick($event)"
    >
    <div
      class="stories-shell"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'Tu semana en Vendix'"
      [style.background]="palette().background"
      [style.color]="palette().foreground"
      (click)="$event.stopPropagation()"
    >
      <!-- progress bar -->
      @if (slides().length > 0) {
        <div class="stories-progress" aria-hidden="true">
          @for (s of slides(); track s.id; let i = $index) {
            <div
              class="stories-progress__bar"
              [class.stories-progress__bar--done]="i < currentIndex()"
              [class.stories-progress__bar--active]="i === currentIndex()"
            ></div>
          }
        </div>
      }

      <!-- close button -->
      <button
        type="button"
        class="stories-close"
        (click)="onClose()"
        aria-label="Cerrar Tu semana en Vendix"
      >
        <app-icon name="close" [size]="22" />
      </button>

      <!-- tier chip -->
      @if (report(); as r) {
        <div class="stories-chip" [style.background]="palette().chip">
          <span class="stories-chip__dot" [style.background]="palette().accent"></span>
          <span class="stories-chip__label">{{ tierLabel() }}</span>
        </div>
      }

      <!-- main content -->
      <div class="stories-body">
        @if (loading() && slides().length === 0) {
          <div class="stories-loading">Cargando tu semana…</div>
        } @else if (currentSlide(); as slide) {
          <article
            class="stories-slide"
            [attr.data-kind]="slide.kind"
            [attr.data-tier]="report()?.tier"
          >
            <header class="stories-slide__header">
              <h2 class="stories-slide__title">{{ slide.title }}</h2>
              @if (slide.subtitle) {
                <p class="stories-slide__subtitle">{{ slide.subtitle }}</p>
              }
            </header>

            <div class="stories-slide__body">
              @switch (slide.kind) {
                @case ('cover') {
                  <div class="cover">
                    <div class="cover__emoji">{{ slide.payload['emoji'] }}</div>
                    <div class="cover__week">
                      {{ report()?.week_start_date }} → {{ report()?.week_end_date }}
                    </div>
                    <p class="cover__message">
                      {{ tierLabel() }}. Aquí está el resumen de tu tienda.
                    </p>
                  </div>
                }
                @case ('sales') {
                  <div class="metric-grid">
                    <div class="metric-grid__item">
                      <div class="metric-grid__label">Ingresos</div>
                      <div class="metric-grid__value metric-grid__value--big">
                        {{ slide.payload?.['total_revenue'] | currency:'$':'symbol-narrow':'1.0-0':'es-CO' }}
                      </div>
                    </div>
                    <div class="metric-grid__item">
                      <div class="metric-grid__label">Órdenes</div>
                      <div class="metric-grid__value">{{ slide.payload?.['total_orders'] }}</div>
                    </div>
                    <div class="metric-grid__item">
                      <div class="metric-grid__label">Ticket promedio</div>
                      <div class="metric-grid__value">
                        {{ slide.payload?.['average_ticket'] | currency:'$':'symbol-narrow':'1.0-0':'es-CO' }}
                      </div>
                    </div>
                  </div>
                }
                @case ('orders') {
                  <div class="orders">
                    @if (slide.payload?.['best_day']) {
                      <div class="orders__best-day">
                        <div class="orders__label">Tu mejor día</div>
                        <div class="orders__date">{{ slide.payload['best_day'].date }}</div>
                        <div class="orders__revenue">
                          {{ slide.payload['best_day'].revenue | currency:'$':'symbol-narrow':'1.0-0':'es-CO' }}
                        </div>
                        <div class="orders__count">
                          {{ slide.payload['best_day'].orders }} órdenes
                        </div>
                      </div>
                    } @else {
                      <p class="orders__empty">Sin órdenes esta semana. ¡La próxima puede ser diferente!</p>
                    }
                  </div>
                }
                @case ('top_product') {
                  <div class="top-product">
                    @if (slide.payload?.['top_product']) {
                      <div class="top-product__name">{{ slide.payload['top_product'].name }}</div>
                      <div class="top-product__units">
                        {{ slide.payload['top_product'].units }} unidades
                      </div>
                      <div class="top-product__revenue">
                        {{ slide.payload['top_product'].revenue | currency:'$':'symbol-narrow':'1.0-0':'es-CO' }}
                      </div>
                    } @else {
                      <p class="top-product__empty">Sin producto destacado esta semana.</p>
                    }
                  </div>
                }
                @case ('customers') {
                  <div class="customers">
                    <div class="customers__big">
                      {{ slide.payload?.['new_customers'] }}
                    </div>
                    <div class="customers__label">clientes nuevos</div>
                  </div>
                }
                @case ('channels') {
                  <ul class="channels">
                    @for (c of slide.payload?.['channels'] ?? []; track c.channel) {
                      <li class="channels__row">
                        <span class="channels__name">{{ c.display_name || c.channel }}</span>
                        <span class="channels__bar">
                          <span
                            class="channels__bar-fill"
                            [style.width.%]="c.percentage"
                            [style.background]="palette().accent"
                          ></span>
                        </span>
                        <span class="channels__pct">{{ c.percentage | number:'1.0-0' }}%</span>
                      </li>
                    }
                    @if ((slide.payload?.['channels'] ?? []).length === 0) {
                      <li class="channels__empty">Sin ventas por canales esta semana.</li>
                    }
                  </ul>
                }
                @case ('inventory') {
                  <div class="inventory">
                    <div class="inventory__row">
                      <span>Órdenes de compra</span>
                      <strong>{{ slide.payload?.['purchase_orders'] }}</strong>
                    </div>
                    <div class="inventory__row">
                      <span>Total comprado</span>
                      <strong>
                        {{ slide.payload['total_spent'] | currency:'$':'symbol-narrow':'1.0-0':'es-CO' }}
                      </strong>
                    </div>
                    <div class="inventory__row">
                      <span>Items recibidos</span>
                      <strong>{{ slide.payload['items_received'] }}</strong>
                    </div>
                  </div>
                }
                @case ('tips') {
                  <ul class="tips">
                    @for (t of (slide.payload['tips'] ?? []); track t.key) {
                      <li class="tips__item">
                        <h4 class="tips__title">{{ t.title }}</h4>
                        <p class="tips__body">{{ t.body }}</p>
                        @if (t.cta) {
                          <a
                            class="tips__cta"
                            [routerLink]="t.cta.route"
                            (click)="onClose()"
                          >
                            {{ t.cta.label }}
                            <app-icon name="chevron-right" [size]="14" />
                          </a>
                        }
                      </li>
                    }
                    @if ((slide.payload['tips'] ?? []).length === 0) {
                      <li class="tips__empty">Sin consejos esta semana.</li>
                    }
                  </ul>
                }
                @case ('closing') {
                  <div class="closing">
                    <div class="closing__emoji">{{ slide.payload?.['emoji'] }}</div>
                    <p>¡Nos vemos la próxima semana!</p>
                    <button
                      type="button"
                      class="closing__btn"
                      (click)="onClose()"
                    >
                      Cerrar
                    </button>
                  </div>
                }
              }
            </div>
          </article>
        } @else {
          <div class="stories-empty">No hay reporte disponible todavía.</div>
        }
      </div>

      <!-- nav controls -->
      @if (slides().length > 1) {
        <div class="stories-nav" aria-hidden="true">
          <button
            type="button"
            class="stories-nav__btn stories-nav__btn--prev"
            (click)="prev()"
            [disabled]="currentIndex() === 0"
            aria-label="Slide anterior"
          >
            <app-icon name="chevron-left" [size]="24" />
          </button>
          <button
            type="button"
            class="stories-nav__btn stories-nav__btn--next"
            (click)="next()"
            [disabled]="currentIndex() === slides().length - 1"
            aria-label="Siguiente slide"
          >
            <app-icon name="chevron-right" [size]="24" />
          </button>
        </div>
        <!-- tap zones for swipe (left/right halves) -->
        <button
          type="button"
          class="stories-tap stories-tap--left"
          (click)="prev()"
          aria-label="Ir al slide anterior"
        ></button>
        <button
          type="button"
          class="stories-tap stories-tap--right"
          (click)="next()"
          aria-label="Ir al siguiente slide"
        ></button>
      }
    </div>
  `,
  styleUrl: './weekly-report-stories.component.css',
})
export class WeeklyReportStoriesComponent {
  private readonly service = inject(WeeklyReportService);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs / outputs
  readonly report = input<WeeklyReportSnapshot | null>(null);
  readonly viewed = output<void>();
  readonly closed = output<void>();

  // Local state
  readonly currentIndex = signal(0);
  readonly localLoading = signal(false);

  readonly slides = computed<WeeklySlide[]>(() => this.report()?.slides ?? []);
  readonly currentSlide = computed<WeeklySlide | null>(() => {
    const list = this.slides();
    const i = this.currentIndex();
    return list[i] ?? null;
  });

  readonly tier = computed<WeeklyTier>(() => this.report()?.tier ?? 'BELOW');
  readonly palette = computed<TierPalette>(() => TIER_PALETTE[this.tier()]);
  readonly tierLabel = computed<string>(() => TIER_LABEL[this.tier()]);
  readonly loading = computed<boolean>(
    () => this.service.loading() || this.localLoading(),
  );

  constructor() {
    // Si llega un report con viewed_at null y el componente se monta,
    // aseguramos el fetch más reciente (para tener tips actualizados).
    afterNextRender(() => {
      this.refreshIfNeeded();
    });
  }

  private refreshIfNeeded(): void {
    if (!this.report() && !this.service.latestReport()) {
      this.localLoading.set(true);
      this.service
        .getLatest()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.localLoading.set(false),
          error: () => this.localLoading.set(false),
        });
    }
  }

  // ─── Navigation ──────────────────────────────────────────────────────────
  next(): void {
    const i = this.currentIndex();
    if (i < this.slides().length - 1) {
      this.currentIndex.set(i + 1);
    }
  }

  prev(): void {
    const i = this.currentIndex();
    if (i > 0) {
      this.currentIndex.set(i - 1);
    }
  }

  // ─── Close / Mark viewed ────────────────────────────────────────────────
  /**
   * Click en el backdrop cierra el modal. La propagación se detiene en
   * `.stories-shell` para que clicks internos no cierren accidentalmente.
   */
  onBackdropClick(_event: MouseEvent): void {
    this.onClose();
  }

  onClose(): void {
    const r = this.report() ?? this.service.latestReport();
    if (r && !r.viewed_at) {
      this.service
        .markViewed(r.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.viewed.emit();
            this.closed.emit();
          },
          error: () => this.closed.emit(),
        });
    } else {
      this.closed.emit();
    }
  }
}
