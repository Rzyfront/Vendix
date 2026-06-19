import {
  Component,
  DestroyRef,
  EffectRef,
  Input,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StopSettleModalComponent } from '../../components/stop-settle-modal/stop-settle-modal.component';
import { StopReleaseModalComponent } from '../../components/stop-release-modal/stop-release-modal.component';
import { PlanillaCloseModalComponent } from '../../components/planilla-close-modal/planilla-close-modal.component';
import { PlanillaPdfViewerComponent } from '../../components/planilla-pdf-viewer/planilla-pdf-viewer.component';
import {
  DispatchRoute,
  DispatchRouteStop,
  SettleStopDto,
} from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-planilla-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    StopSettleModalComponent,
    StopReleaseModalComponent,
    PlanillaCloseModalComponent,
    PlanillaPdfViewerComponent,
  ],
  template: `
    <div class="w-full p-3 md:p-4 space-y-4">
      @if (loading()) {
        <div class="text-center py-8">Cargando...</div>
      } @else if (route(); as r) {
        <!-- Header -->
        <div class="rounded-lg border border-border bg-card p-4">
          <div class="flex justify-between items-start gap-2 flex-wrap">
            <div>
              <h1 class="text-xl font-bold">{{ r.route_number }}</h1>
              @if (r.route_code) {
                <div class="text-sm text-muted-foreground">Ruta {{ r.route_code }}</div>
              }
              <div class="text-xs text-muted-foreground mt-1">
                {{ r.planned_date | date: 'dd MMM yyyy, HH:mm' }}
              </div>
            </div>
            <span
              class="text-xs px-3 py-1 rounded-full"
              [ngClass]="statusClass(r.status)"
            >{{ statusLabel(r.status) }}</span>
          </div>

          <div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div class="text-xs text-muted-foreground">Conductor</div>
              <div class="font-medium">
                @if (r.driver_user) {
                  {{ r.driver_user.first_name }} {{ r.driver_user.last_name }}
                } @else if (r.external_driver_name) {
                  {{ r.external_driver_name }} <span class="text-xs">(ext.)</span>
                } @else {
                  —
                }
              </div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Vehículo</div>
              <div class="font-medium">{{ r.vehicle?.plate || '—' }}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Total a recaudar</div>
              <div class="font-bold text-lg">
                {{ r.total_to_collect | currency: 'COP' : 'symbol' : '1.0-0' }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Recaudado</div>
              <div class="font-bold text-lg text-green-600">
                {{ r.total_collected | currency: 'COP' : 'symbol' : '1.0-0' }}
              </div>
            </div>
          </div>

          @if (r.status === 'closed' && r.cash_variance != null) {
            <div class="mt-3 p-2 rounded-md"
                 [ngClass]="varianceClass()">
              <strong>Diferencia de caja:</strong>
              {{ r.cash_variance | currency: 'COP' : 'symbol' : '1.0-0' }}
              @if (r.cash_variance === 0) { (CUADRA) }
              @else if (+r.cash_variance! > 0) { (SOBRA) }
              @else { (FALTA) }
            </div>
          }

          <!-- Action bar -->
          <div class="mt-4 flex gap-2 flex-wrap">
            @if (r.status === 'draft') {
              <button
                (click)="dispatch()"
                [disabled]="actionLoading()"
                class="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
              >Despachar</button>
            }
            @if (['dispatched','in_transit','settling'].includes(r.status)) {
              <button
                (click)="openClose()"
                [disabled]="actionLoading()"
                class="rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium"
              >Cerrar y cuadrar</button>
            }
            @if (r.status !== 'closed' && r.status !== 'voided') {
              <button
                (click)="openVoid()"
                [disabled]="actionLoading()"
                class="rounded-md border border-red-500 text-red-500 px-4 py-2 text-sm"
              >Anular</button>
            }
            <button
              (click)="print()"
              [disabled]="actionLoading()"
              class="rounded-md border border-input bg-background px-4 py-2 text-sm"
            >Imprimir PDF</button>
            <button
              (click)="back()"
              class="rounded-md border border-input bg-background px-4 py-2 text-sm ml-auto"
            >← Volver</button>
          </div>
        </div>

        <!-- Stops -->
        <div>
          <h2 class="text-lg font-semibold mb-2">Paradas ({{ r.stops?.length || 0 }})</h2>
          <div class="space-y-2">
            @for (stop of r.stops; track stop.id) {
              <div
                class="rounded-lg border border-border bg-card p-3"
                [ngClass]="stopClass(stop)"
              >
                <div class="flex justify-between items-start gap-2 flex-wrap">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-mono bg-muted px-2 py-0.5 rounded">#{{ stop.stop_sequence }}</span>
                      <span class="font-mono text-sm">{{ stop.dispatch_note?.dispatch_number }}</span>
                      @if (stop.is_prepaid) {
                        <span class="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">PREPAGADO</span>
                      }
                    </div>
                    <div class="text-sm text-muted-foreground mt-1">
                      {{ stop.dispatch_note?.customer_name || '(Cliente)' }}
                    </div>
                    <div class="text-sm font-semibold mt-1">
                      {{ stop.dispatch_note?.grand_total | currency: 'COP' : 'symbol' : '1.0-0' }}
                    </div>
                  </div>
                  <span class="text-xs px-2 py-1 rounded-full" [ngClass]="stopStatusClass(stop.status)">
                    {{ stopStatusLabel(stop.status) }}
                  </span>
                </div>

                @if (stop.collected_amount || stop.withholding_amount || stop.credit_amount) {
                  <div class="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    @if (+stop.collected_amount > 0) {
                      <div>
                        <span class="text-muted-foreground">Recaudado:</span>
                        <strong class="text-green-600">
                          {{ stop.collected_amount | currency: 'COP' : 'symbol' : '1.0-0' }}
                        </strong>
                      </div>
                    }
                    @if (+stop.withholding_amount > 0) {
                      <div>
                        <span class="text-muted-foreground">Retención:</span>
                        <strong>{{ stop.withholding_amount | currency: 'COP' : 'symbol' : '1.0-0' }}</strong>
                      </div>
                    }
                    @if (+stop.credit_amount > 0) {
                      <div>
                        <span class="text-muted-foreground">A crédito:</span>
                        <strong class="text-yellow-600">
                          {{ stop.credit_amount | currency: 'COP' : 'symbol' : '1.0-0' }}
                        </strong>
                      </div>
                    }
                    @if (+stop.change_amount > 0) {
                      <div>
                        <span class="text-muted-foreground">Cambio:</span>
                        <strong>{{ stop.change_amount | currency: 'COP' : 'symbol' : '1.0-0' }}</strong>
                      </div>
                    }
                  </div>
                }

                <!-- Actions per stop (only in active routes) -->
                @if (['dispatched','in_transit','settling'].includes(r.status) && !['delivered','released','rejected','partial'].includes(stop.status)) {
                  <div class="mt-3 flex gap-2 flex-wrap">
                    <button
                      (click)="openSettle(stop)"
                      class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
                    >Liquidar</button>
                    <button
                      (click)="openRelease(stop)"
                      class="rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                    >Liberar</button>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>

    @if (settleStop()) {
      <app-stop-settle-modal
        [stop]="settleStop()!"
        [grandTotal]="+(settleStop()!.dispatch_note?.grand_total || 0)"
        (close)="settleStop.set(null)"
        (submitted)="onSettle($event)"
      ></app-stop-settle-modal>
    }

    @if (releaseStop()) {
      <app-stop-release-modal
        [stop]="releaseStop()!"
        (close)="releaseStop.set(null)"
        (submitted)="onRelease($event)"
      ></app-stop-release-modal>
    }

    @if (showCloseModal() && route()) {
      <app-planilla-close-modal
        [route]="route()!"
        (close)="showCloseModal.set(false)"
        (submitted)="onClose($event)"
      ></app-planilla-close-modal>
    }

    @if (showPdfViewer()) {
      <app-planilla-pdf-viewer
        [routeId]="r.id"
        (close)="showPdfViewer.set(false)"
      ></app-planilla-pdf-viewer>
    }
  `,
})
export class PlanillaDetailPageComponent {
  @Input() set id(v: string) {
    this.routeId.set(parseInt(v, 10));
  }

