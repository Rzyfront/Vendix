import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
} from '../../../../shared/components';
import { StoreActivityChartsComponent } from '../../../../shared/components/store-activity-charts/store-activity-charts.component';
import { PlatformCrmService } from './platform-crm.service';
import { CoveredStore, PlatformStoreActivityView } from './platform-crm.interface';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_RANGES = [7, 30, 90] as const;
type ActivityRange = (typeof ACTIVITY_RANGES)[number];
type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'missing';

/** `YYYY-MM-DD` en UTC: la actividad se agrega por día UTC, como en Superadmin. */
function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Últimos `days` días cerrando hoy (UTC). */
export function activityRange(days: number, now = new Date()): { from: string; to: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: utcDay(new Date(today.getTime() - (days - 1) * DAY_MS)), to: utcDay(today) };
}

/**
 * Cuenta Vendix · «Actividad» de cada comercio enlazado (D4): las mismas
 * gráficas que el detalle de Superadmin (`app-store-activity-charts`), con
 * selector de comercio y de rango (7/30/90 días). Solo agregados por día,
 * canal y estado; nunca el timeline con números de orden o correos.
 */
@Component({
  selector: 'app-vendix-account-activity',
  standalone: true,
  imports: [ButtonComponent, SelectorComponent, SpinnerComponent, StoreActivityChartsComponent],
  template: `
    <section class="flex flex-col gap-3" data-testid="vendix-account-activity">
      <div class="flex flex-col gap-0.5">
        <h4 class="text-sm font-semibold text-text-primary">Actividad</h4>
        <p class="text-xs text-text-secondary">Uso de cada comercio en Vendix, por día (UTC).</p>
      </div>

      @if (stores().length === 0) {
        <p class="text-sm text-text-secondary">Sin comercios para mostrar.</p>
      } @else {
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <app-selector
            size="sm"
            [options]="storeOptions()"
            [value]="selectedStoreId()"
            (valueChange)="onStoreChange($event)"
          ></app-selector>
          <app-selector
            size="sm"
            [options]="rangeOptions"
            [value]="range()"
            (valueChange)="onRangeChange($event)"
          ></app-selector>
        </div>

        @if (state() === 'loading' && !view()) {
          <div class="flex justify-center py-4"><app-spinner size="sm"></app-spinner></div>
        } @else if (state() === 'missing') {
          <p class="text-sm text-text-secondary">Este comercio ya no está enlazado a este cliente.</p>
        } @else if (state() === 'error') {
          <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <span>No pudimos cargar la actividad.</span>
            <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
          </div>
        } @else if (view(); as current) {
          <app-store-activity-charts
            [series]="current.series"
            [summary]="current.summary"
            [loading]="state() === 'loading'"
          ></app-store-activity-charts>
        }
      }
    </section>
  `,
})
export class VendixAccountActivityComponent {
  private readonly service = inject(PlatformCrmService);

  readonly customerId = input.required<number>();
  /** Comercios que cubren los enlaces del cliente (los da el historial). */
  readonly stores = input<CoveredStore[]>([]);

  protected readonly rangeOptions: SelectorOption[] = ACTIVITY_RANGES.map((days) => ({
    value: days,
    label: `Últimos ${days} días`,
  }));
  protected readonly state = signal<LoadState>('idle');
  protected readonly view = signal<PlatformStoreActivityView | null>(null);
  protected readonly range = signal<ActivityRange>(30);
  private readonly pickedStoreId = signal<number | null>(null);

  /** El comercio elegido si sigue cubierto; si no, el primero. */
  protected readonly selectedStoreId = computed<number | null>(() => {
    const stores = this.stores();
    const picked = this.pickedStoreId();
    if (picked !== null && stores.some((s) => s.store_id === picked)) return picked;
    return stores[0]?.store_id ?? null;
  });

  protected readonly storeOptions = computed<SelectorOption[]>(() =>
    this.stores().map((store) => ({
      value: store.store_id,
      label: store.store_name,
      description: store.organization_name,
    })),
  );

  private seq = 0;

  constructor() {
    effect(() => {
      const customerId = this.customerId();
      const storeId = this.selectedStoreId();
      const days = this.range();
      untracked(() => void this.load(customerId, storeId, days));
    });
  }

  protected reload(): void {
    void this.load(this.customerId(), this.selectedStoreId(), this.range());
  }

  protected onStoreChange(value: string | number | null): void {
    if (value === null || value === '') return;
    this.pickedStoreId.set(Number(value));
  }

  protected onRangeChange(value: string | number | null): void {
    const days = Number(value) as ActivityRange;
    if ((ACTIVITY_RANGES as readonly number[]).includes(days)) this.range.set(days);
  }

  private async load(customerId: number, storeId: number | null, days: number): Promise<void> {
    const seq = ++this.seq;
    if (storeId === null) {
      this.view.set(null);
      this.state.set('idle');
      return;
    }
    this.state.set('loading');
    try {
      const view = await firstValueFrom(
        this.service.getStoreActivity(customerId, storeId, activityRange(days)),
      );
      if (seq !== this.seq) return;
      this.view.set(view);
      this.state.set('ready');
    } catch (error) {
      if (seq !== this.seq) return;
      this.view.set(null);
      const status = (error as { status?: number } | null)?.status;
      this.state.set(status === 404 ? 'missing' : 'error');
    }
  }
}
