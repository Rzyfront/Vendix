import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanillasRutasService } from './services/planillas-rutas.service';
import { PlanillasListComponent } from './components/planillas-list/planillas-list.component';
import { PlanillaStatsComponent } from './components/planilla-stats/planilla-stats.component';
import { PlanillaWizardComponent } from './components/planilla-wizard/planilla-wizard.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DispatchRoute, DispatchRouteStats } from './interfaces/planilla.interface';

@Component({
  selector: 'app-planillas-rutas',
  standalone: true,
  imports: [
    CommonModule,
    PlanillasListComponent,
    PlanillaStatsComponent,
    PlanillaWizardComponent,
  ],
  template: `
    <div class="w-full">
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-planilla-stats
          [stats]="stats()"
          [loading]="statsLoading()"
        ></app-planilla-stats>
      </div>

      <app-planillas-list
        (viewDetail)="onViewDetail($event)"
        (create)="openCreateModal()"
        (refresh)="refresh()"
      ></app-planillas-list>
    </div>

    @if (showWizard()) {
      <app-planilla-wizard
        (close)="closeWizard()"
        (created)="onCreated($event)"
      ></app-planilla-wizard>
    }
  `,
})
export class PlanillasRutasComponent {
  private readonly service = inject(PlanillasRutasService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stats = signal<DispatchRouteStats | null>(null);
  readonly statsLoading = signal(false);
  readonly showWizard = signal(false);

  ngOnInit() {
    this.refreshStats();
  }

  refresh() {
    this.refreshStats();
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
  }

  onCreated(route: DispatchRoute) {
    this.showWizard.set(false);
    this.toast.success(`Planilla ${route.route_number} creada`);
    this.refresh();
  }
}
