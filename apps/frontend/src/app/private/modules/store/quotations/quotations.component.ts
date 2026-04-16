import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { QuotationsService } from './services/quotations.service';
import { QuotationListComponent } from './components/quotation-list/quotation-list.component';
import {
  Quotation,
  QuotationStats,
  QuotationQuery,
} from './interfaces/quotation.interface';

@Component({
  selector: 'app-quotations',
  standalone: true,
  imports: [
    StatsComponent,
    QuotationListComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Cotizaciones"
          [value]="stats().total"
          smallText="Cotizaciones creadas"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Pendientes"
          [value]="stats().pending"
          smallText="Por responder"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Tasa Conversión"
          [value]="stats().conversion_rate + '%'"
          smallText="Convertidas a orden"
          iconName="trending-up"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Valor Promedio"
          [value]="formatCurrency(stats().average_value)"
          smallText="Promedio por cotización"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="statsLoading()"
        ></app-stats>
      </div>

      <!-- List Component (contains search + data view) -->
      <app-quotation-list
        [quotations]="quotations()"
        [loading]="loading()"
        (viewDetail)="onViewDetail($event)"
        (send)="onSend($event)"
        (accept)="onAccept($event)"
        (reject)="onReject($event)"
        (cancel)="onCancel($event)"
        (convert)="onConvert($event)"
        (duplicate)="onDuplicate($event)"
        (deleteQuotation)="onDelete($event)"
        (edit)="onEdit($event)"
        (create)="navigateToQuotationMode()"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
      ></app-quotation-list>


    </div>
  `,
})
export class QuotationsComponent {
  private quotationsService = inject(QuotationsService);
  private router = inject(Router);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroyRef = inject(DestroyRef);

  stats = signal<QuotationStats>({
    total: 0, pending: 0, conversion_rate: 0, average_value: 0,
    draft: 0, sent: 0, accepted: 0, converted: 0,
  });
  quotations = signal<Quotation[]>([]);
  loading = signal(false);
  statsLoading = signal(false);

  searchTerm = '';
  statusFilter = '';

  constructor() {
    this.loadStats();
    this.loadQuotations();
  }

  formatCurrency(value: number): string {
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
    return '$' + value.toFixed(0);
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.quotationsService.getQuotationStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => { this.stats.set(s); this.statsLoading.set(false); },
        error: () => { this.toastService.error('Error al cargar estadísticas'); this.statsLoading.set(false); },
      });
  }

  loadQuotations(): void {
    this.loading.set(true);
    const query: QuotationQuery = {
      page: 1,
      limit: 50,
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.statusFilter && { status: this.statusFilter as any }),
    };

    this.quotationsService.getQuotations(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.quotations.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar cotizaciones');
          this.loading.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm = term;
    this.loadQuotations();
  }

  onFilterChange(values: Record<string, any>): void {
    this.statusFilter = values['status'] || '';
    this.loadQuotations();
  }

  onViewDetail(quotation: Quotation): void {
    this.router.navigate(['/admin/orders/quotations', quotation.id]);
  }

  onSend(q: Quotation): void {
    this.quotationsService.sendQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización enviada'); this.refresh(); },
        error: () => this.toastService.error('Error al enviar cotización'),
      });
  }

  onAccept(q: Quotation): void {
    this.quotationsService.acceptQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización aceptada'); this.refresh(); },
        error: () => this.toastService.error('Error al aceptar cotización'),
      });
  }

  onReject(q: Quotation): void {
    this.quotationsService.rejectQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización rechazada'); this.refresh(); },
        error: () => this.toastService.error('Error al rechazar cotización'),
      });
  }

  async onCancel(q: Quotation): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar cotización',
      message: `¿Cancelar la cotización ${q.quotation_number}?`,
      confirmText: 'Cancelar cotización',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.quotationsService.cancelQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización cancelada'); this.refresh(); },
        error: () => this.toastService.error('Error al cancelar cotización'),
      });
  }

  async onConvert(q: Quotation): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Convertir a orden',
      message: `¿Convertir la cotización ${q.quotation_number} en una orden de venta?`,
      confirmText: 'Convertir',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    this.quotationsService.convertToOrder(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización convertida a orden'); this.refresh(); },
        error: () => this.toastService.error('Error al convertir cotización'),
      });
  }

  onDuplicate(q: Quotation): void {
    this.quotationsService.duplicateQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización duplicada'); this.refresh(); },
        error: () => this.toastService.error('Error al duplicar cotización'),
      });
  }

  async onDelete(q: Quotation): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar cotización',
      message: `¿Eliminar la cotización ${q.quotation_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.quotationsService.deleteQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización eliminada'); this.refresh(); },
        error: () => this.toastService.error('Error al eliminar cotización'),
      });
  }

  onEdit(q: Quotation): void {
    this.router.navigate(['/admin/pos'], {
      queryParams: { mode: 'quotation', editQuotation: q.id },
    });
  }

  navigateToQuotationMode(): void {
    this.router.navigate(['/admin/pos'], { queryParams: { mode: 'quotation' } });
  }

  private refresh(): void {
    this.quotationsService.invalidateCache();
    this.loadStats();
    this.loadQuotations();
  }
}
