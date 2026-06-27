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
import { PqrDetail, PqrCommentCreateDto } from '../../models/pqr.model';
import { PqrStatusPillComponent } from '../../components/pqr-status-pill.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

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
  private readonly authFacade = inject(AuthFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly detail = signal<PqrDetail | null>(null);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly submitting = signal(false);

  // ── Content edit modal state (only available while status === 'NEW') ──
  readonly showEditModal = signal(false);
  readonly editTitle = signal('');
  readonly editDescription = signal('');
  readonly editRequesterFirstName = signal('');
  readonly editRequesterLastName = signal('');
  readonly editRequesterEmail = signal('');
  readonly editRequesterPhone = signal('');
  readonly editRequesterDocType = signal('');
  readonly editRequesterDocNum = signal('');
  readonly editSubmitting = signal(false);
  readonly editError = signal<string | null>(null);

  /** Edit button only shows while the ticket hasn't been picked up by the
   *  support team. Server enforces the same guard with SUP_PQR_006. */
  readonly canEditContent = computed(
    () => this.detail()?.status === 'NEW',
  );

  // ── Per-comment edit state ─────────────────────────────────────────
  readonly editingCommentId = signal<number | null>(null);
  readonly editCommentContent = signal('');
  readonly editCommentSaving = signal(false);
  readonly editCommentError = signal<string | null>(null);

  // Comment composer
  readonly newComment = signal('');
  readonly isInternal = signal(true);
  readonly notifyRequester = signal(false);

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

  /**
   * Renders a Colombian document type code (CC, CE, NIT, PA, …) into
   * a human-readable Spanish label. Unknown codes fall through to the
   * raw code so an unsupported value still renders something instead
   * of an empty string.
   */
  documentTypeLabel(code: string): string {
    const map: Record<string, string> = {
      CC: 'Cédula de ciudadanía',
      CE: 'Cédula de extranjería',
      NIT: 'NIT',
      PA: 'Pasaporte',
      TI: 'Tarjeta de identidad',
      RC: 'Registro civil',
    };
    return map[code.toUpperCase()] ?? code;
  }

  /**
   * Returns the requester name to display in the avatar + name block.
   * Falls back to "—" when the stored `name` is empty OR duplicates the
   * email (legacy data created via the public form when structured
   * name fields were not yet captured — the DTO stored the email as
   * the name fallback).
   */
  requesterDisplayName(): string {
    const d = this.detail();
    if (!d) return '';
    const name = (d.requester_name ?? '').trim();
    const email = (d.requester_email ?? '').trim();
    if (!name || name === email) return '';
    return name;
  }

  /**
   * Returns the 1–2 letter initials shown in the circular avatar.
   * Derives from the display name (preferred) or the email local-part
   * as a final fallback. Returns "?" when no source is available.
   */
  requesterInitials(): string {
    const d = this.detail();
    if (!d) return '?';
    const name = this.requesterDisplayName();
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    const email = (d.requester_email ?? '').trim();
    if (email) return email.slice(0, 1).toUpperCase();
    return '?';
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

  // ── Per-comment edit (only author can edit their own comment, AND
  //    only internal notes — public responses are immutable) ──────
  canEditComment(c: { author_id?: number; is_internal?: boolean }): boolean {
    const me = this.authFacade.userId();
    return !!me && c.author_id === me && c.is_internal === true;
  }

  startEditComment(c: { id: number; content: string }): void {
    this.editingCommentId.set(c.id);
    this.editCommentContent.set(c.content ?? '');
    this.editCommentError.set(null);
  }

  cancelEditComment(): void {
    if (this.editCommentSaving()) return;
    this.editingCommentId.set(null);
    this.editCommentContent.set('');
    this.editCommentError.set(null);
  }

  canSaveEditComment(): boolean {
    return (
      !this.editCommentSaving() &&
      this.editCommentContent().trim().length >= 2
    );
  }

  saveEditComment(commentId: number): void {
    if (!this.canSaveEditComment() || !this.detail()) return;
    const detailId = this.detail()!.id;
    this.editCommentSaving.set(true);
    this.editCommentError.set(null);
    this.adminService.editComment(detailId, commentId, {
      content: this.editCommentContent().trim(),
    }).subscribe({
      next: (res) => {
        if (!res?.success) return;
        this.editCommentSaving.set(false);
        this.editingCommentId.set(null);
        this.editCommentContent.set('');
        this.fetch(detailId);
      },
      error: (err) => {
        this.editCommentError.set(
          err?.error?.message ??
            'No se pudo guardar la edición del comentario.',
        );
        this.editCommentSaving.set(false);
      },
    });
  }

  goBack() {
    this.router.navigate(['/admin/pqrs']);
  }

  // ── Content edit (title / description / requester_*) ─────────────────
  /**
   * Opens the edit modal pre-filled with current values. Gated by
   * canEditContent so the button only shows while status === 'NEW'.
   */
  openEditModal(): void {
    const d = this.detail();
    if (!d || !this.canEditContent()) return;
    this.editTitle.set(d.title ?? '');
    this.editDescription.set(d.description ?? '');
    this.editRequesterFirstName.set(d.requester_first_name ?? '');
    this.editRequesterLastName.set(d.requester_last_name ?? '');
    this.editRequesterEmail.set(d.requester_email ?? '');
    this.editRequesterPhone.set(d.requester_phone ?? '');
    this.editRequesterDocType.set(d.requester_document_type ?? '');
    this.editRequesterDocNum.set(d.requester_document_num ?? '');
    this.editError.set(null);
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    if (this.editSubmitting()) return;
    this.showEditModal.set(false);
  }

  canSubmitEdit(): boolean {
    return (
      !this.editSubmitting() &&
      this.editTitle().trim().length >= 5 &&
      this.editDescription().trim().length >= 10
    );
  }

  submitEdit(): void {
    if (!this.canSubmitEdit() || !this.detail()) return;
    this.editSubmitting.set(true);
    this.editError.set(null);
    this.adminService
      .editContent(this.detail()!.id, {
        title: this.editTitle().trim(),
        description: this.editDescription().trim(),
        requester_first_name: this.editRequesterFirstName().trim() || undefined,
        requester_last_name: this.editRequesterLastName().trim() || undefined,
        requester_email: this.editRequesterEmail().trim() || undefined,
        requester_phone: this.editRequesterPhone().trim() || undefined,
        requester_document_type: this.editRequesterDocType() || undefined,
        requester_document_num: this.editRequesterDocNum().trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          if (!res?.success) return;
          this.editSubmitting.set(false);
          this.showEditModal.set(false);
          // Re-fetch so the detail page reflects the new values and
          // the History card shows the new audit row.
          this.fetch(this.detail()!.id);
        },
        error: (err) => {
          // Friendly Spanish messages — the backend's `devMessage` is
          // English and often cryptic (e.g. "PQR access denied"). Map
          // the most common cases to actionable copy the user can act
          // on without DevTools.
          const status = err?.status;
          const devMessage = err?.error?.message ?? '';
          let msg: string;
          if (status === 403) {
            msg =
              'No tienes permiso para editar esta solicitud. Pide al administrador del sistema que te asigne el permiso `store:support:pqr:update`.';
          } else if (
            status === 400 &&
            /SUP_PQR_006|status/i.test(devMessage)
          ) {
            msg =
              'Esta solicitud ya no se puede editar porque el equipo de soporte ya la tomó. Puedes dejar un comentario o contactar al equipo.';
          } else {
            msg = devMessage || 'No se pudo guardar la edición.';
          }
          this.editError.set(msg);
          this.editSubmitting.set(false);
        },
      });
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
          err?.error?.message ?? 'No se pudo cargar el PQRS.',
        );
        this.loading.set(false);
      },
    });
  }
}