import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { CommonModule } from '@angular/common';
import {
  CRM_LANDING_RESUME_KEY,
  CrmService,
} from '../../services/crm.service';
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
import { AiScanJobService } from '../../../../../../core/services/ai-scan-job.service';
import { AiJobProgressComponent } from '../../../../../../shared/components/ai-job-progress/ai-job-progress.component';
import { injectAiJobProgress } from '../../../../../../shared/utils/ai-job-progress';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
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
    CrmEditorComponent,
    AiJobProgressComponent,
  ],
  templateUrl: './crm-main-page.component.html',
  styleUrl: './crm-main-page.component.scss',
})
export class CrmMainPageComponent {
  private readonly crmService = inject(CrmService);
  private readonly authFacade = inject(AuthFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly aiJobs = inject(AiScanJobService);

  /** Progress bar of the AI landing generation (QUI-1020). */
  readonly generationProgress = injectAiJobProgress({ kind: 'crm_landing' });
  private readonly resumeKey = CRM_LANDING_RESUME_KEY;

  readonly storeDomainHostname = this.authFacade.userDomainHostname;
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
        description: 'Supervisa el estado de la landing, versión del borrador y regeneración inteligente.',
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
            label: 'Activar landing',
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
    this.resumeGeneration();
  }

  setTab(tab: CrmTab): void {
    this.tab.set(tab);
  }

  discardChanges(): void {
    this.pendingDocument.set(null);
    this.loadLanding();
    this.toast.info('Borrador descartado');
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
        this.discardChanges();
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
        this.toast.error('No pudimos cargar el estado de la landing de captación');
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
    const hostname = this.storeDomainHostname();
    const targetUrl = hostname
      ? `https://${hostname}`
      : `${window.location.protocol}//${window.location.host}/landing`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }

  activate(): void {
    this.busy.set(true);
    this.waitForGeneration(
      this.aiJobs.enqueueAndWait<{ ready: boolean }>(
        this.crmService.activateUrl,
        {},
        {
          progress: this.generationProgress,
          resumeKey: this.resumeKey,
          statusUrl: (id) => this.crmService.generationStatusUrl(id),
          onEnqueued: (data) => {
            // The activate response is the landing state plus `job_id`.
            this.landing.set(data as unknown as CrmLandingState);
            this.busy.set(false);
            this.toast.success(
              'Landing de captación activada: generando tu landing…',
            );
          },
        },
      ),
    );
  }

  deactivate(): void {
    this.busy.set(true);
    this.crmService.deactivate().subscribe({
      next: (res) => {
        this.landing.set(res.data);
        this.busy.set(false);
        this.toast.success('Landing de captación desactivada');
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('No pudimos desactivar la landing de captación');
      },
    });
  }

  /** Re-attaches to a generation that kept running while the page was closed. */
  private resumeGeneration(): void {
    const resumed = this.aiJobs.resume<{ ready: boolean }>(this.resumeKey, {
      progress: this.generationProgress,
      statusUrl: (id) => this.crmService.generationStatusUrl(id),
    });
    if (resumed) this.waitForGeneration(resumed);
  }

  /** Reacts to the end of a generation; the bar and the retry live in the shared client. */
  private waitForGeneration(job$: Observable<{ ready: boolean }>): void {
    job$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.loadLanding();
        this.toast.success('¡Tu landing está lista!');
        this.tab.set('diseno');
      },
      error: () => {
        // The bar shows the categorized error with its retry button.
        this.busy.set(false);
        this.loadLanding();
      },
    });
  }

  regenerate(): void {
    // Reusar activate: es idempotente y re-encola la generación.
    this.activate();
  }
}
