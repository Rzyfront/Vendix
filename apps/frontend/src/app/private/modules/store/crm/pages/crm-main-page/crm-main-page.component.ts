import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, switchMap, take, takeWhile } from 'rxjs';
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
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderTab,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { CrmEditorComponent } from '../crm-editor/crm-editor.component';

const STATUS_LABELS: Record<CrmGenerationStatus, string> = {
  idle: 'Sin generar',
  pending: 'En cola de generación',
  generating: 'Generando con IA…',
  ready: 'Lista y lista para publicar',
  failed: 'Generación manual requerida',
};

type CrmTab = 'estado' | 'diseno';

@Component({
  selector: 'app-crm-main-page',
  imports: [
    CommonModule,
    IconComponent,
    ButtonComponent,
    StickyHeaderComponent,
    CrmEditorComponent,
  ],
  templateUrl: './crm-main-page.component.html',
  styleUrl: './crm-main-page.component.scss',
})
export class CrmMainPageComponent {
  private readonly crmService = inject(CrmService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly landing = signal<CrmLandingState | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly tab = signal<CrmTab>('estado');
  /** Documento editado localmente aún no guardado. */
  readonly pendingDocument = signal<CrmLandingDocument | null>(null);

  readonly headerTabs = computed<StickyHeaderTab[]>(() => {
    const state = this.landing();
    return [
      {
        id: 'estado',
        label: 'Estado y Configuración',
        shortLabel: 'Estado',
        icon: 'activity',
        description: 'Supervisa el estado del CRM, versión del borrador y regeneración inteligente.',
      },
      {
        id: 'diseno',
        label: 'Editor y Diseño',
        shortLabel: 'Diseño',
        icon: 'palette',
        disabled: !state?.enabled,
        description: 'Edita los bloques visuales, textos, productos destacados y vista previa de tu landing.',
      },
    ];
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const currentTab = this.tab();
    const state = this.landing();
    const isBusy = this.busy();

    if (currentTab === 'estado') {
      if (!state?.enabled) {
        return [
          {
            id: 'activate',
            label: 'Activar CRM',
            variant: 'primary',
            icon: 'sparkles',
            loading: isBusy,
            disabled: isBusy,
          },
        ];
      }
      return [
        {
          id: 'regenerate',
          label: 'Regenerar con IA',
          variant: 'outline',
          icon: 'refresh-cw',
          loading: isBusy,
          disabled: isBusy,
        },
        {
          id: 'edit_design',
          label: 'Editar Landing',
          variant: 'primary',
          icon: 'edit-3',
          disabled: isBusy || (!this.hasDraft() && state.generation_status !== 'ready'),
        },
      ];
    }

    return [
      {
        id: 'discard',
        label: 'Descartar',
        variant: 'ghost',
        icon: 'rotate-ccw',
        disabled: isBusy || !this.pendingDocument(),
      },
      {
        id: 'save_draft',
        label: 'Guardar Borrador',
        variant: 'outline',
        icon: 'save',
        loading: isBusy,
        disabled: isBusy,
      },
      {
        id: 'publish',
        label: 'Publicar Landing',
        variant: 'primary',
        icon: 'globe',
        loading: isBusy,
        disabled: isBusy,
      },
    ];
  });

  readonly statusLabel = computed(() => {
    const landing = this.landing();
    if (!landing) return '';
    return (
      STATUS_LABELS[landing.generation_status] ?? landing.generation_status
    );
  });

  readonly hasDraft = computed(() => !!this.landing()?.content_json);

  /** Documento que alimenta el editor: proviene exclusivamente del backend tras cargar/guardar/publicar. */
  readonly serverDocument = computed<CrmLandingDocument | null>(() => {
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

  onHeaderAction(actionId: string): void {
    switch (actionId) {
      case 'activate':
        this.activate();
        break;
      case 'regenerate':
        this.regenerate();
        break;
      case 'edit_design':
        this.setTab('diseno');
        break;
      case 'discard':
        this.loadLanding();
        break;
      case 'save_draft':
        this.saveDraft();
        break;
      case 'publish':
        this.publish();
        break;
    }
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
    const doc = this.pendingDocument() ?? this.serverDocument();
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
    this.busy.set(true);
    const pending = this.pendingDocument();
    if (pending) {
      // Guardar y publicar en dos pasos explícitos: primero persistir.
      this.crmService.saveDraft(pending).subscribe({
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
        this.toast.success('¡Landing publicada con éxito! Abriendo en nueva pestaña…');
        this.openPublicLanding();
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('No pudimos publicar la landing');
      },
    });
  }

  openPublicLanding(): void {
    window.open('/', '_blank', 'noopener,noreferrer');
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
   * termina cuando el estado deja de ser pending/generating, tras ~2 min
   * (presupuesto mayor al retry del backend), o al desmontar el componente.
   */
  private pollGeneration(jobId?: string | null): void {
    if (!jobId) {
      this.loadLanding();
      return;
    }
    interval(3000)
      .pipe(
        take(40),
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.crmService.getGenerationJobStatus(jobId)),
        takeWhile((res) => {
          const status = res.data?.status;
          return status !== 'completed' && status !== 'failed';
        }, true),
      )
      .subscribe({
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
          }
        },
        error: () => this.loadLanding(),
      });
  }

  regenerate(): void {
    // Reusar activate: es idempotente y re-encola la generación.
    this.activate();
  }
}
