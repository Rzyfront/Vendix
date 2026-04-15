import { Component, OnInit, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ConsultationsService } from './services/consultations.service';
import { ConsultationBooking } from './interfaces/consultation.interface';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { BadgeComponent, BadgeVariant } from '../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../shared/components/tooltip/tooltip.component';

@Component({
  selector: 'app-consultations',
  standalone: true,
  imports: [CommonModule, IconComponent, CardComponent, BadgeComponent, TooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-4 sm:p-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-lg font-bold" style="color: var(--color-text)">Consultas</h1>
          <p class="text-sm" style="color: var(--color-text-muted)">Gestion de consultas medicas y esteticas</p>
        </div>
        <div class="flex items-center gap-2">
          <input type="date"
                 class="px-3 py-2 rounded-lg text-sm border"
                 style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                 [value]="selectedDate()"
                 (change)="onDateChange($event)" />
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="flex gap-3 mb-6 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4 sm:overflow-visible">
        <app-card class="flex-shrink-0 w-40 sm:w-auto" [padding]="true" shadow="none" customClasses="!p-4">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--color-info-light, rgba(59,130,246,0.12))">
              <app-icon name="calendar" [size]="16" color="var(--color-info)"></app-icon>
            </div>
          </div>
          <p class="text-2xl font-bold" style="color: var(--color-text)">{{ statsTotal() }}</p>
          <p class="text-xs" style="color: var(--color-text-muted)">Total del dia</p>
        </app-card>
        <app-card class="flex-shrink-0 w-40 sm:w-auto" [padding]="true" shadow="none" customClasses="!p-4">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--color-warning-light, rgba(217,119,6,0.12))">
              <app-icon name="clock" [size]="16" color="var(--color-warning)"></app-icon>
            </div>
          </div>
          <p class="text-2xl font-bold" style="color: var(--color-text)">{{ statsPending() }}</p>
          <p class="text-xs" style="color: var(--color-text-muted)">Pendientes check-in</p>
        </app-card>
        <app-card class="flex-shrink-0 w-40 sm:w-auto" [padding]="true" shadow="none" customClasses="!p-4">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--color-primary-light, rgba(79,70,229,0.12))">
              <app-icon name="activity" [size]="16" color="var(--color-primary)"></app-icon>
            </div>
          </div>
          <p class="text-2xl font-bold" style="color: var(--color-text)">{{ statsInProgress() }}</p>
          <p class="text-xs" style="color: var(--color-text-muted)">En progreso</p>
        </app-card>
        <app-card class="flex-shrink-0 w-40 sm:w-auto" [padding]="true" shadow="none" customClasses="!p-4">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--color-success-light, rgba(22,163,74,0.12))">
              <app-icon name="check-circle" [size]="16" color="var(--color-success)"></app-icon>
            </div>
          </div>
          <p class="text-2xl font-bold" style="color: var(--color-text)">{{ statsCompleted() }}</p>
          <p class="text-xs" style="color: var(--color-text-muted)">Completadas</p>
        </app-card>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      } @else if (consultations().length === 0) {
        <!-- Empty state -->
        <app-card shadow="none" customClasses="text-center !py-12">
          <app-icon name="stethoscope" [size]="32" color="var(--color-text-muted)"></app-icon>
          <p class="text-sm mt-2" style="color: var(--color-text-muted)">No hay consultas para esta fecha</p>
        </app-card>
      } @else {
        <!-- Mobile: card layout -->
        <div class="sm:hidden space-y-2">
          @for (c of consultations(); track c.id) {
            <app-card shadow="none" customClasses="!p-4">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-semibold" style="color: var(--color-text)">
                  {{ c.customer.first_name }} {{ c.customer.last_name }}
                </span>
                <app-badge [variant]="getStatusBadgeVariant(c.status)" size="xs">
                  {{ getStatusLabel(c.status) }}
                </app-badge>
              </div>
              <div class="text-xs space-y-1" style="color: var(--color-text-muted)">
                <div class="flex items-center gap-1">
                  <app-icon name="clock" [size]="12"></app-icon>
                  {{ c.start_time.slice(0, 5) }} - {{ c.end_time.slice(0, 5) }}
                </div>
                <div class="flex items-center gap-1">
                  <app-icon name="package" [size]="12"></app-icon>
                  {{ c.product.name }}
                </div>
                @if (c.provider) {
                  <div class="flex items-center gap-1">
                    <app-icon name="user" [size]="12"></app-icon>
                    {{ c.provider.display_name }}
                  </div>
                }
                @if (c.submission?.ai_prediagnosis) {
                  <app-badge variant="service" size="xs">
                    <span class="inline-flex items-center gap-1">
                      <app-icon name="brain" [size]="10"></app-icon> Pre-diagnostico IA
                    </span>
                  </app-badge>
                }
              </div>
              <div class="flex gap-2 mt-3 pt-3" style="border-top: 1px solid var(--color-border)">
                @if (c.status === 'confirmed' && !c.checked_in_at) {
                  <app-tooltip content="Registrar llegada del paciente" position="top" size="sm">
                    <button class="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium text-white"
                            style="background: var(--color-warning)"
                            (click)="doCheckIn(c.id)">
                      <app-icon name="log-in" [size]="14"></app-icon> Check-in
                    </button>
                  </app-tooltip>
                }
                @if (c.status === 'confirmed' && c.checked_in_at) {
                  <app-tooltip content="Iniciar la consulta" position="top" size="sm">
                    <button class="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium text-white"
                            style="background: var(--color-info)"
                            (click)="doStart(c.id)">
                      <app-icon name="play" [size]="14"></app-icon> Iniciar
                    </button>
                  </app-tooltip>
                }
                @if (c.status === 'in_progress') {
                  <app-tooltip content="Abrir panel de atencion" position="top" size="sm">
                    <button class="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium text-white"
                            style="background: var(--color-primary)"
                            (click)="goToAttend(c.id)">
                      <app-icon name="stethoscope" [size]="14"></app-icon> Atender
                    </button>
                  </app-tooltip>
                }
                @if (c.status === 'completed') {
                  <app-tooltip content="Ver detalle de la consulta" position="top" size="sm">
                    <button class="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium"
                            style="color: var(--color-text-muted); background: var(--color-surface-secondary)"
                            (click)="goToAttend(c.id)">
                      <app-icon name="eye" [size]="14"></app-icon> Ver
                    </button>
                  </app-tooltip>
                }
              </div>
            </app-card>
          }
        </div>

        <!-- Desktop: table layout -->
        <app-card class="hidden sm:block" shadow="none" [padding]="false" overflow="hidden">
          <table class="w-full text-sm">
            <thead>
              <tr style="background: var(--color-surface-secondary)">
                <th class="text-left px-4 py-3 text-xs font-medium" style="color: var(--color-text-muted)">Hora</th>
                <th class="text-left px-4 py-3 text-xs font-medium" style="color: var(--color-text-muted)">Paciente</th>
                <th class="text-left px-4 py-3 text-xs font-medium" style="color: var(--color-text-muted)">Servicio</th>
                <th class="text-left px-4 py-3 text-xs font-medium" style="color: var(--color-text-muted)">Proveedor</th>
                <th class="text-left px-4 py-3 text-xs font-medium" style="color: var(--color-text-muted)">Estado</th>
                <th class="text-right px-4 py-3 text-xs font-medium" style="color: var(--color-text-muted)">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (c of consultations(); track c.id) {
                <tr class="border-t" style="border-color: var(--color-border); background: var(--color-surface)">
                  <td class="px-4 py-3 whitespace-nowrap" style="color: var(--color-text)">
                    {{ c.start_time.slice(0, 5) }}
                  </td>
                  <td class="px-4 py-3" style="color: var(--color-text)">
                    <div class="font-medium">{{ c.customer.first_name }} {{ c.customer.last_name }}</div>
                    @if (c.submission?.ai_prediagnosis) {
                      <app-badge variant="service" size="xs" class="mt-0.5">
                        <span class="inline-flex items-center gap-1">
                          <app-icon name="brain" [size]="10"></app-icon> IA
                        </span>
                      </app-badge>
                    }
                  </td>
                  <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ c.product.name }}</td>
                  <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ c.provider?.display_name || '-' }}</td>
                  <td class="px-4 py-3">
                    <app-badge [variant]="getStatusBadgeVariant(c.status)" size="xs">
                      {{ getStatusLabel(c.status) }}
                    </app-badge>
                  </td>
                  <td class="px-4 py-3 text-right">
                    @if (c.status === 'confirmed' && !c.checked_in_at) {
                      <app-tooltip content="Registrar llegada del paciente" position="top" size="sm">
                        <button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                                style="background: var(--color-warning)"
                                (click)="doCheckIn(c.id)">
                          <app-icon name="log-in" [size]="14"></app-icon> Check-in
                        </button>
                      </app-tooltip>
                    }
                    @if (c.status === 'confirmed' && c.checked_in_at) {
                      <app-tooltip content="Iniciar la consulta" position="top" size="sm">
                        <button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                                style="background: var(--color-info)"
                                (click)="doStart(c.id)">
                          <app-icon name="play" [size]="14"></app-icon> Iniciar
                        </button>
                      </app-tooltip>
                    }
                    @if (c.status === 'in_progress') {
                      <app-tooltip content="Abrir panel de atencion" position="top" size="sm">
                        <button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                                style="background: var(--color-primary)"
                                (click)="goToAttend(c.id)">
                          <app-icon name="stethoscope" [size]="14"></app-icon> Atender
                        </button>
                      </app-tooltip>
                    }
                    @if (c.status === 'completed') {
                      <app-tooltip content="Ver detalle de la consulta" position="top" size="sm">
                        <button class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
                                style="color: var(--color-text-muted); background: var(--color-surface-secondary)"
                                (click)="goToAttend(c.id)">
                          <app-icon name="eye" [size]="14"></app-icon> Ver
                        </button>
                      </app-tooltip>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </app-card>
      }
    </div>
  `,
})
export class ConsultationsComponent implements OnInit {
  private consultationsService = inject(ConsultationsService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  consultations = signal<ConsultationBooking[]>([]);
  loading = signal(true);
  selectedDate = signal(this.getTodayDate());

  statsTotal = computed(() => this.consultations().length);
  statsPending = computed(() =>
    this.consultations().filter(c => (c.status === 'confirmed' || c.status === 'pending') && !c.checked_in_at).length
  );
  statsInProgress = computed(() =>
    this.consultations().filter(c => c.status === 'in_progress').length
  );
  statsCompleted = computed(() =>
    this.consultations().filter(c => c.status === 'completed').length
  );

  ngOnInit() {
    this.loadConsultations();
  }

  loadConsultations() {
    this.loading.set(true);
    this.consultationsService.getToday(this.selectedDate()).subscribe({
      next: (data) => {
        this.consultations.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  onDateChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedDate.set(input.value);
    this.loadConsultations();
  }

  doCheckIn(bookingId: number) {
    this.consultationsService.checkIn(bookingId).subscribe({
      next: () => {
        this.toastService.success('Check-in realizado');
        this.loadConsultations();
      },
      error: (err) => this.toastService.error(extractApiErrorMessage(err)),
    });
  }

  doStart(bookingId: number) {
    this.consultationsService.start(bookingId).subscribe({
      next: () => {
        this.toastService.success('Consulta iniciada');
        this.loadConsultations();
      },
      error: (err) => this.toastService.error(extractApiErrorMessage(err)),
    });
  }

  goToAttend(bookingId: number) {
    this.router.navigate(['/admin/consultations', bookingId, 'attend']);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      in_progress: 'En progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No asistio',
    };
    return labels[status] || status;
  }

  getStatusBadgeVariant(status: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      pending: 'warning',
      confirmed: 'info',
      in_progress: 'primary',
      completed: 'success',
      cancelled: 'error',
      no_show: 'neutral',
    };
    return variants[status] || 'neutral';
  }

  private getTodayDate(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
