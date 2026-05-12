import {
  Component,
  OnInit,
  signal,
  model,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import {
  UserSession,
  PaginatedSessionsResponse,
} from './interfaces/session.interface';
import { SessionsService } from './services/sessions.service';
import {
  TableColumn,
  TableAction,
  StatsComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  ButtonComponent,
  ModalComponent,
} from '../../../../../shared/components';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';

interface StatItem {
  title: string;
  value: number;
  smallText: string;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    StatsComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <div class="flex flex-col gap-2 md:p-4">
      <!-- Stats Section -->
      @if (statsItems().length > 0) {
        <div class="stats-container">
          @for (item of statsItems(); track item) {
            <app-stats
              [title]="item.title"
              [value]="item.value"
              [smallText]="item.smallText"
              [iconName]="item.iconName"
              [iconBgColor]="item.iconBgColor"
              [iconColor]="item.iconColor"
            >
            </app-stats>
          }
        </div>
      }

      <!-- Main Content -->
      <div class="bg-surface rounded-card shadow-card border border-border">
        <!-- Header & Filters -->
        <div
          class="p-2 md:px-6 md:py-4 border-b border-border flex flex-col md:flex-row gap-2 md:gap-4 justify-between items-center"
        >
          <h2 class="text-lg font-semibold text-text-primary">
            Sesiones de Usuarios
          </h2>

          <div class="flex gap-2 w-full md:w-auto" [formGroup]="filterForm">
            <!-- Status Filter -->
            <div class="w-full md:w-40">
              <select
                formControlName="status"
                class="w-full px-3 py-2 border border-border rounded-button bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary text-sm transition-shadow"
              >
                <option value="">Todas</option>
                <option value="active">Activas</option>
                <option value="inactive">Inactivas</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="p-2 md:p-4">
          <app-responsive-data-view
            [columns]="tableColumns"
            [data]="sessions()"
            [actions]="tableActions"
            [cardConfig]="cardConfig"
            [loading]="isLoading()"
            [emptyMessage]="'No hay sesiones'"
            [emptyIcon]="'monitor'"
          >
          </app-responsive-data-view>
        </div>

        <!-- Pagination Footer -->
        @if (pagination.totalPages > 1) {
          <div
            class="p-4 border-t border-gray-100 flex justify-between items-center"
          >
            <span class="text-sm text-gray-500">
              Página {{ pagination.page }} de {{ pagination.totalPages }}
              ({{ pagination.total }} registros)
            </span>
            <div class="flex gap-2">
              <button
                (click)="onPageChange(pagination.page - 1)"
                [disabled]="pagination.page === 1"
                class="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                (click)="onPageChange(pagination.page + 1)"
                [disabled]="pagination.page === pagination.totalPages"
                class="px-3 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Session Detail Modal -->
    <app-modal
      [isOpen]="showDetailModal()"
      [title]="'Detalle de Sesión'"
      [subtitle]="selectedSession() ? 'Sesión ID: ' + selectedSession()?.id : ''"
      [size]="'lg'"
      (closed)="closeModal()"
    >
      @if (selectedSession()) {
        <div class="space-y-4 text-sm">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <span class="block text-gray-500">Usuario</span>
              <span class="font-medium text-gray-900">
                {{ selectedSession()?.users?.first_name }}
                {{ selectedSession()?.users?.last_name }}
              </span>
            </div>
            <div>
              <span class="block text-gray-500">Email</span>
              <span class="font-medium text-gray-900">
                {{ selectedSession()?.users?.email || 'N/A' }}
              </span>
            </div>
            <div>
              <span class="block text-gray-500">Estado</span>
              <span
                class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                [class.bg-green-100]="selectedSession()?.is_active"
                [class.text-green-800]="selectedSession()?.is_active"
                [class.bg-red-100]="!selectedSession()?.is_active"
                [class.text-red-800]="!selectedSession()?.is_active"
              >
                {{ selectedSession()?.is_active ? 'Activa' : 'Inactiva' }}
              </span>
            </div>
            <div>
              <span class="block text-gray-500">IP</span>
              <span class="font-medium text-gray-900">
                {{ selectedSession()?.ip_address || 'N/A' }}
              </span>
            </div>
            <div>
              <span class="block text-gray-500">Última Actividad</span>
              <span class="font-medium text-gray-900">
                {{ formatDate(selectedSession()?.last_activity) }}
              </span>
            </div>
            <div>
              <span class="block text-gray-500">Creada</span>
              <span class="font-medium text-gray-900">
                {{ formatDate(selectedSession()?.created_at) }}
              </span>
            </div>
          </div>
        </div>
      }

      <div slot="footer" class="flex justify-between items-center">
        <app-button
          variant="danger"
          (clicked)="terminateCurrentSession()"
          [loading]="isTerminating()"
        >
          Terminar Sesión
        </app-button>
        <app-button variant="secondary" (clicked)="closeModal()">
          Cerrar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class SessionsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private sessionsService = inject(SessionsService);
  private fb = inject(FormBuilder);

  readonly sessions = model<UserSession[]>([]);
  readonly statsItems = model<StatItem[]>([]);
  readonly isLoading = this.sessionsService.isLoading;
  readonly isTerminating = signal(false);

  readonly selectedSession = model<UserSession | null>(null);
  readonly showDetailModal = model(false);

  filterForm: FormGroup;

  tableColumns: TableColumn[] = [
    {
      key: 'users',
      label: 'Usuario',
      priority: 1,
      transform: (user: any) =>
        user ? `${user.first_name} ${user.last_name}` : 'N/A',
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (val: boolean) => val ? 'Activa' : 'Inactiva',
      badge: true,
      badgeConfig: {
        type: 'custom',
      },
      badgeTransform: (val: boolean) => val ? 'active' : 'inactive',
    },
    {
      key: 'last_activity',
      label: 'Última Actividad',
      priority: 2,
      transform: (val: string) => formatDateOnlyUTC(val),
    },
    {
      key: 'ip_address',
      label: 'IP',
      priority: 3,
      transform: (val: string) => val || '-',
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      action: (session: UserSession) => this.viewDetail(session),
      variant: 'secondary',
    },
    {
      label: 'Terminar',
      icon: 'x-circle',
      action: (session: UserSession) => this.terminateSession(session),
      variant: 'danger',
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'users',
    titleTransform: (user: any) =>
      user ? `${user.first_name} ${user.last_name}` : 'N/A',
    subtitleKey: 'is_active',
    subtitleTransform: (val: boolean) => (val ? 'Activa' : 'Inactiva'),
    detailKeys: [
      {
        key: 'last_activity',
        label: 'Última Actividad',
        transform: (val: string) => formatDateOnlyUTC(val),
      },
      {
        key: 'ip_address',
        label: 'IP',
        transform: (val: string) => val || '-',
      },
    ],
  };

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  constructor() {
    this.filterForm = this.fb.group({
      status: [''],
    });
  }

  ngOnInit(): void {
    this.loadSessions();

    this.filterForm.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pagination.page = 1;
        this.loadSessions();
      });
  }

  loadSessions(): void {
    const filters = this.filterForm.value;

    this.sessionsService
      .getSessions({
        page: this.pagination.page,
        limit: this.pagination.limit,
        status: filters.status || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: PaginatedSessionsResponse) => {
          this.sessions.set(response.data || []);
          if (response.meta) {
            this.pagination = {
              ...this.pagination,
              total: response.meta.total,
              totalPages: response.meta.totalPages,
            };
            this.updateStatsItems(response.meta.total, response.data);
          }
        },
        error: (err) => {
          console.error(err);
        },
      });
  }

  updateStatsItems(total: number, sessions: UserSession[]): void {
    const activeCount = sessions.filter((s) => s.is_active).length;

    this.statsItems.set([
      {
        title: 'Total Sesiones',
        value: total,
        smallText: 'sesiones registradas',
        iconName: 'monitor',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-600',
      },
      {
        title: 'Activas',
        value: activeCount,
        smallText: 'sesiones activas',
        iconName: 'check-circle',
        iconBgColor: 'bg-green-100',
        iconColor: 'text-green-600',
      },
      {
        title: 'Inactivas',
        value: total - activeCount,
        smallText: 'sesiones terminadas',
        iconName: 'x-circle',
        iconBgColor: 'bg-red-100',
        iconColor: 'text-red-600',
      },
    ]);
  }

  onPageChange(page: number): void {
    this.pagination.page = page;
    this.loadSessions();
  }

  viewDetail(session: UserSession): void {
    this.selectedSession.set(session);
    this.showDetailModal.set(true);
  }

  closeModal(): void {
    this.showDetailModal.set(false);
    this.selectedSession.set(null);
  }

  terminateSession(session: UserSession): void {
    if (confirm(`¿Terminar la sesión de ${session.users?.first_name} ${session.users?.last_name}?`)) {
      this.isTerminating.set(true);
      this.sessionsService
        .terminateSession(session.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.isTerminating.set(false);
            this.loadSessions();
          },
          error: (err) => {
            console.error(err);
            this.isTerminating.set(false);
          },
        });
    }
  }

  terminateCurrentSession(): void {
    const session = this.selectedSession();
    if (session) {
      this.terminateSession(session);
      this.closeModal();
    }
  }

  formatDate(dateStr: string | undefined): string {
    if (!dateStr) return 'N/A';
    return formatDateOnlyUTC(dateStr);
  }
}
