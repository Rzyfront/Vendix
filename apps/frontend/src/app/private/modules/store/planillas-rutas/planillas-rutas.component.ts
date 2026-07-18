import {
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from './services/planillas-rutas.service';
import { PlanillasListComponent } from './components/planillas-list/planillas-list.component';
import { PlanillaMonitorComponent } from './components/planilla-monitor/planilla-monitor.component';
import { PlanillaStatsComponent } from './components/planilla-stats/planilla-stats.component';
import { PlanillaWizardComponent } from './components/planilla-wizard/planilla-wizard.component';
import { ShippingMethodsService } from '../settings/shipping/services/shipping-methods.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DispatchRoute, DispatchRouteStats } from './interfaces/planilla.interface';

@Component({
  selector: 'app-planillas-rutas',
  standalone: true,
  imports: [
    PlanillasListComponent,
    PlanillaMonitorComponent,
    PlanillaStatsComponent,
    PlanillaWizardComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop. Only on the Lista tab —
           the Monitor tab has its own margin table and does not reuse these KPIs. -->
      @if (activeTab() === 'lista') {
        <div
          class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
        >
          <app-planilla-stats
            [stats]="stats()"
            [loading]="statsLoading()"
          ></app-planilla-stats>
        </div>
      }

      <!-- Tab switcher: Lista (default) | Monitor -->
      <div
        class="flex items-center gap-2 px-2 pb-2 pt-1 md:px-0 md:pt-0 md:mb-3"
        role="tablist"
        aria-label="Vistas de planillas"
      >
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="activeTab() === 'lista'"
          [class]="tabClass('lista')"
          (click)="setTab('lista')"
        >
          Lista
        </button>
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="activeTab() === 'monitor'"
          [class]="tabClass('monitor')"
          (click)="setTab('monitor')"
        >
          Monitor
        </button>
      </div>

      <!-- Active tab content -->
      @if (activeTab() === 'lista') {
        <app-planillas-list
          (viewDetail)="onViewDetail($event)"
          (create)="openCreateModal()"
          (refresh)="refresh()"
        ></app-planillas-list>
      } @else {
        <app-planilla-monitor></app-planilla-monitor>
      }
    </div>

    @if (showWizard()) {
      <app-planilla-wizard
        [prefillNote]="prefillNote()"
        [prefillShippingMethodId]="prefillShippingMethodId()"
        [prefillVehicleId]="prefillVehicleId()"
        [prefillDriverUserId]="prefillDriverUserId()"
        [prefillCarrierSupplierId]="prefillCarrierSupplierId()"
        (close)="closeWizard()"
        (created)="onCreated($event)"
      ></app-planilla-wizard>
    }
  `,
})
export class PlanillasRutasComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly shippingService = inject(ShippingMethodsService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly planillasList = viewChild<PlanillasListComponent>(PlanillasListComponent);

  /** Active sub-view: 'lista' (default) shows the routes list + stats + wizard;
   * 'monitor' shows the shipping mini-P&L table. */
  readonly activeTab = signal<'lista' | 'monitor'>('lista');

  readonly stats = signal<DispatchRouteStats | null>(null);
  readonly statsLoading = signal(false);
  readonly showWizard = signal(false);
  // Prefill context passed to the wizard when arriving from a shipping method
  readonly prefillNote = signal<string | null>(null);
  // Plan Despacho Economía — FASE 3 paso 12: prefill estructurado (no
  // cosmético) desde la política efectiva del método.
  readonly prefillShippingMethodId = signal<number | null>(null);
  readonly prefillVehicleId = signal<number | null>(null);
  readonly prefillDriverUserId = signal<number | null>(null);
  readonly prefillCarrierSupplierId = signal<number | null>(null);

  ngOnInit() {
    this.refreshStats();
    this.handlePrefillFromQueryParams();
  }

  /**
   * Atajo método de envío → planilla. Si llega `prefill=1` con
   * `shipping_method_id`, abre el wizard de creación automáticamente y precarga
   * el contexto del método (nota + vehículo/ejecutor derivados de la política).
   * El flujo normal (sin queryParams) no se ve afectado: el wizard se sigue
   * abriendo manualmente con "Crear planilla".
   */
  private handlePrefillFromQueryParams(): void {
    const params = this.activatedRoute.snapshot.queryParamMap;
    // Open the wizard either from the shipping-method shortcut (`prefill=1`) or
    // from the "crear ruta nueva desde una remisión" flow (`prefillNotes` = ids
    // de dispatch_note separados por coma). El wizard mismo lee `prefillNotes`
    // vía ActivatedRoute y precarga las paradas; aquí solo garantizamos que se
    // abra. Sin ninguno de los dos, el flujo normal (apertura manual) no cambia.
    const hasPrefillFlag = params.get('prefill') === '1';
    const hasPrefillNotes = !!params.get('prefillNotes');
    if (!hasPrefillFlag && !hasPrefillNotes) return;

    const methodIdRaw = params.get('shipping_method_id');
    const methodId = methodIdRaw ? Number(methodIdRaw) : NaN;

    // Open the create wizard regardless; enrich with method context if available.
    this.showWizard.set(true);

    if (!methodId || Number.isNaN(methodId)) return;

    // Plan Despacho Economía — FASE 3 paso 12.
    // Resolvemos la política efectiva (método + defaults de tienda) y
    // preseleccionamos el ejecutor por defecto en el wizard.
    this.shippingService
      .getEffectivePolicy(methodId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policy) => {
          this.prefillShippingMethodId.set(policy.method_id);
          if (policy.default_vehicle_id) {
            this.prefillVehicleId.set(policy.default_vehicle_id);
          }
          if (policy.default_driver_user_id) {
            this.prefillDriverUserId.set(policy.default_driver_user_id);
          }
          if (policy.default_carrier_supplier_id) {
            this.prefillCarrierSupplierId.set(
              policy.default_carrier_supplier_id,
            );
          }
          this.prefillNote.set(
            `Despacho del método de envío #${policy.method_id} (tipo ${policy.method_type}).`,
          );
        },
        // Si falla, el wizard ya está abierto en modo manual.
        error: () => {},
      });
  }

  /** Switches the active sub-view between the routes list and the P&L monitor. */
  setTab(tab: 'lista' | 'monitor'): void {
    this.activeTab.set(tab);
  }

  /** Tailwind classes for a tab pill, derived reactively from `activeTab()`. */
  tabClass(tab: 'lista' | 'monitor'): string {
    const base =
      'px-4 py-1.5 rounded-full text-sm font-medium transition-colors';
    return this.activeTab() === tab
      ? `${base} bg-primary text-white`
      : `${base} bg-background text-text-secondary border border-border hover:text-text-primary`;
  }

  refresh() {
    this.service.invalidateStatsCache();
    this.refreshStats();
    this.planillasList()?.load();
  }

  refreshStats() {
    this.statsLoading.set(true);
    this.service
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.stats.set(s);
          this.statsLoading.set(false);
        },
        error: () => this.statsLoading.set(false),
      });
  }

  onViewDetail(route: DispatchRoute) {
    this.router.navigate(['/admin/orders/planillas', route.id]);
  }

  openCreateModal() {
    this.showWizard.set(true);
  }

  closeWizard() {
    this.showWizard.set(false);
    this.clearPrefill();
  }

  onCreated(route: DispatchRoute) {
    this.showWizard.set(false);
    this.clearPrefill();
    this.toast.success(`Planilla ${route.route_number} creada`);
    this.refresh();
  }

  /** Limpia la nota precargada y los queryParams del atajo para evitar re-abrir. */
  private clearPrefill() {
    this.prefillNote.set(null);
    const qp = this.activatedRoute.snapshot.queryParamMap;
    if (qp.has('prefill') || qp.has('prefillNotes')) {
      this.router.navigate([], {
        relativeTo: this.activatedRoute,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }
}
