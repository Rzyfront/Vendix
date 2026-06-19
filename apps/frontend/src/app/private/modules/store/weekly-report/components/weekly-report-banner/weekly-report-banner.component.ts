import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  output,
  effect,
  DestroyRef,
  HostListener,
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

const DISMISS_KEY_PREFIX = 'vendix:weekly-report:dismissed';

/**
 * Banner compacto, reabrible. Se muestra sólo si hay un reporte y el
 * usuario no lo ha descartado para esa semana.
 *
 * Acciones disponibles en el banner:
 *   - Click en el área principal → emite `openTakeover` (padre abre modal)
 *   - Botón X (cerrar) → oculta el banner durante esta sesión
 *   - Menú "No ver más esta semana" → persiste descarte en localStorage
 *     con clave por (storeId, weekStartDate), así el descarte se
 *     "autorenueva" cada domingo cuando cambia la semana cerrada.
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
    @if (showBanner() && report(); as r) {
      <div
        class="wr-banner"
        role="region"
        [attr.aria-label]="'Resumen semanal: ' + bannerCopy().label"
      >
        <button
          type="button"
          class="wr-banner__open"
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
          <span class="wr-banner__chev" aria-hidden="true">
            <app-icon name="chevron-right" [size]="16" />
          </span>
        </button>

        <div class="wr-banner__menu">
          <button
            type="button"
            class="wr-banner__menu-btn"
            (click)="toggleMenu($event)"
            [attr.aria-expanded]="menuOpen()"
            aria-haspopup="true"
            aria-label="Más opciones del resumen semanal"
          >
            <app-icon name="more-horizontal" [size]="18" />
          </button>
          @if (menuOpen()) {
            <div class="wr-banner__menu-panel" role="menu">
              <button
                type="button"
                class="wr-banner__menu-item"
                role="menuitem"
                (click)="onDismissSession()"
              >
                <app-icon name="x-circle" [size]="14" />
                <span>Cerrar</span>
              </button>
              <button
                type="button"
                class="wr-banner__menu-item"
                role="menuitem"
                (click)="onDismissWeek()"
              >
                <app-icon name="eye-off" [size]="14" />
                <span>No ver más esta semana</span>
              </button>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }

      .wr-banner {
        display: flex;
        align-items: stretch;
        width: 100%;
        min-height: 3.25rem;
        background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%);
        color: #831843;
        border-bottom: 1px solid #fbcfe8;
        position: relative;
      }

      .wr-banner__open {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
        padding: 0.65rem 0.5rem 0.65rem 1rem;
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        text-align: left;
        font: inherit;
        transition: background 0.2s ease;
      }
      .wr-banner__open:hover {
        background: rgba(236, 72, 153, 0.08);
      }
      .wr-banner__open:focus-visible {
        outline: 2px solid #ec4899;
        outline-offset: -2px;
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

      .wr-banner__chev {
        color: #be185d;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
      }

      .wr-banner__menu {
        flex: 0 0 auto;
        position: relative;
        display: flex;
        align-items: center;
        padding-right: 0.5rem;
      }

      .wr-banner__menu-btn {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        background: transparent;
        border: none;
        color: #be185d;
        cursor: pointer;
        border-radius: 999px;
        transition: background 0.15s ease;
      }
      .wr-banner__menu-btn:hover {
        background: rgba(236, 72, 153, 0.15);
      }
      .wr-banner__menu-btn:focus-visible {
        outline: 2px solid #ec4899;
        outline-offset: 1px;
      }

      .wr-banner__menu-panel {
        position: absolute;
        top: calc(100% + 0.25rem);
        right: 0;
        z-index: 50;
        min-width: 14rem;
        background: #ffffff;
        border: 1px solid #f3e8ff;
        border-radius: 0.6rem;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
        padding: 0.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
      }

      .wr-banner__menu-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.5rem 0.7rem;
        background: transparent;
        border: none;
        color: #1f2937;
        font: inherit;
        font-size: 0.86rem;
        text-align: left;
        border-radius: 0.4rem;
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .wr-banner__menu-item:hover {
        background: #f3f4f6;
      }
      .wr-banner__menu-item:focus-visible {
        outline: 2px solid #ec4899;
        outline-offset: -1px;
      }
    `,
  ],
})
export class WeeklyReportBannerComponent {
  private readonly service = inject(WeeklyReportService);
  private readonly destroyRef = inject(DestroyRef);

  // Dismiss state
  private readonly _sessionDismissed = signal<boolean>(false);
  readonly menuOpen = signal<boolean>(false);

  // Outputs
  readonly openTakeover = output<WeeklyReportSnapshot>();
  readonly dismissed = output<'session' | 'week'>();

  // Exposed state
  readonly report = this.service.latestReport;
  readonly loading = this.service.loading;
  readonly hasUnviewed = this.service.hasUnviewedReport;
  readonly hasReport = this.service.hasReport;

  /**
   * Mostrar el banner sólo si:
   *   - hay reporte cargado,
   *   - el reporte no está marcado como "visto" en backend (viewed_at null)
   *     — si ya fue visto, no insistimos con el banner persistente
   *   - el usuario no lo ha cerrado en esta sesión
   *   - el usuario no lo descartó para esta semana
   */
  readonly isWeekDismissed = computed<boolean>(() => {
    const r = this.report();
    if (!r) return false;
    return this.readWeekDismissed(r.store_id, r.week_start_date);
  });

  readonly showBanner = computed<boolean>(
    () =>
      this.hasReport() &&
      this.hasUnviewed() &&
      !this._sessionDismissed() &&
      !this.isWeekDismissed(),
  );

  readonly bannerCopy = computed(() => {
    const r = this.report();
    const tier: WeeklyTier = r?.tier ?? 'BELOW';
    return TIER_BANNER[tier];
  });

  // Cerrar el menú al hacer click fuera del banner
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target && !target.closest('.wr-banner__menu')) {
      this.menuOpen.set(false);
    }
  }

  onOpen(): void {
    this.menuOpen.set(false);
    const r = this.report();
    if (r) {
      this.openTakeover.emit(r);
    }
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update((v) => !v);
  }

  /** Cierra el banner sólo durante esta sesión (no persiste). */
  onDismissSession(): void {
    this.menuOpen.set(false);
    this._sessionDismissed.set(true);
    this.dismissed.emit('session');
  }

  /**
   * Cierra el banner para esta semana (persiste en localStorage). El
   * descarte se "autorenueva" cada domingo cuando cambia la semana
   * cerrada (`week_start_date`), porque la clave incluye la fecha.
   */
  onDismissWeek(): void {
    this.menuOpen.set(false);
    const r = this.report();
    if (!r) return;
    this.writeWeekDismissed(r.store_id, r.week_start_date);
    this._sessionDismissed.set(true);
    this.dismissed.emit('week');
  }

  // ─── localStorage helpers (zoneless-safe) ──────────────────────────────
  private dismissKey(storeId: number, weekStart: string): string {
    return `${DISMISS_KEY_PREFIX}:${storeId}:${weekStart}`;
  }

  private readWeekDismissed(storeId: number, weekStart: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(this.dismissKey(storeId, weekStart)) === '1';
    } catch {
      return false;
    }
  }

  private writeWeekDismissed(storeId: number, weekStart: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.dismissKey(storeId, weekStart), '1');
    } catch {
      // ignore quota / privacy errors
    }
  }
}
