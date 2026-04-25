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
  LoginAttempt,
  LoginAttemptsStats,
  PaginatedLoginAttemptsResponse,
} from './interfaces/login-attempt.interface';
import { LoginAttemptsService } from './services/login-attempts.service';
import {
  TableColumn,
  TableAction,
  StatsComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
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
  selector: 'app-login-attempts',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    StatsComponent,
    ResponsiveDataViewComponent,
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
            Intentos de Inicio de Sesión
          </h2>

          <div class="flex gap-2 w-full md:w-auto" [formGroup]="filterForm">
            <!-- Email Filter -->
            <div class="w-full md:w-48">
              <input
                type="text"
                formControlName="email"
                placeholder="Buscar por email..."
                class="w-full px-3 py-2 border border-border rounded-button bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary text-sm transition-shadow"
              />
            </div>

            <!-- Status Filter -->
            <div class="w-full md:w-40">
              <select
                formControlName="success"
                class="w-full px-3 py-2 border border-border rounded-button bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary text-sm transition-shadow"
              >
                <option value="">Todos</option>
                <option value="true">Exitosos</option>
                <option value="false">Fallidos</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="p-2 md:p-4">
          <app-responsive-data-view
            [columns]="tableColumns"
            [data]="attempts()"
            [cardConfig]="cardConfig"
            [loading]="isLoading()"
            [emptyMessage]="'No hay intentos de login'"
            [emptyIcon]="'log-in'"
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
  `,
})
export class LoginAttemptsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private loginAttemptsService = inject(LoginAttemptsService);
  private fb = inject(FormBuilder);

  readonly attempts = model<LoginAttempt[]>([]);
  readonly stats = model<LoginAttemptsStats | null>(null);
  readonly statsItems = model<StatItem[]>([]);
  readonly isLoading = this.loginAttemptsService.isLoading;

  filterForm: FormGroup;

  tableColumns: TableColumn[] = [
    {
      key: 'attempted_at',
      label: 'Fecha',
      priority: 1,
      transform: (val: string) => formatDateOnlyUTC(val),
    },
    {
      key: 'email',
      label: 'Email',
      priority: 1,
    },
    {
      key: 'success',
      label: 'Estado',
      priority: 1,
      transform: (val: boolean) => val ? 'Exitoso' : 'Fallido',
      badge: true,
      badgeConfig: {
        type: 'custom',
      },
      badgeTransform: (val: boolean) => val ? 'success' : 'error',
    },
    {
      key: 'ip_address',
      label: 'IP',
      priority: 2,
      transform: (val: string) => val || '-',
    },
    {
      key: 'stores',
      label: 'Tienda',
      priority: 3,
      transform: (store: any) => store?.name || '-',
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'email',
    subtitleKey: 'success',
    subtitleTransform: (val: boolean) => val ? 'Exitoso' : 'Fallido',
    detailKeys: [
      {
        key: 'attempted_at',
        label: 'Fecha',
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
      email: [''],
      success: [''],
    });
  }

  ngOnInit(): void {
    this.loadAttempts();
    this.loadStats();

    this.filterForm.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pagination.page = 1;
        this.loadAttempts();
      });
  }

  loadAttempts(): void {
    const filters = this.filterForm.value;
    const successFilter = filters.success === '' ? undefined : filters.success === 'true';

    this.loginAttemptsService
      .getLoginAttempts({
        page: this.pagination.page,
        limit: this.pagination.limit,
        email: filters.email || undefined,
        success: successFilter,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: PaginatedLoginAttemptsResponse) => {
          this.attempts.set(response.data || []);
          if (response.meta) {
            this.pagination = {
              ...this.pagination,
              total: response.meta.total,
              totalPages: response.meta.totalPages,
            };
          }
        },
        error: (err) => {
          console.error(err);
        },
      });
  }

  loadStats(): void {
    this.loginAttemptsService
      .getLoginAttemptsStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.updateStatsItems();
        },
        error: (err) => {
          console.error('Error loading login attempts stats:', err);
        },
      });
  }

  updateStatsItems(): void {
    const stats = this.stats();
    if (!stats) return;

    this.statsItems.set([
      {
        title: 'Total Intentos',
        value: stats.total_attempts,
        smallText: 'intentos de login',
        iconName: 'log-in',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-600',
      },
      {
        title: 'Exitosos',
        value: stats.successful_attempts,
        smallText: 'inicios exitosos',
        iconName: 'check-circle',
        iconBgColor: 'bg-green-100',
        iconColor: 'text-green-600',
      },
      {
        title: 'Fallidos',
        value: stats.failed_attempts,
        smallText: 'intentos fallidos',
        iconName: 'x-circle',
        iconBgColor: 'bg-red-100',
        iconColor: 'text-red-600',
      },
      {
        title: 'Tasa de Éxito',
        value: Math.round(stats.success_rate),
        smallText: '% exitosos',
        iconName: 'percent',
        iconBgColor: 'bg-purple-100',
        iconColor: 'text-purple-600',
      },
    ]);
  }

  onPageChange(page: number): void {
    this.pagination.page = page;
    this.loadAttempts();
  }
}
