import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrmService } from '../../services/crm.service';
import { CrmLandingState, CrmGenerationStatus } from '../../models/crm.model';
import { ToastService } from '../../../../../../shared/components';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components';

const STATUS_LABELS: Record<CrmGenerationStatus, string> = {
  idle: 'Sin generar',
  pending: 'En cola',
  generating: 'Generando con IA',
  ready: 'Lista',
  failed: 'Error en la generación',
};

@Component({
  selector: 'app-crm-main-page',
  imports: [CommonModule, IconComponent, ButtonComponent],
  templateUrl: './crm-main-page.component.html',
  styleUrl: './crm-main-page.component.scss',
})
export class CrmMainPageComponent {
  private readonly crmService = inject(CrmService);
  private readonly toast = inject(ToastService);

  readonly landing = signal<CrmLandingState | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);

  readonly statusLabel = computed(() => {
    const landing = this.landing();
    if (!landing) return '';
    return STATUS_LABELS[landing.generation_status] ?? landing.generation_status;
  });

  readonly hasDraft = computed(() => {
    const landing = this.landing();
    return !!landing?.content_json;
  });

  constructor() {
    this.loadLanding();
  }

  loadLanding(): void {
    this.loading.set(true);
    this.crmService.getLanding().subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.loading.set(false);
      },
      error: () => {
        this.toast.error('No pudimos cargar el estado del CRM');
        this.loading.set(false);
      },
    });
  }

  activate(): void {
    this.busy.set(true);
    this.crmService.activate().subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.busy.set(false);
        this.toast.success('CRM activado');
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('No pudimos activar el CRM');
      },
    });
  }

  deactivate(): void {
    this.busy.set(true);
    this.crmService.deactivate().subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.busy.set(false);
        this.toast.success('CRM desactivado');
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('No pudimos desactivar el CRM');
      },
    });
  }
}
