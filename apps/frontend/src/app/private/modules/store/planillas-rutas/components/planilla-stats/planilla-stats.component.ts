import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DispatchRouteStats } from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-planilla-stats',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-3 md:p-4">
      <div class="rounded-lg border border-border bg-card p-3">
        <div class="text-xs text-muted-foreground">Total</div>
        <div class="text-2xl font-bold">{{ stats?.total ?? 0 }}</div>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <div class="text-xs text-muted-foreground">Borrador</div>
        <div class="text-2xl font-bold text-gray-500">{{ stats?.draft ?? 0 }}</div>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <div class="text-xs text-muted-foreground">En ruta</div>
        <div class="text-2xl font-bold text-blue-500">{{
          (stats?.dispatched ?? 0) + (stats?.in_transit ?? 0)
        }}</div>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <div class="text-xs text-muted-foreground">Cerradas</div>
        <div class="text-2xl font-bold text-green-500">{{ stats?.closed ?? 0 }}</div>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <div class="text-xs text-muted-foreground">Anuladas</div>
        <div class="text-2xl font-bold text-red-500">{{ stats?.voided ?? 0 }}</div>
      </div>
      <div class="rounded-lg border border-border bg-card p-3 col-span-2 sm:col-span-1">
        <div class="text-xs text-muted-foreground">Recaudado</div>
        <div class="text-lg font-bold text-green-600">
          {{ stats?.total_collected | currency: 'COP' : 'symbol' : '1.0-0' }}
        </div>
        <div class="text-xs text-muted-foreground">
          Diferencia: {{ stats?.total_cash_variance | currency: 'COP' : 'symbol' : '1.0-0' }}
        </div>
      </div>
    </div>
  `,
})
export class PlanillaStatsComponent {
  @Input() stats: DispatchRouteStats | null = null;
  @Input() loading = false;
}