  private readonly service = inject(PlanillasRutasService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly routeId = signal<number>(0);
  readonly route = signal<DispatchRoute | null>(null);
  readonly loading = signal(false);
  readonly actionLoading = signal(false);

  readonly settleStop = signal<DispatchRouteStop | null>(null);
  readonly releaseStop = signal<DispatchRouteStop | null>(null);
  readonly showCloseModal = signal(false);
  readonly showPdfViewer = signal(false);
  readonly showVoidModal = signal(false);

  // r is a local shortcut for template
  r: any; // not used directly, template uses route()

  readonly varianceClass = computed(() => {
    const v = Number(this.route()?.cash_variance || 0);
    if (v === 0) return 'bg-green-50 text-green-800 border border-green-200';
    if (v > 0) return 'bg-blue-50 text-blue-800 border border-blue-200';
    return 'bg-red-50 text-red-800 border border-red-200';
  });

  private routeIdEffect: EffectRef;

  constructor() {
    this.routeIdEffect = effect(() => {
      const id = this.routeId();
      if (id > 0) this.load();
    });
  }

  ngOnDestroy() {
    this.routeIdEffect?.destroy();
  }

  ngOnInit() {
    if (this.routeId() > 0) this.load();
  }

  load() {
    this.loading.set(true);
    this.service
      .getOne(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.route.set(r);
          this.r = r;
          this.loading.set(false);
        },
        error: (e) => {
          this.loading.set(false);
          this.toast.error(e.message);
        },
      });
  }

  dispatch() {
    this.actionLoading.set(true);
    this.service
      .dispatch(this.routeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.actionLoading.set(false);
          this.route.set(r);
          this.r = r;
          this.toast.success('Planilla despachada');
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e.message);
        },
      });
  }

  openSettle(stop: DispatchRouteStop) {
    this.settleStop.set(stop);
  }

  openRelease(stop: DispatchRouteStop) {
    this.releaseStop.set(stop);
  }

  openClose() {
    this.showCloseModal.set(true);
  }

  openVoid() {
    const reason = prompt('¿Por qué anulas la planilla?');
    if (!reason || reason.length < 3) return;
    this.actionLoading.set(true);
    this.service
      .void(this.routeId(), { reason })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.actionLoading.set(false);
          this.route.set(r);
          this.r = r;
          this.toast.success('Planilla anulada');
        },
        error: (e) => {
          this.actionLoading.set(false);
          this.toast.error(e.message);
        },
      });
  }

  print() {
    this.showPdfViewer.set(true);
  }

  back() {
    this.router.navigate(['/admin/orders/planillas']);
  }

  onSettle(_event: SettleStopDto) {
    this.settleStop.set(null);
    this.toast.success('Parada liquidada');
    this.load();
  }

  onRelease(_event: { reason: string }) {
    this.releaseStop.set(null);
    this.toast.success('Parada liberada');
    this.load();
  }

  onClose(_event: { declared_cash: number; notes?: string }) {
    this.showCloseModal.set(false);
    this.toast.success('Planilla cerrada');
    this.load();
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      draft: 'Borrador',
      dispatched: 'Despachada',
      in_transit: 'En ruta',
      settling: 'Cuadrando',
      closed: 'Cerrada',
      voided: 'Anulada',
    };
    return map[s] || s;
  }

  statusClass(s: string): string {
    const map: Record<string, string> = {
      draft: 'bg-gray-200 text-gray-800',
      dispatched: 'bg-blue-100 text-blue-800',
      in_transit: 'bg-blue-200 text-blue-900',
      settling: 'bg-yellow-100 text-yellow-800',
      closed: 'bg-green-100 text-green-800',
      voided: 'bg-red-100 text-red-800',
    };
    return map[s] || 'bg-gray-100';
  }

  stopStatusLabel(s: string): string {
    const map: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En curso',
      delivered: 'Entregada',
      partial: 'Parcial',
      rejected: 'Rechazada',
      released: 'Liberada',
    };
    return map[s] || s;
  }

  stopStatusClass(s: string): string {
    const map: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-blue-100 text-blue-700',
      delivered: 'bg-green-100 text-green-800',
      partial: 'bg-yellow-100 text-yellow-800',
      rejected: 'bg-red-100 text-red-800',
      released: 'bg-purple-100 text-purple-800',
    };
    return map[s] || 'bg-gray-100';
  }

  stopClass(stop: DispatchRouteStop): string {
    if (stop.status === 'delivered' || stop.status === 'partial') return 'border-l-4 border-l-green-500';
    if (stop.status === 'released' || stop.status === 'rejected') return 'border-l-4 border-l-red-500 opacity-70';
    return '';
  }
}
