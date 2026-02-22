import { Component, OnInit, OnDestroy, inject, computed, signal } from '@angular/core';
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
} from '../../../../../../../../src/app/shared/components';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { SupportService } from '../../services/support.service';
import { AuthFacade } from '../../../../../../../../src/app/core/store/auth/auth.facade';
import {
  Ticket,
  TicketStatus,
  TicketPriority,
} from '../../interfaces/ticket.interface';

@Component({
  selector: 'app-superadmin-ticket-detail',
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
    <div class="min-h-screen bg-background" *ngIf="!loading; else loadingTemplate">
      <!-- Sticky Header -->
      <app-sticky-header
        [title]="ticket()?.title || 'Ticket'"
        [subtitle]="ticket()?.ticket_number || ''"
        icon="ticket"
        [showBackButton]="true"
        backRoute="/super-admin/support"
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
                    *ngFor="let attachment of ticket()?.attachments"
                    class="relative aspect-square rounded-lg border border-border overflow-hidden cursor-pointer hover:border-primary transition-colors"
                    (click)="openAttachment(attachment)"
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
                <h2 class="text-lg font-semibold text-text-primary">Comentarios ({{ ticket()?.comments?.length || 0 }})</h2>
              </div>

              <div class="p-4 space-y-4">
                <!-- Comments List -->
                <div *ngFor="let comment of ticket()?.comments" class="flex gap-3">
                  <!-- Avatar -->
                  <div class="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <span class="text-sm font-semibold text-primary">
                      {{ comment.author?.first_name?.[0] || '?' }}{{ comment.author?.last_name?.[0] || '' }}
                    </span>
                  </div>

                  <!-- Comment Content -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-sm font-semibold text-text-primary">
                        {{ comment.author?.first_name }} {{ comment.author?.last_name }}
                      </span>
                      <span *ngIf="comment.is_internal" class="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">Interno</span>
                      <span class="text-xs text-text-secondary">{{ formatDate(comment.created_at) }}</span>
                    </div>
                    <p class="text-sm text-text-secondary whitespace-pre-wrap">{{ comment.content }}</p>
                  </div>
                </div>

                <!-- Empty State -->
                <div *ngIf="!ticket()?.comments || ticket()?.comments?.length === 0" class="text-center py-8">
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
                  <dt class="text-text-secondary">Creado por</dt>
                  <dd class="text-text-primary">{{ ticket()?.created_by?.first_name }} {{ ticket()?.created_by?.last_name }}</dd>
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
              [disabled]="!commentForm.get('content')?.value || sendingComment"
              [loading]="sendingComment"
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
    </div>

    <!-- Loading Template -->
    <ng-template #loadingTemplate>
      <div class="min-h-screen flex items-center justify-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    </ng-template>

    <!-- Status Change Modal -->
    <app-modal
      [isOpen]="showStatusModal()"
      [title]="'Cambiar Estado'"
      [subtitle]="'Selecciona el nuevo estado del ticket'"
      (cancel)="closeStatusModal()"
    >
      <form [formGroup]="statusForm" class="space-y-4">
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-2">Nuevo Estado</label>
          <select
            formControlName="status"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
          >
            <option value="">Seleccionar...</option>
            <option [value]="TicketStatus.NEW">Nuevo</option>
            <option [value]="TicketStatus.OPEN">Abierto</option>
            <option [value]="TicketStatus.IN_PROGRESS">En Progreso</option>
            <option [value]="TicketStatus.WAITING_RESPONSE">Esperando Respuesta</option>
            <option [value]="TicketStatus.RESOLVED">Resuelto</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-2">Notas (opcional)</label>
          <textarea
            formControlName="notes"
            class="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            rows="3"
            placeholder="Agrega notas sobre este cambio..."
          ></textarea>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (click)="closeStatusModal()" size="sm">
          Cancelar
        </app-button>
        <app-button variant="primary" (click)="updateStatus()" size="sm">
          Actualizar
        </app-button>
      </div>
    </app-modal>

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
        <app-button variant="danger" (click)="closeTicket()" size="sm">
          Cerrar Ticket
        </app-button>
      </div>
    </app-modal>

    <!-- Image Lightbox -->
    <app-image-lightbox [currentImage]="lightboxCurrentImage" [isOpen]="lightboxOpen" (close)="closeLightbox()"></app-image-lightbox>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class SuperadminTicketDetailComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private supportService = inject(SupportService);
  private toastService = inject(ToastService);
  private fb = inject(FormBuilder);
  private authFacade = inject(AuthFacade);

  // State
  ticket = signal<Ticket | null>(null);
  loading = true;
  sendingComment = false;
  lightboxOpen = false;
  lightboxCurrentImage = '';

  // Modals
  showStatusModal = signal(false);
  showCloseModal = signal(false);

  // Forms
  commentForm: FormGroup;
  statusForm: FormGroup;
  closeForm: FormGroup;

  // Enums
  TicketStatus = TicketStatus;
  TicketPriority = TicketPriority;

  private destroy$ = new Subject<void>();

  constructor() {
    this.commentForm = this.fb.group({
      content: ['', Validators.required],
    });

    this.statusForm = this.fb.group({
      status: [''],
      notes: [''],
    });

    this.closeForm = this.fb.group({
      resolution_summary: [''],
    });
  }

  ngOnInit(): void {
    this.loadTicket();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTicket(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.toastService.error('ID de ticket no proporcionado');
      this.goBack();
      return;
    }

    this.supportService.getTicketById(+id).pipe(
      takeUntil(this.destroy$),
      finalize(() => this.loading = false)
    ).subscribe({
      next: (data) => {
        this.ticket.set(data);
      },
      error: (err: any) => {
        console.error('Error loading ticket:', err);
        this.toastService.error('Error al cargar el ticket');
      },
    });
  }

  submitComment(): void {
    if (this.commentForm.invalid || this.sendingComment) {
      return;
    }

    const content = this.commentForm.get('content')?.value;
    const ticketId = this.ticket()?.id;

    if (!ticketId) {
      this.toastService.error('No hay ticket seleccionado');
      return;
    }

    this.sendingComment = true;

    this.supportService.addComment(ticketId, content, false).pipe(
      finalize(() => this.sendingComment = false)
    ).subscribe({
      next: () => {
        this.toastService.success('Comentario agregado');
        this.commentForm.reset();
        this.loadTicket();
      },
      error: (err: any) => {
        console.error('Error adding comment:', err);
        this.toastService.error('Error al agregar comentario');
      },
    });
  }

  openStatusModal(): void {
    this.showStatusModal.set(true);
  }

  closeStatusModal(): void {
    this.showStatusModal.set(false);
  }

  openCloseModal(): void {
    this.showCloseModal.set(true);
  }

  closeCloseModal(): void {
    this.showCloseModal.set(false);
  }

  updateStatus(): void {
    const { status, notes } = this.statusForm.value;
    if (!status) {
      this.toastService.error('Selecciona un estado');
      return;
    }

    const ticketId = this.ticket()?.id;
    if (!ticketId) return;

    this.supportService.updateTicketStatus(ticketId, { status, reason: notes }).subscribe({
      next: () => {
        this.toastService.success('Estado actualizado');
        this.closeStatusModal();
        this.statusForm.reset();
        this.loadTicket();
      },
      error: (err: any) => {
        console.error('Error updating status:', err);
        this.toastService.error('Error al actualizar el estado');
      },
    });
  }

  closeTicket(): void {
    const ticketId = this.ticket()?.id;
    if (!ticketId) return;

    const { resolution_summary } = this.closeForm.value;

    this.supportService.closeTicket(ticketId, { resolution_summary }).subscribe({
      next: () => {
        this.toastService.success('Ticket cerrado');
        this.closeCloseModal();
        this.closeForm.reset();
        this.loadTicket();
      },
      error: (err: any) => {
        console.error('Error closing ticket:', err);
        this.toastService.error('Error al cerrar el ticket');
      },
    });
  }

  openAttachment(attachment: any): void {
    if (attachment.file_type === 'IMAGE') {
      this.lightboxCurrentImage = attachment.file_url;
      this.lightboxOpen = true;
    } else {
      window.open(attachment.file_url, '_blank');
    }
  }

  closeLightbox(): void {
    this.lightboxOpen = false;
    this.lightboxCurrentImage = '';
  }

  goBack(): void {
    this.router.navigate(['/super-admin/support']);
  }

  isSuperAdmin = computed(() => {
    const roles = this.authFacade.getRoles() as string[];
    return roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
  });

  canUpdateStatus(): boolean {
    return this.isSuperAdmin() && this.ticket()?.status !== TicketStatus.CLOSED;
  }

  canCloseTicket(): boolean {
    return this.isSuperAdmin() && this.ticket()?.status !== TicketStatus.CLOSED;
  }

  // Header methods
  headerBadgeText = computed(() => {
    const currentTicket = this.ticket();
    return this.getStatusLabel(currentTicket?.status);
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

    if (this.canUpdateStatus()) {
      actions.push({
        id: 'changeStatus',
        label: 'Cambiar Estado',
        variant: 'secondary',
        icon: 'refresh-cw',
      });
    }

    if (this.canCloseTicket()) {
      actions.push({
        id: 'close',
        label: 'Cerrar Ticket',
        variant: 'primary',
        icon: 'check-circle',
      });
    }

    return actions;
  });

  onHeaderAction(actionId: string): void {
    if (actionId === 'changeStatus') {
      this.openStatusModal();
    } else if (actionId === 'close') {
      this.openCloseModal();
    }
  }

  isOverdue(): boolean {
    const deadline = this.ticket()?.sla_deadline;
    if (!deadline) return false;
    return new Date(deadline) < new Date();
  }

  getStatusLabel(status?: TicketStatus): string {
    const labels: Record<TicketStatus, string> = {
      [TicketStatus.NEW]: 'Nuevo',
      [TicketStatus.OPEN]: 'Abierto',
      [TicketStatus.IN_PROGRESS]: 'En Progreso',
      [TicketStatus.WAITING_RESPONSE]: 'Esperando',
      [TicketStatus.RESOLVED]: 'Resuelto',
      [TicketStatus.CLOSED]: 'Cerrado',
      [TicketStatus.REOPENED]: 'Reabierto',
    };
    return labels[status || TicketStatus.NEW] || status || 'Nuevo';
  }

  getStatusBadgeClass(status?: TicketStatus): string {
    const classes: Record<TicketStatus, string> = {
      [TicketStatus.NEW]: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      [TicketStatus.OPEN]: 'bg-green-100 text-green-700 border-green-200',
      [TicketStatus.IN_PROGRESS]: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      [TicketStatus.WAITING_RESPONSE]: 'bg-orange-100 text-orange-700 border-orange-200',
      [TicketStatus.RESOLVED]: 'bg-teal-100 text-teal-700 border-teal-200',
      [TicketStatus.CLOSED]: 'bg-gray-100 text-gray-700 border-gray-200',
      [TicketStatus.REOPENED]: 'bg-red-100 text-red-700 border-red-200',
    };
    return classes[status || TicketStatus.NEW] || 'bg-gray-100 text-gray-700';
  }

  getPriorityLabel(priority?: TicketPriority): string {
    const labels: Record<TicketPriority, string> = {
      [TicketPriority.P0]: 'Crítica',
      [TicketPriority.P1]: 'Urgente',
      [TicketPriority.P2]: 'Alta',
      [TicketPriority.P3]: 'Normal',
      [TicketPriority.P4]: 'Baja',
    };
    return labels[priority || TicketPriority.P3] || 'Normal';
  }

  getPriorityBadgeClass(priority?: TicketPriority): string {
    const classes: Record<TicketPriority, string> = {
      [TicketPriority.P0]: 'bg-red-100 text-red-700 border-red-200',
      [TicketPriority.P1]: 'bg-orange-100 text-orange-700 border-orange-200',
      [TicketPriority.P2]: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      [TicketPriority.P3]: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      [TicketPriority.P4]: 'bg-gray-100 text-gray-700 border-gray-200',
    };
    return classes[priority || TicketPriority.P3] || 'bg-gray-100';
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
}
