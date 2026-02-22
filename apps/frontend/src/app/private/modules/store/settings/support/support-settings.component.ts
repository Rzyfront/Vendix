import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, finalize } from 'rxjs';
import { TicketListComponent, CreateTicketModalComponent } from './components';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { SupportService } from './services/support.service';
import {
  Ticket,
  TicketStats,
  CreateTicketRequest,
} from './models/ticket.model';
import { ToastService } from '../../../../../shared/components';
import { Router, ActivatedRoute } from '@angular/router';
import { FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';

@Component({
  selector: 'app-support-settings',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    TicketListComponent,
    CreateTicketModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Grid -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Tickets"
          [value]="stats?.total || 0"
          smallText="Todos los tickets"
          iconName="ticket"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>

        <app-stats
          title="Abiertos"
          [value]="stats?.open_tickets || 0"
          smallText="Tickets en proceso"
          iconName="message-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Resueltos"
          [value]="stats?.resolved || 0"
          smallText="Tickets cerrados"
          iconName="check-circle"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Problemas"
          [value]="stats?.by_category?.['PROBLEM'] || 0"
          smallText="Tickets de problema"
          iconName="alert-circle"
          iconBgColor="bg-orange-100"
          iconColor="text-orange-600"
        ></app-stats>
      </div>

      <!-- List -->
      <app-ticket-list
        [tickets]="tickets"
        [loading]="loading"
        [totalItems]="totalItems"
        (search)="onSearch($event)"
        (filter)="onFilter($event)"
        (create)="openCreateModal()"
        (viewDetail)="openTicketDetail($event)"
      ></app-ticket-list>

      <!-- Create Modal -->
      <app-create-ticket-modal
        [isOpen]="isCreateModalOpen"
        [loading]="actionLoading"
        (isOpenChange)="isCreateModalOpen = $event"
        (closed)="closeCreateModal()"
        (save)="onCreateTicket($event)"
      ></app-create-ticket-modal>
    </div>
  `,
})
export class SupportSettingsComponent implements OnInit, OnDestroy {
  private supportService = inject(SupportService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  stats: TicketStats | null = null;
  tickets: Ticket[] = [];

  loading = false;
  actionLoading = false;

  // Pagination
  page = 1;
  limit = 10;
  totalItems = 0;
  searchQuery = '';
  filters: FilterValues = {};

  // Modal
  isCreateModalOpen = false;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadStats();
    this.loadTickets();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats() {
    this.supportService
      .getTicketStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (statsData: any) => {
          // Service already returns data unwrapped
          const byStatus = statsData?.by_status || {};
          const computedStats: TicketStats = {
            total: statsData?.total || 0,
            by_status: byStatus,
            by_priority: statsData?.by_priority || {},
            by_category: statsData?.by_category || {},
            overdue: statsData?.overdue || 0,
            avg_resolution_time: statsData?.avg_resolution_time || 0,
            // Computed fields
            open_tickets: (byStatus.NEW || 0) + (byStatus.OPEN || 0) + (byStatus.IN_PROGRESS || 0),
            resolved: (byStatus.RESOLVED || 0) + (byStatus.CLOSED || 0),
            pending: byStatus.WAITING_RESPONSE || 0,
            my_tickets: 0,
          };
          this.stats = computedStats;
        },
        error: (error: any) => {
          console.error('Error loading stats:', error);
          this.toastService.error('Error al cargar estadísticas');
        },
      });
  }

  loadTickets() {
    this.loading = true;
    this.supportService
      .getTickets({
        page: this.page,
        limit: this.limit,
        search: this.searchQuery || undefined,
        status: (this.filters['status'] as string) || undefined,
        priority: (this.filters['priority'] as string) || undefined,
        category: (this.filters['category'] as string) || undefined,
      })
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: (response: any) => {
          this.tickets = response.data;
          this.totalItems = response.meta.total;
        },
        error: (err: any) => {
          console.error(err);
          this.toastService.error('Error al cargar tickets');
        },
      });
  }

  onSearch(query: string) {
    this.searchQuery = query;
    this.page = 1;
    this.loadTickets();
  }

  onFilter(filterValues: FilterValues) {
    this.filters = filterValues;
    this.page = 1;
    this.loadTickets();
  }

  openCreateModal() {
    this.isCreateModalOpen = true;
  }

  closeCreateModal() {
    this.isCreateModalOpen = false;
  }

  onCreateTicket(data: CreateTicketRequest & { attachments?: Array<any> }) {
    this.actionLoading = true;

    this.supportService
      .createTicket(data)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.actionLoading = false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success('¡Ticket creado exitosamente! Te responderemos pronto.');
          this.closeCreateModal();
          this.loadTickets();
          this.loadStats();
        },
        error: (err) => {
          console.error(err);
          this.toastService.error('Error al crear ticket. Intenta nuevamente.');
        },
      });
  }

  openTicketDetail(ticket: Ticket) {
    this.router.navigate([ticket.id], { relativeTo: this.route });
  }
}
