import { Component, OnInit, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataCollectionSubmissionsService } from '../services/data-collection-submissions.service';
import { DataCollectionSubmission } from '../interfaces/data-collection-submission.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { SubmissionDetailModalComponent } from './submission-detail-modal/submission-detail-modal.component';
import {
  SpinnerComponent,
  EmptyStateComponent,
  ScrollableTabsComponent,
  CardComponent,
  InputsearchComponent,
} from '../../../../../shared/components/index';
import { BadgeComponent, BadgeVariant } from '../../../../../shared/components/badge/badge.component';
import type { ScrollableTab } from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';

@Component({
  selector: 'app-submissions',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    SubmissionDetailModalComponent,
    SpinnerComponent,
    EmptyStateComponent,
    ScrollableTabsComponent,
    BadgeComponent,
    CardComponent,
    InputsearchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="md:space-y-4">
      <!-- Status filter tabs — outside card -->
      <div class="px-2 md:px-0">
        <app-scrollable-tabs
          [tabs]="statusFilterTabs"
          [activeTab]="selectedStatus()"
          size="xs"
          (tabChange)="filterByStatus($event)"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[400px]">
        <!-- Search Section: sticky on mobile -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
              Formularios Enviados
              <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ filteredSubmissions().length }})</span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar por cliente..."
                [debounceTime]="500"
                [ngModel]="searchTerm()"
                (ngModelChange)="onSearchChange($event)"
              />
            </div>
          </div>
        </div>

        <!-- Loading -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <app-spinner size="md" />
            <p class="mt-2 text-text-secondary text-sm">Cargando formularios...</p>
          </div>
        } @else if (filteredSubmissions().length === 0) {
          <app-empty-state
            icon="inbox"
            title="No hay formularios"
            description="Cuando los clientes completen formularios de preconsulta, aparecerán aquí."
            [showActionButton]="false"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4 space-y-2">
            @for (sub of filteredSubmissions(); track sub.id) {
              <div class="border rounded-lg p-4 flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
                   style="border-color: var(--color-border); background: var(--color-surface)"
                   (click)="openDetail(sub.id)">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium" style="color: var(--color-text)">
                      {{ sub.customer?.first_name }} {{ sub.customer?.last_name }}
                    </span>
                    <app-badge [variant]="getStatusBadgeVariant(sub.status)" size="xs">
                      {{ getStatusLabel(sub.status) }}
                    </app-badge>
                    @if (sub.ai_prediagnosis) {
                      <app-badge variant="service" size="xs">IA</app-badge>
                    }
                  </div>
                  <div class="text-xs mt-1" style="color: var(--color-text-muted)">
                    {{ sub.template?.name }}
                    @if (sub.booking) {
                      · {{ sub.booking.booking_number }} · {{ sub.booking.date | date:'shortDate' }}
                    }
                  </div>
                </div>
                <div class="text-xs" style="color: var(--color-text-muted)">
                  {{ sub.created_at | date:'short' }}
                </div>
              </div>
            }
          </div>
        }
      </app-card>
    </div>

    @if (isDetailOpen() && selectedSubmissionId()) {
      <app-submission-detail-modal
        [submissionId]="selectedSubmissionId()!"
        (close)="closeDetail()"
      />
    }
  `,
})
export class SubmissionsComponent implements OnInit {
  private submissionsService = inject(DataCollectionSubmissionsService);
  private toastService = inject(ToastService);

  submissions = signal<DataCollectionSubmission[]>([]);
  loading = signal(true);
  selectedStatus = signal('');
  searchTerm = signal('');
  isDetailOpen = signal(false);
  selectedSubmissionId = signal<number | null>(null);

  filteredSubmissions = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    if (!term) return this.submissions();
    return this.submissions().filter(sub => {
      const name = `${sub.customer?.first_name ?? ''} ${sub.customer?.last_name ?? ''}`.toLowerCase();
      const template = (sub.template?.name ?? '').toLowerCase();
      return name.includes(term) || template.includes(term);
    });
  });

  statusFilterTabs: ScrollableTab[] = [
    { id: '', label: 'Todos' },
    { id: 'pending', label: 'Pendientes' },
    { id: 'submitted', label: 'Enviados' },
    { id: 'completed', label: 'Completados' },
  ];

  ngOnInit() {
    this.loadSubmissions();
  }

  loadSubmissions() {
    this.loading.set(true);
    const status = this.selectedStatus() || undefined;
    this.submissionsService.getAll(status).subscribe({
      next: (subs) => {
        this.submissions.set(subs);
        this.loading.set(false);
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  filterByStatus(status: string) {
    this.selectedStatus.set(status);
    this.loadSubmissions();
  }

  openDetail(id: number) {
    this.selectedSubmissionId.set(id);
    this.isDetailOpen.set(true);
  }

  closeDetail() {
    this.isDetailOpen.set(false);
    this.selectedSubmissionId.set(null);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En progreso',
      submitted: 'Enviado',
      processing: 'Procesando',
      completed: 'Completado',
      expired: 'Expirado',
    };
    return labels[status] ?? status;
  }

  getStatusBadgeVariant(status: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      pending: 'warning',
      in_progress: 'info',
      submitted: 'success',
      processing: 'service',
      completed: 'success',
      expired: 'error',
    };
    return variants[status] ?? 'neutral';
  }

}
