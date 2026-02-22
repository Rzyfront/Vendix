import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil, finalize } from 'rxjs';
import {
  IconComponent,
  ModalComponent,
  ToastService,
  ImageLightboxComponent,
  ButtonComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../../shared/components';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { SupportService } from '../../services/support.service';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import {
  Ticket,
  TicketComment,
  TicketAttachment,
  TicketStatus,
  TicketPriority,
} from '../../models/ticket.model';

@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IconComponent,
    ModalComponent,
    ImageLightboxComponent,
    ButtonComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="min-h-screen bg-background">
      <!-- Loading State -->
      @if (loading()) {
        <div class="flex justify-center items-center h-64">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      }

      <!-- Content when loaded -->
      @if (ticket(); as ticketData) {
        <app-sticky-header
          [title]="ticket()?.title || 'Ticket'"
          [subtitle]="ticket()?.ticket_number || ''"
          icon="ticket"
          [showBackButton]="true"
          backRoute="/admin/settings/support"
          [badgeText]="headerBadgeText()"
          [badgeColor]="headerBadgeColor()"
          [actions]="headerActions()"
          (actionClicked)="onHeaderAction($event)"
        ></app-sticky-header>

        <!-- Main Content -->
        <div class="px-4 py-6 md:px-6 md:py-8 max-w-7xl mx-auto">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Left Column - Description and Comments -->
            <div class="lg:col-span-2 space-y-6">
              <!-- Description Card -->
              <div class="bg-surface rounded-lg border border-border p-6 shadow-sm">
                <h2 class="text-lg font-semibold text-text-primary mb-4">Descripción</h2>
                <p class="text-text-secondary whitespace-pre-wrap">{{ ticket()?.description }}</p>

                <!-- Attachments -->
                <div *ngIf="(ticket()?.attachments?.length || 0) > 0" class="mt-6">
                  <h3 class="text-sm font-semibold text-text-primary mb-3">Archivos adjuntos</h3>
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div
                      *ngFor="let attachment of ticket()?.attachments; let i = index"
                      class="relative aspect-square rounded-lg border border-border overflow-hidden cursor-pointer hover:border-primary transition-colors"
                      (click)="openLightbox(i)"
                    >
                      <img
                        *ngIf="attachment.file_type === 'IMAGE'"
                        [src]="attachment.thumbnail_url || attachment.file_url"
                        [alt]="attachment.file_name"
                        class="w-full h-full object-cover"
                      />
                      <div
                        *ngIf="attachment.file_type !== 'IMAGE'"
                        class="flex items-center justify-center h-full bg-gray-100"
                      >
                        <app-icon name="file" [size]="32" class="text-gray-400"></app-icon>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Comments Timeline -->
              <div class="bg-surface rounded-lg border border-border shadow-sm">
                <div class="p-4 border-b border-border">
                  <h2 class="text-lg font-semibold text-text-primary">Comentarios ({{ comments().length }})</h2>
                </div>

                <div class="p-4 space-y-4">
                  <!-- Comments List -->
                  <div *ngFor="let comment of sortedComments()" class="flex gap-3">
                    <!-- Avatar -->
                    <div class="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span class="text-sm font-semibold text-primary">
                        {{ getCommentInitials(comment) }}
                      </span>
                    </div>

                    <!-- Comment Content -->
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-sm font-semibold text-text-primary">
                          {{ comment.is_internal ? 'Soporte' : getCommentAuthorName(comment) }}
                        </span>
                        <span *ngIf="comment.is_internal" class="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">Interno</span>
                        <span class="text-xs text-text-secondary">{{ formatCommentDate(comment.created_at) }}</span>
                      </div>
                      <p class="text-sm text-text-secondary whitespace-pre-wrap">{{ comment.content }}</p>
                    </div>
                  </div>

                  <!-- Empty State -->
                  <div *ngIf="comments().length === 0" class="text-center py-8">
                    <app-icon name="message-square" [size]="48" class="text-gray-300 mx-auto mb-3"></app-icon>
                    <p class="text-text-secondary">No hay comentarios aún</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Column - Info -->
            <div class="space-y-6">
              <!-- Details Card -->
              <div class="bg-surface rounded-lg border border-border p-6 shadow-sm">
                <h2 class="text-lg font-semibold text-text-primary mb-4">Detalles</h2>
                <dl class="space-y-3 text-sm">
                  <div class="flex justify-between">
                    <dt class="text-text-secondary">Categoría</dt>
                    <dd class="text-text-primary font-medium">{{ getCategoryLabel(ticket()?.category) }}</dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="text-text-secondary">Prioridad</dt>
                    <dd>
                      <span [ngClass]="getPriorityBadgeClass(ticket()?.priority)" class="px-2 py-0.5 rounded text-xs font-semibold border">
                        {{ getPriorityLabel(ticket()?.priority) }}
                      </span>
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="text-text-secondary">Estado</dt>
                    <dd>
                      <span [ngClass]="getStatusBadgeClass(ticket()?.status)" class="px-2 py-0.5 rounded text-xs font-semibold border">
                        {{ getStatusLabel(ticket()?.status) }}
                      </span>
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="text-text-secondary">Asignado a</dt>
                    <dd class="text-text-primary">
                      {{ ticket()?.assigned_to?.first_name }} {{ ticket()?.assigned_to?.last_name || 'Sin asignar' }}
                    </dd>
                  </div>
                  <div class="flex justify-between" *ngIf="ticket()?.sla_deadline">
                    <dt class="text-text-secondary">SLA</dt>
                    <dd [class.text-red-600]="isOverdue()" class="text-text-primary">
                      {{ formatDate(ticket()?.sla_deadline) }}
                      <span *ngIf="isOverdue()" class="ml-1">(Vencido)</span>
                    </dd>
                  </div>
                </dl>
              </div>

              <!-- Need More Help -->
              <div class="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg border border-primary/20 p-6">
                <h3 class="font-semibold text-text-primary mb-2">¿Necesitas más ayuda?</h3>
                <p class="text-sm text-text-secondary mb-4">
                  Si tienes más preguntas o necesitas asistencia adicional, no dudes en contactar a soporte.
                </p>
                <app-button variant="outline" size="sm">
                  <app-icon name="help-circle" [size]="16" slot="icon"></app-icon>
                  Contactar Soporte
                </app-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Comment Form - Only if not closed -->
        <div *ngIf="ticket()?.status !== 'CLOSED'" class="border-t border-border bg-gray-50 p-4 shadow-sm">
          <form (ngSubmit)="submitComment()" [formGroup]="commentForm" class="max-w-7xl mx-auto">
            <div class="mb-3">
              <textarea
                formControlName="content"
                class="w-full bg-white border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary focus:border-transparent resize-none h-24"
                placeholder="Escribe un comentario..."
                rows="3"
              ></textarea>
            </div>
            <div class="flex justify-end">
              <app-button
                type="submit"
                variant="primary"
                [disabled]="!commentForm.get('content')?.value || sendingComment()"
                [loading]="sendingComment()"
                size="sm"
              >
                <app-icon name="send" [size]="14" slot="icon"></app-icon>
                Enviar
              </app-button>
            </div>
          </form>
        </div>

        <!-- Closed Message -->
        <div *ngIf="ticket()?.status === 'CLOSED'" class="border-t border-border bg-gray-50 p-4 shadow-sm">
          <div class="max-w-7xl mx-auto flex items-center gap-2 text-sm text-text-secondary">
            <app-icon name="info" [size]="16" class="text-gray-400"></app-icon>
            <span>Este ticket está cerrado. No se pueden agregar más comentarios.</span>
          </div>
        </div>
      }

    <!-- Loading Template -->
    <ng-template #loadingTemplate>
      <div class="min-h-screen flex items-center justify-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    </ng-template>

    <!-- Close Ticket Modal -->
    <app-modal
      [isOpen]="showCloseModal()"
      [title]="'Cerrar Ticket'"
      [subtitle]="'¿Estás seguro de que deseas cerrar este ticket?'"
      (cancel)="closeCloseModal()"
    >
      <p class="text-text-primary mb-4 text-sm">
        Una vez cerrado, el ticket será marcado como resuelto. Si necesitas ayuda adicional, puedes reabrir el ticket en cualquier momento.
      </p>

      <form [formGroup]="closeForm" class="space-y-4">
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-2">Resolución (opcional)</label>
          <textarea
            formControlName="resolution_summary"
            class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            rows="3"
            placeholder="Describe brevemente cómo se resolvió el problema..."
          ></textarea>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (click)="closeCloseModal()" size="sm">
          Cancelar
        </app-button>
        <app-button
          variant="danger"
          [disabled]="closingTicket()"
          [loading]="closingTicket()"
          (click)="closeTicket()"
          size="sm"
        >
          Cerrar Ticket
        </app-button>
      </div>
    </app-modal>

    <!-- Image Lightbox -->
    <app-image-lightbox
      [isOpen]="lightboxOpen()"
      [currentImage]="currentImage()"
      [alt]="currentAttachment()?.file_name || 'Imagen'"
      [currentIndex]="currentImageIndex()"
      [totalImages]="ticket()?.attachments?.length || 0"
      (close)="closeLightbox()"
      (previous)="previousImage()"
      (next)="nextImage()"
    ></app-image-lightbox>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class TicketDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private supportService = inject(SupportService);
  private toastService = inject(ToastService);
  private fb = inject(FormBuilder);
  private authFacade = inject(AuthFacade);

  ticket = signal<Ticket | null>(null);
  comments = signal<TicketComment[]>([]);
  loading = signal(false);
  sendingComment = signal(false);
  closingTicket = signal(false);
  showCloseModal = signal(false);

  lightboxOpen = signal(false);
  currentImageIndex = signal(0);
  currentImage = signal('');
  currentAttachment = signal<TicketAttachment | null>(null);

  commentForm: FormGroup;
  closeForm: FormGroup;

  private destroy$ = new Subject<void>();
  private ticketId = signal<number | null>(null);

  // Only SUPER_ADMIN can close tickets
  isSuperAdmin = computed(() => {
    const roles = this.authFacade.getRoles();
    return roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
  });

  constructor() {
    this.commentForm = this.fb.group({
      content: ['', Validators.required],
    });

    this.closeForm = this.fb.group({
      resolution_summary: [''],
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params: any) => {
      const id = params.get('id');
      if (id) {
        this.ticketId.set(+id);
        this.loadTicket(+id);
        this.loadComments(+id);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTicket(id: number) {
    this.loading.set(true);
    this.supportService
      .getTicketById(id)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (ticket: Ticket) => {
          this.ticket.set(ticket);
        },
        error: (err: any) => {
          console.error('Error loading ticket:', err);
          this.toastService.error('Error al cargar el ticket');
          this.goBack();
        },
      });
  }

  loadComments(id: number) {
    this.supportService.getComments(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (comments: TicketComment[]) => {
        this.comments.set(comments);
      },
      error: (err: any) => {
        console.error('Error loading comments:', err);
        this.toastService.error('Error al cargar comentarios');
      },
    });
  }

  submitComment() {
    if (!this.ticketId()) return;

    const contentControl = this.commentForm.get('content');
    const content = contentControl?.value;

    if (!content || !content.trim()) {
      this.toastService.error('El comentario no puede estar vacío');
      contentControl?.markAsTouched();
      return;
    }

    this.sendingComment.set(true);

    this.supportService
      .addComment(this.ticketId()!, content.trim(), false)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.sendingComment.set(false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success('Comentario agregado');
          this.commentForm.reset();
          this.loadComments(this.ticketId()!);
          this.loadTicket(this.ticketId()!); // Reload to update comments count
        },
        error: (err: any) => {
          console.error('Error adding comment:', err);
          this.toastService.error('Error al agregar comentario');
        },
      });
  }

  openCloseModal() {
    this.showCloseModal.set(true);
  }

  closeCloseModal() {
    this.showCloseModal.set(false);
  }

  closeTicket() {
    if (!this.ticketId()) return;

    this.closingTicket.set(true);
    const { resolution_summary } = this.closeForm.value;

    this.supportService
      .closeTicket(this.ticketId()!, resolution_summary)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.closingTicket.set(false);
          this.showCloseModal.set(false);
        }),
      )
      .subscribe({
        next: () => {
          this.toastService.success('Ticket cerrado exitosamente');
          this.loadTicket(this.ticketId()!);
        },
        error: (err: any) => {
          console.error('Error closing ticket:', err);
          this.toastService.error('Error al cerrar ticket');
        },
      });
  }

  reopenTicket() {
    if (!this.ticketId()) return;

    this.supportService.reopenTicket(this.ticketId()!).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.toastService.success('Ticket reabierto');
        this.loadTicket(this.ticketId()!);
      },
      error: (err: any) => {
        console.error('Error reopening ticket:', err);
        this.toastService.error('Error al reabrir ticket');
      },
    });
  }

  openLightbox(index: number) {
    const attachments = this.ticket()?.attachments || [];
    if (attachments[index]) {
      this.currentImageIndex.set(index);
      this.currentAttachment.set(attachments[index]);
      this.currentImage.set(attachments[index].file_url || attachments[index].thumbnail_url || '');
      this.lightboxOpen.set(true);
    }
  }

  closeLightbox() {
    this.lightboxOpen.set(false);
  }

  previousImage() {
    const newIndex = this.currentImageIndex() - 1;
    if (newIndex >= 0) {
      this.openLightbox(newIndex);
    }
  }

  nextImage() {
    const attachments = this.ticket()?.attachments || [];
    const newIndex = this.currentImageIndex() + 1;
    if (newIndex < attachments.length) {
      this.openLightbox(newIndex);
    }
  }

  sortedComments() {
    return [...(this.comments() || [])].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }

  getCommentAuthorName(comment: TicketComment): string {
    // Si el autor es Super Admin, mostrar "Soporte" en lugar del nombre
    const firstName = comment.author?.first_name;
    const lastName = comment.author?.last_name;

    if (firstName === 'Super Admin' || (firstName === 'Super' && lastName === 'Admin')) {
      return 'Soporte';
    }

    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    }
    return comment.author_name || comment.author_email || 'Usuario';
  }

  getCommentInitials(comment: TicketComment): string {
    const name = comment.is_internal ? 'Soporte' : this.getCommentAuthorName(comment);
    const parts = name.split(' ').filter(p => p);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  goBack() {
    this.router.navigate(['../'], { relativeTo: this.route });
  }

  canCloseTicket(): boolean {
    // SOLO super_admin puede cerrar tickets
    return this.isSuperAdmin() && this.ticket()?.status !== 'CLOSED' && this.ticket()?.status !== 'RESOLVED';
  }

  canReopenTicket(): boolean {
    // SOLO super_admin puede reabrir tickets
    return this.isSuperAdmin() && (this.ticket()?.status === 'CLOSED' || this.ticket()?.status === 'RESOLVED');
  }

  // Header methods
  headerBadgeText = computed(() => {
    return this.getStatusLabel(this.ticket()?.status);
  });

  headerBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const status = this.ticket()?.status;
    const colorMap: Record<TicketStatus, StickyHeaderBadgeColor> = {
      NEW: 'blue',
      OPEN: 'green',
      IN_PROGRESS: 'yellow',
      WAITING_RESPONSE: 'yellow',
      RESOLVED: 'green',
      CLOSED: 'gray',
      REOPENED: 'red',
    };
    return colorMap[status as TicketStatus || TicketStatus.NEW] || 'blue';
  });

  headerActions = computed<StickyHeaderActionButton[]>(() => {
    const actions: StickyHeaderActionButton[] = [];

    if (this.canCloseTicket()) {
      actions.push({
        id: 'close',
        label: 'Cerrar Ticket',
        variant: 'primary',
        icon: 'check-circle',
      });
    }

    if (this.canReopenTicket()) {
      actions.push({
        id: 'reopen',
        label: 'Reabrir',
        variant: 'secondary',
        icon: 'rotate-ccw',
      });
    }

    return actions;
  });

  onHeaderAction(actionId: string): void {
    if (actionId === 'close') {
      this.openCloseModal();
    } else if (actionId === 'reopen') {
      this.reopenTicket();
    }
  }

  isOverdue(): boolean {
    const deadline = this.ticket()?.sla_deadline;
    if (!deadline) return false;
    return new Date(deadline) < new Date();
  }

  getStatusLabel(status?: TicketStatus): string {
    if (!status) return '-';
    const labels: Record<TicketStatus, string> = {
      NEW: 'Nuevo',
      OPEN: 'Abierto',
      IN_PROGRESS: 'En Progreso',
      WAITING_RESPONSE: 'Esperando',
      RESOLVED: 'Resuelto',
      CLOSED: 'Cerrado',
      REOPENED: 'Reabierto',
    };
    return labels[status] || status;
  }

  getStatusBadgeClass(status?: TicketStatus): string {
    if (!status) return 'bg-gray-100 text-gray-700 border-gray-200';
    const classes: Record<TicketStatus, string> = {
      NEW: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      OPEN: 'bg-green-100 text-green-700 border-green-200',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      WAITING_RESPONSE: 'bg-orange-100 text-orange-700 border-orange-200',
      RESOLVED: 'bg-teal-100 text-teal-700 border-teal-200',
      CLOSED: 'bg-gray-100 text-gray-700 border-gray-200',
      REOPENED: 'bg-red-100 text-red-700 border-red-200',
    };
    return classes[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  }

  getPriorityLabel(priority?: TicketPriority): string {
    if (!priority) return '-';
    const labels: Record<TicketPriority, string> = {
      P0: 'Crítica',
      P1: 'Urgente',
      P2: 'Alta',
      P3: 'Normal',
      P4: 'Baja',
    };
    return labels[priority] || priority;
  }

  getPriorityBadgeClass(priority?: TicketPriority): string {
    if (!priority) return 'bg-gray-100 text-gray-700 border-gray-200';
    const classes: Record<TicketPriority, string> = {
      P0: 'bg-red-100 text-red-700 border-red-200',
      P1: 'bg-orange-100 text-orange-700 border-orange-200',
      P2: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      P3: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      P4: 'bg-gray-100 text-gray-700 border-gray-200',
    };
    return classes[priority] || 'bg-gray-100 text-gray-700 border-gray-200';
  }

  getCategoryLabel(category?: string): string {
    if (!category) return 'General';
    const labels: Record<string, string> = {
      'INCIDENT': 'Incidente',
      'SERVICE_REQUEST': 'Solicitud de Servicio',
      'PROBLEM': 'Problema',
      'CHANGE': 'Cambio',
      'QUESTION': 'Consulta',
    };
    return labels[category] || category;
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatCommentDate(dateString?: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMinutes = Math.floor(diffTime / (1000 * 60));
        return diffMinutes <= 1 ? 'Ahora mismo' : `Hace ${diffMinutes} min`;
      }
      return `Hace ${diffHours}h`;
    }
    if (diffDays === 1) return 'Ayer';
    if (diffDays < 7) return `Hace ${diffDays} días`;

    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
    });
  }
}
