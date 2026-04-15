import { Component, OnInit, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { DataCollectionSubmissionsService } from '../services/data-collection-submissions.service';
import { DataCollectionSubmission } from '../interfaces/data-collection-submission.interface';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { SubmissionDetailModalComponent } from './submission-detail-modal/submission-detail-modal.component';

@Component({
  selector: 'app-submissions',
  standalone: true,
  imports: [CommonModule, IconComponent, DatePipe, SubmissionDetailModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-4 sm:p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-lg font-bold" style="color: var(--color-text)">Formularios Enviados</h1>
          <p class="text-sm" style="color: var(--color-text-muted)">Formularios de preconsulta completados por clientes</p>
        </div>
      </div>

      <!-- Status filters -->
      <div class="flex flex-wrap gap-2 mb-4">
        @for (status of statuses; track status.value) {
          <button class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  [style.background]="selectedStatus() === status.value ? 'var(--color-primary)' : 'var(--color-surface-secondary)'"
                  [style.color]="selectedStatus() === status.value ? 'white' : 'var(--color-text)'"
                  (click)="filterByStatus(status.value)">
            {{ status.label }}
          </button>
        }
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      } @else if (submissions().length === 0) {
        <div class="text-center py-12 border rounded-lg" style="border-color: var(--color-border)">
          <app-icon name="inbox" [size]="32" color="var(--color-text-muted)"></app-icon>
          <p class="text-sm mt-2" style="color: var(--color-text-muted)">No hay formularios</p>
        </div>
      } @else {
        <div class="space-y-2">
          @for (sub of submissions(); track sub.id) {
            <div class="border rounded-lg p-4 flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
                 style="border-color: var(--color-border); background: var(--color-surface)"
                 (click)="openDetail(sub.id)">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium" style="color: var(--color-text)">
                    {{ sub.customer?.first_name }} {{ sub.customer?.last_name }}
                  </span>
                  <span class="text-xs px-2 py-0.5 rounded-full"
                        [style.background]="getStatusColor(sub.status).bg"
                        [style.color]="getStatusColor(sub.status).text">
                    {{ sub.status }}
                  </span>
                  @if (sub.ai_prediagnosis) {
                    <span class="text-xs px-1.5 py-0.5 rounded-full" style="background: #f3e8ff; color: #7c3aed">IA</span>
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
  isDetailOpen = signal(false);
  selectedSubmissionId = signal<number | null>(null);

  statuses = [
    { value: '', label: 'Todos' },
    { value: 'pending', label: 'Pendientes' },
    { value: 'submitted', label: 'Enviados' },
    { value: 'completed', label: 'Completados' },
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

  getStatusColor(status: string): { bg: string; text: string } {
    const colors: Record<string, { bg: string; text: string }> = {
      pending: { bg: '#fef3c7', text: '#92400e' },
      in_progress: { bg: '#dbeafe', text: '#1e40af' },
      submitted: { bg: '#dcfce7', text: '#166534' },
      processing: { bg: '#f3e8ff', text: '#7c3aed' },
      completed: { bg: '#dcfce7', text: '#166534' },
      expired: { bg: '#fee2e2', text: '#991b1b' },
    };
    return colors[status] || { bg: '#f3f4f6', text: '#374151' };
  }
}
