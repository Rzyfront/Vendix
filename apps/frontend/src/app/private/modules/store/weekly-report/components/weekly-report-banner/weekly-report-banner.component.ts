import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  output,
  effect,
  DestroyRef,
  afterNextRender,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { WeeklyReportService } from '../../services/weekly-report.service';
import { WeeklyReportSnapshot, WeeklyTier } from '../../interfaces/weekly-report.interface';

const TIER_BANNER: Record<WeeklyTier, { icon: string; label: string }> = {
  ZERO: { icon: 'sparkles', label: 'Tu semana te espera' },
  BELOW: { icon: 'chart-line', label: 'Resumen semanal' },
  ABOVE: { icon: 'flame', label: '¡Buena semana!' },
  STELLAR: { icon: 'trophy', label: '¡Semana increíble!' },
};

/**
 * WeeklyReportBannerComponent
 *
 * Banner compacto, reabrible. Si el último reporte NO ha sido visto, se
 * muestra automáticamente como takeover (delegado al padre). Si YA fue
 * visto, se muestra como un banner discreto que al hacer click reabre
 * el takeover.
 *
 * Pensado para inyectarse en `store-admin-layout` antes del router-outlet,
 * solo cuando el contexto es STORE_ADMIN (currentStoreId presente).
 */
@Component({
  selector: 'app-weekly-report-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    @if (showTakeover() && report(); as r) {
      <ng-content select="[slot=takeover]"></ng-content>
    } @else if (showBanner() && report(); as r) {
      <button
        type="button"
        class="wr-banner"
        (click)="onOpen()"
        [attr.aria-label]="'Abrir resumen semanal: ' + bannerCopy().label"
      >
        <span class="wr-banner__icon" aria-hidden="true">
          <app-icon [name]="bannerCopy().icon" [size]="18" />
        </span>
        <span class="wr-banner__text">
          <span class="wr-banner__title">Tu semana en Vendix</span>
          <span class="wr-banner__detail">{{ bannerCopy().label }}</span>
        </span>
        <span class="wr-banner__cta" aria-hidden="true">
          <app-icon name="chevron-right" [size]="16" />
        </span>
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .wr-banner {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        min-height: 3.25rem;
        padding: 0.65rem 1rem;
        border: none;
        background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%);
        color: #831843;
        cursor: pointer;
        text-align: left;
        font: inherit;
        border-bottom: 1px solid #fbcfe8;
        transition: background 0.2s ease;
      }
      .wr-banner:hover {
        background: linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%);
      }

      .wr-banner__icon {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.5rem;
        background: #ec4899;
        color: #fff;
        flex: 0 0 auto;
      }

      .wr-banner__text {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        flex: 1 1 auto;
        min-width: 0;
      }
      .wr-banner__title {
        font-size: 0.9rem;
        font-weight: 700;
      }
      .wr-banner__detail {
        font-size: 0.8rem;
        opacity: 0.85;
      }

      .wr-banner__cta {
        color: #be185d;
        flex: 0 0 auto;
      }
    `,
  ],
})
export class WeeklyReportBannerComponent {
  private readonly service = inject(WeeklyReportService);
  private readonly destroyRef = inject(DestroyRef);

  // Override: si el padre quiere forzar el modo takeover (e.g. al montar
  // y el reporte no está visto), puede pasar un input. Por ahora usamos
  // un signal interno basado en viewed_at.
  private readonly _forceTakeover = signal(false);

  // Outputs
  readonly openTakeover = output<WeeklyReportSnapshot>();

  // Exposed state for parent
  readonly report = this.service.latestReport;
  readonly loading = this.service.loading;

  readonly hasUnviewed = this.service.hasUnviewedReport;
  readonly hasReport = this.service.hasReport;

  readonly showTakeover = computed<boolean>(
    () => (this._forceTakeover() || this.hasUnviewed()) && this.hasReport(),
  );
  readonly showBanner = computed<boolean>(
    () => this.hasReport() && !this.showTakeover(),
  );

  readonly bannerCopy = computed(() => {
    const r = this.report();
    const tier: WeeklyTier = r?.tier ?? 'BELOW';
    return TIER_BANNER[tier];
  });

  constructor() {
    // Carga inicial diferida para no golpear el endpoint antes de tiempo.
    afterNextRender(() => {
      if (!this.service.latestReport()) {
        this.service
          .getLatest()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();
      }
    });
  }

  onOpen(): void {
    const r = this.report();
    if (r) {
      this.openTakeover.emit(r);
    }
  }
}
