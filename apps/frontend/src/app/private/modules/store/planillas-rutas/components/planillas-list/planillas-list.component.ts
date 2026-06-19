import {
  Component,
  DestroyRef,
  EventEmitter,
  Output,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { DispatchRoute, DispatchRouteStatus } from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-planillas-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-3 md:p-4 space-y-3">
      <!-- Search + filters (mobile-friendly) -->
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Buscar por número, ruta o conductor..."
          class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          [value]="search()"
          (input)="onSearch($event)"
        />
        <select
          class="rounded-md border border-input bg-background px-3 py-2 text-sm"
          [value]="statusFilter()"
          (change)="onStatusChange($event)"
        >
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="dispatched">Despachada</option>
          <option value="in_transit">En ruta</option>
          <option value="settling">Cuadrando</option>
          <option value="closed">Cerrada</option>
          <option value="voided">Anulada</option>
        </select>
        <button
          (click)="create.emit()"
          class="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          + Nueva Planilla
        </button>
      </div>

      <!-- Mobile-first: cards on small, table on md+ -->
      <div class="block md:hidden space-y-2">
        @for (route of routes(); track route.id) {
          <button
            (click)="viewDetail.emit(route)"
            class="w-full text-left rounded-lg border border-border bg-card p-3 active:scale-[0.98] transition"
          >
            <div class="flex justify-between items-start">
              <div>
                <div class="font-semibold">{{ route.route_number }}</div>
                @if (route.route_code) {
                  <div class="text-xs text-muted-foreground">Ruta {{ route.route_code }}</div>
                }
              </div>
              <span
                class="text-xs px-2 py-1 rounded-full"
                [ngClass]="statusClass(route.status)"
              >{{ statusLabel(route.status) }}</span>
            </div>
            <div class="mt-2 text-sm">
              <span class="text-muted-foreground">Conductor:</span>
              {{ route.driver_user?.first_name }} {{ route.driver_user?.last_name }}
              @if (route.external_driver_name) {
                ({{ route.external_driver_name }})
              }
            </div>
            @if (route.vehicle) {
              <div class="text-sm">
                <span class="text-muted-foreground">Vehículo:</span>
                {{ route.vehicle.plate }}
              </div>
            }
            <div class="mt-2 flex justify-between text-sm">
              <span>{{ route._count?.stops ?? route.stops?.length ?? 0 }} paradas</span>
              <span class="font-semibold">
                {{ route.total_to_collect | currency: 'COP' : 'symbol' : '1.0-0' }}
              </span>
            </div>
            <div class="text-xs text-muted-foreground mt-1">
              {{ route.planned_date | date: 'dd MMM, HH:mm' }}
            </div>
          </button>
        } @empty {
          <div class="text-center py-8 text-muted-foreground">No hay planillas</div>
        }
      </div>

      <!-- Desktop: table -->
      <div class="hidden md:block rounded-lg border border-border overflow-hidden">
        <table class="w-full">
          <thead class="bg-muted">
            <tr>
              <th class="text-left p-3 text-sm">Planilla</th>
              <th class="text-left p-3 text-sm">Ruta</th>
              <th class="text-left p-3 text-sm">Estado</th>
              <th class="text-left p-3 text-sm">Conductor</th>
              <th class="text-left p-3 text-sm">Vehículo</th>
              <th class="text-right p-3 text-sm">Paradas</th>
              <th class="text-right p-3 text-sm">A recaudar</th>
              <th class="text-left p-3 text-sm">Fecha</th>
            </tr>
          </thead>
          <tbody>
            @for (route of routes(); track route.id) {
              <tr
                (click)="viewDetail.emit(route)"
                class="border-t border-border hover:bg-muted/50 cursor-pointer"
              >
                <td class="p-3 font-mono text-sm">{{ route.route_number }}</td>
                <td class="p-3 text-sm">{{ route.route_code || '—' }}</td>
                <td class="p-3 text-sm">
                  <span class="text-xs px-2 py-1 rounded-full" [ngClass]="statusClass(route.status)">
                    {{ statusLabel(route.status) }}
                  </span>
                </td>
                <td class="p-3 text-sm">
                  {{ route.driver_user?.first_name }} {{ route.driver_user?.last_name }}
                  @if (route.external_driver_name) {
                    <span class="text-xs text-muted-foreground">(ext. {{ route.external_driver_name }})</span>
                  }
                </td>
                <td class="p-3 text-sm">{{ route.vehicle?.plate || '—' }}</td>
                <td class="p-3 text-sm text-right">{{ route._count?.stops ?? route.stops?.length ?? 0 }}</td>
                <td class="p-3 text-sm text-right font-semibold">
                  {{ route.total_to_collect | currency: 'COP' : 'symbol' : '1.0-0' }}
                </td>
                <td class="p-3 text-sm text-muted-foreground">
                  {{ route.planned_date | date: 'dd MMM, HH:mm' }}
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="p-8 text-center text-muted-foreground">No hay planillas</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      @if (totalPages() > 1) {
        <div class="flex justify-center gap-2 pt-2">
          <button
            [disabled]="page() === 1"
            (click)="goToPage(page() - 1)"
            class="px-3 py-1 rounded border border-input disabled:opacity-50"
          >←</button>
          <span class="px-3 py-1 text-sm">Página {{ page() }} de {{ totalPages() }}</span>
          <button
            [disabled]="page() === totalPages()"
            (click)="goToPage(page() + 1)"
            class="px-3 py-1 rounded border border-input disabled:opacity-50"
          >→</button>
        </div>
      }
    </div>
  `,
})
export class PlanillasListComponent implements OnInit {
  private readonly service = inject(PlanillasRutasService);
  private readonly destroyRef = inject(DestroyRef);

  @Output() viewDetail = new EventEmitter<DispatchRoute>();
  @Output() create = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();

  readonly routes = signal<DispatchRoute[]>([]);
  readonly page = signal(1);
  readonly totalPages = signal(1);
  readonly search = signal('');
  readonly statusFilter = signal<DispatchRouteStatus | ''>('');

  ngOnInit() {
    this.load();
  }

  load() {
    this.service
      .list({
        page: this.page(),
        limit: 20,
        search: this.search() || undefined,
        status: (this.statusFilter() || undefined) as DispatchRouteStatus,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.routes.set(res.data);
          this.totalPages.set(res.pagination.totalPages);
        },
      });
  }

  onSearch(e: Event) {
    this.search.set((e.target as HTMLInputElement).value);
    this.page.set(1);
    this.load();
  }

  onStatusChange(e: Event) {
    this.statusFilter.set((e.target as HTMLSelectElement).value as any);
    this.page.set(1);
    this.load();
  }

  goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.load();
  }

  statusLabel(s: DispatchRouteStatus): string {
    const map: Record<DispatchRouteStatus, string> = {
      draft: 'Borrador',
      dispatched: 'Despachada',
      in_transit: 'En ruta',
      settling: 'Cuadrando',
      closed: 'Cerrada',
      voided: 'Anulada',
    };
    return map[s] || s;
  }

  statusClass(s: DispatchRouteStatus): string {
    const map: Record<DispatchRouteStatus, string> = {
      draft: 'bg-gray-200 text-gray-800',
      dispatched: 'bg-blue-100 text-blue-800',
      in_transit: 'bg-blue-200 text-blue-900',
      settling: 'bg-yellow-100 text-yellow-800',
      closed: 'bg-green-100 text-green-800',
      voided: 'bg-red-100 text-red-800',
    };
    return map[s] || 'bg-gray-100 text-gray-700';
  }
}
