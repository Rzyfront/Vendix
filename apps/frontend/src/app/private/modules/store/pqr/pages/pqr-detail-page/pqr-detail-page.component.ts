import {
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PqrAdminService } from '../../services/pqr-admin.service';
import {
  PqrDetail,
  PqrStatus,
  PqrStatusUpdateDto,
  PqrCommentCreateDto,
} from '../../models/pqr.model';
import { PqrStatusPillComponent } from '../../components/pqr-status-pill.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

interface StatusOption {
  value: PqrStatus;
  label: string;
  notifyRequester: boolean;
}

const STATUS_OPTIONS: StatusOption[] = [
  { value: 'NEW', label: 'Nuevo', notifyRequester: false },
  { value: 'OPEN', label: 'Abierto', notifyRequester: false },
  { value: 'IN_PROGRESS', label: 'En progreso', notifyRequester: false },
  { value: 'WAITING_RESPONSE', label: 'Esperando respuesta', notifyRequester: false },
  { value: 'RESOLVED', label: 'Respondida', notifyRequester: true },
  { value: 'CLOSED', label: 'Cerrada', notifyRequester: true },
  { value: 'REOPENED', label: 'Reabierta', notifyRequester: false },
];

/**
 * Admin detail view for a single PQR. Loads by `:id`, lets the operator
 * change status, add internal or public comments, and inspect requester
 * info + status history.
 */
@Component({
  selector: 'app-pqr-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    DatePipe,
    PqrStatusPillComponent,
    IconComponent,
  ],
  templateUrl: './pqr-detail-page.component.html',
  styleUrls: ['./pqr-detail-page.component.scss'],
})
export class PqrDetailPageComponent {
  private readonly adminService = inject(PqrAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly detail = signal<PqrDetail | null>(null);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly submitting = signal(false);

  // Comment composer
  readonly newComment = signal('');
  readonly isInternal = signal(true);
  readonly notifyRequester = signal(false);

  // Status composer
  readonly showStatusModal = signal(false);
  readonly newStatus = signal<PqrStatus>('IN_PROGRESS');
  readonly resolutionSummary = signal('');

  readonly statusOptions = STATUS_OPTIONS;
  readonly id = computed(() => Number(this.route.snapshot.paramMap.get('id')));

  readonly canSubmitComment = computed(
    () => this.newComment().trim().length >= 2 && !this.submitting(),
  );

  readonly currentNotifyDefault = computed(() => !this.isInternal());

  constructor() {
    // Watch the route id and reload.
    effect(() => {
      const id = this.id();
      if (id) this.fetch(id);
    });
  }

  typeLabel(type: string): string {
    return (
      { PETITION: 'Petición', COMPLAINT: 'Queja', CLAIM: 'Reclamo' } as Record<
        string,
        string
      >
    )[type] ?? type;
  }

  onIsInternalChange(value: boolean) {
    this.isInternal.set(value);
    // When toggling to public, default notify=true so the requester gets
    // the comment. When toggling to internal, default notify=false unless
    // the operator explicitly checked the box.
    if (!value) {
      this.notifyRequester.set(true);
    } else {
      this.notifyRequester.set(false);
    }
  }

  openStatusModal() {
    const current = this.detail()?.status;
    if (current) this.newStatus.set(current === 'NEW' ? 'IN_PROGRESS' : current);
    this.resolutionSummary.set('');
    this.showStatusModal.set(true);
  }

  closeStatusModal() {
    this.showStatusModal.set(false);
  }

  confirmStatusChange() {
    const detail = this.detail();
    if (!detail) return;
    const target = this.newStatus();
    const isTerminal =
      target === 'RESOLVED' || target === 'CLOSED';

    const dto: PqrStatusUpdateDto = {
      status: target,
      resolution_summary: isTerminal
        ? this.resolutionSummary().trim() || undefined
        : undefined,
    };
    this.submitting.set(true);
    this.adminService.updateStatus(detail.id, dto).subscribe({
      next: (res) => {
        if (res.success) {
          this.showStatusModal.set(false);
          this.fetch(detail.id);
        }
        this.submitting.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          err?.error?.message ?? 'No se pudo actualizar el estado.',
        );
        this.submitting.set(false);
      },
    });
  }

  submitComment() {
    const detail = this.detail();
    const content = this.newComment().trim();
    if (!detail || content.length < 2) return;

    const dto: PqrCommentCreateDto = {
      content,
      is_internal: this.isInternal(),
      notify_requester: this.isInternal() ? this.notifyRequester() : true,
    };
    this.submitting.set(true);
    this.adminService.addComment(detail.id, dto).subscribe({
      next: () => {
        this.newComment.set('');
        this.fetch(detail.id);
        this.submitting.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          err?.error?.message ?? 'No se pudo agregar el comentario.',
        );
        this.submitting.set(false);
      },
    });
  }

  goBack() {
    this.router.navigate(['/admin/pqrs']);
  }

  private fetch(id: number) {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.adminService.getById(id).subscribe({
      next: (res) => {
        if (res.success) this.detail.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(
          err?.error?.message ?? 'No se pudo cargar el PQR.',
        );
        this.loading.set(false);
      },
    });
  }
}