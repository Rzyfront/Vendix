import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrmService } from '../../services/crm.service';
import {
  CrmLandingState,
  CrmGenerationStatus,
} from '../../models/crm.model';
import {
  CrmLandingDocument,
} from '../../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import { ToastService } from '../../../../../../shared/components';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components';
import { CrmEditorComponent } from '../crm-editor/crm-editor.component';

const STATUS_LABELS: Record<CrmGenerationStatus, string> = {
  idle: 'Sin generar',
  pending: 'En cola',
  generating: 'Generando con IA',
  ready: 'Lista',
  failed: 'Error en la generación',
};

type CrmTab = 'estado' | 'diseno';

@Component({
  selector: 'app-crm-main-page',
  imports: [CommonModule, IconComponent, ButtonComponent, CrmEditorComponent],
  templateUrl: './crm-main-page.component.html',
  styleUrl: './crm-main-page.component.scss',
})
export class CrmMainPageComponent {
  private readonly crmService = inject(CrmService);
  private readonly toast = inject(ToastService);

  readonly landing = signal<CrmLandingState | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly tab = signal<CrmTab>('estado');
  /** Documento editado localmente aún no guardado. */
  readonly pendingDocument = signal<CrmLandingDocument | null>(null);

  readonly statusLabel = computed(() => {
    const landing = this.landing();
    if (!landing) return '';
    return (
      STATUS_LABELS[landing.generation_status] ?? landing.generation_status
    );
  });

  readonly hasDraft = computed(() => !!this.landing()?.content_json);

  /** Documento que alimenta el editor: pendiente local o draft del backend. */
  readonly editorDocument = computed<CrmLandingDocument | null>(() => {
    const pending = this.pendingDocument();
    if (pending) return pending;
    const content = this.landing()?.content_json;
    if (content && typeof content === 'object') {
      return content as CrmLandingDocument;
    }
    return null;
  });

  constructor() {
    this.loadLanding();
  }

  setTab(tab: CrmTab): void {
    this.tab.set(tab);
  }

  loadLanding(): void {
    this.loading.set(true);
    this.crmService.getLanding().subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.pendingDocument.set(null);
        this.loading.set(false);
      },
      error: () => {
        this.toast.error('No pudimos cargar el estado del CRM');
        this.loading.set(false);
      },
    });
  }

  onDocumentChange(doc: CrmLandingDocument): void {
    this.pendingDocument.set(doc);
  }

  saveDraft(): void {
    const doc = this.pendingDocument() ?? this.editorDocument();
    if (!doc) return;
    this.busy.set(true);
    this.crmService.saveDraft(doc).subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.pendingDocument.set(null);
        this.busy.set(false);
        this.toast.success('Borrador guardado');
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('No pudimos guardar el borrador');
      },
    });
  }

  publish(): void {
    if (this.pendingDocument()) {
      // Guardar y publicar en dos pasos explícitos: primero persistir.
      this.crmService.saveDraft(this.pendingDocument()!).subscribe({
        next: (res) => {
          this.landing.set(res.data);
          this.pendingDocument.set(null);
          this.doPublish();
        },
        error: () => {
          this.busy.set(false);
          this.toast.error('No pudimos guardar el borrador antes de publicar');
        },
      });
      return;
    }
    this.doPublish();
  }

  private doPublish(): void {
    this.busy.set(true);
    this.crmService.publish().subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.busy.set(false);
        this.toast.success('Landing publicada');
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('No pudimos publicar la landing');
      },
    });
  }

  activate(): void {
    this.busy.set(true);
    this.crmService.activate().subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.busy.set(false);
        this.toast.success('CRM activado: generando tu landing…');
        this.pollGeneration(res.data.last_job_id);
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

  /**
   * Poll ligero del job de generación mientras la página está abierta:
   * termina cuando el estado deja de ser pending/generating o tras ~2 min
   * (presupuesto mayor al retry del backend).
   */
  private pollGeneration(jobId?: string | null, attempts = 0): void {
    if (!jobId || attempts > 40) {
      this.loadLanding();
      return;
    }
    setTimeout(() => {
      this.crmService.getGenerationJobStatus(jobId).subscribe({
        next: (res) => {
          const status = res.data?.status;
          if (status === 'completed' || status === 'failed') {
            this.loadLanding();
            if (status === 'completed') {
              this.toast.success('¡Tu landing está lista!');
              this.tab.set('diseno');
            } else {
              this.toast.error(
                res.data?.error || 'La generación terminó con error',
              );
            }
          } else {
            this.pollGeneration(jobId, attempts + 1);
          }
        },
        error: () => this.loadLanding(),
      });
    }, 3000);
  }

  regenerate(): void {
    // Reusar activate: es idempotente y re-encola la generación.
    this.activate();
  }
}
