import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  PaginationComponent,
  SelectorComponent,
  StickyHeaderComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { formatFileSize } from '../../../workflows/utils/workflow-labels.util';
import { DocumentsTabsComponent } from '../../components/documents-tabs.component';
import {
  PurgePreview,
  PurgeRun,
  RetentionPolicy,
  SUBJECT_TYPE_OPTIONS,
  subjectSingular,
} from '../../interfaces/document-library.interfaces';
import {
  DocumentsLibraryApiService,
  libraryErrorMessage,
} from '../../services/documents-library-api.service';

const RUNS_LIMIT = 10;
const ANY_SUBJECT = '';

/**
 * "Retención": how long each kind of document is kept after its dossier
 * closes, the preview of what the purge would delete, the manual run and the
 * reports of every run (scheduled or manual).
 */
@Component({
  selector: 'app-documents-retention-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    ModalComponent,
    PaginationComponent,
    EmptyStateComponent,
    DocumentsTabsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Documentos"
        subtitle="Políticas de retención y purga programada"
        icon="folder-open"
        variant="glass"
      />
      <app-documents-tabs active="retention" />

      <app-card [responsive]="true" [padding]="false" overflow="visible" class="mb-4 block">
        <div class="flex items-center justify-between gap-3 border-b border-border px-2 py-3 md:px-6 md:py-4">
          <h2 class="text-[13px] font-bold text-gray-600 md:text-lg md:font-semibold md:text-text-primary">
            Políticas ({{ policies().length }})
          </h2>
          <app-button variant="primary" size="sm" (clicked)="openPolicy(null)">
            <app-icon name="plus" [size]="14" slot="icon" />
            Nueva política
          </app-button>
        </div>
        @if (policies().length === 0) {
          <app-empty-state
            icon="archive"
            title="Aún no hay políticas"
            description="Define cuánto tiempo guardas cada tipo de documento después de que se cierra su expediente. Sin políticas no se purga nada."
            [showActionButton]="false"
          />
        } @else {
          <ul class="flex flex-col gap-2 p-3 md:p-4" data-testid="policies">
            @for (policy of policies(); track policy.id) {
              <li
                class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium text-text-primary">{{ policy.name }}</span>
                    <app-badge [variant]="policy.is_active ? 'success' : 'neutral'" size="xs">
                      {{ policy.is_active ? 'Activa' : 'Inactiva' }}
                    </app-badge>
                  </div>
                  <p class="mt-1 text-xs text-text-secondary">
                    {{ scopeText(policy) }} · {{ yearsText(policy.retain_days) }} desde el cierre del expediente
                  </p>
                </div>
                <div class="flex shrink-0 gap-2">
                  <app-button variant="outline" size="sm" (clicked)="openPolicy(policy)">Editar</app-button>
                  <app-button variant="outline-danger" size="sm" (clicked)="removePolicy(policy)">
                    Eliminar
                  </app-button>
                </div>
              </li>
            }
          </ul>
        }
      </app-card>

      <app-card [responsive]="true" [padding]="false" overflow="visible" class="mb-4 block">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-2 py-3 md:px-6 md:py-4">
          <h2 class="text-[13px] font-bold text-gray-600 md:text-lg md:font-semibold md:text-text-primary">
            Purga
          </h2>
          <div class="flex gap-2">
            <app-button variant="outline" size="sm" [loading]="previewing()" (clicked)="loadPreview()">
              <app-icon name="eye" [size]="14" slot="icon" />
              Vista previa de la purga
            </app-button>
            <app-button
              variant="danger"
              size="sm"
              [loading]="running()"
              [disabled]="!preview() || preview()!.totals.files === 0"
              (clicked)="runPurge()"
            >
              <app-icon name="play" [size]="14" slot="icon" />
              Ejecutar purga
            </app-button>
          </div>
        </div>
        @if (preview(); as p) {
          <div class="flex flex-col gap-3 p-3 md:p-4" data-testid="purge-preview">
            <p class="text-sm text-text-secondary">
              Se purgarían <strong>{{ p.totals.files }}</strong>
              {{ p.totals.files === 1 ? 'archivo' : 'archivos' }} ({{ sizeText(p.totals.bytes) }}).
              @if (p.totals.skipped_legal_hold > 0) {
                {{ p.totals.skipped_legal_hold }} se omiten por retención legal.
              }
              El objeto se borra del almacenamiento; el registro y su huella quedan como evidencia.
            </p>
            @if (p.to_purge.length > 0) {
              <ul class="flex flex-col gap-2">
                @for (c of p.to_purge; track c.file_id) {
                  <li class="rounded-xl border border-border p-3">
                    <p class="text-sm font-medium text-text-primary">{{ c.original_name }}</p>
                    <p class="mt-1 text-xs text-text-secondary">
                      {{ c.dossier_reference }} · {{ c.reason }} · {{ sizeText(c.size_bytes) }}
                    </p>
                  </li>
                }
              </ul>
            }
            @if (p.skipped_legal_hold.length > 0) {
              <p class="text-xs font-semibold text-text-primary">En retención legal (no se tocan)</p>
              <ul class="flex flex-col gap-2">
                @for (c of p.skipped_legal_hold; track c.file_id) {
                  <li class="rounded-xl border border-border p-3">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-text-primary">{{ c.original_name }}</span>
                      <app-badge variant="warning" size="xs">Retención legal</app-badge>
                    </div>
                    <p class="mt-1 text-xs text-text-secondary">{{ c.dossier_reference }} · {{ c.reason }}</p>
                  </li>
                }
              </ul>
            }
          </div>
        } @else {
          <p class="p-4 text-sm text-text-secondary">
            Mira primero qué se purgaría: la vista previa no borra nada. La purga corre sola cada mes.
          </p>
        }
      </app-card>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="border-b border-border px-2 py-3 md:px-6 md:py-4">
          <h2 class="text-[13px] font-bold text-gray-600 md:text-lg md:font-semibold md:text-text-primary">
            Informes de purga ({{ runsTotal() }})
          </h2>
        </div>
        @if (runs().length === 0) {
          <app-empty-state
            icon="file-text"
            title="Aún no hay corridas"
            description="Cada purga, programada o manual, deja aquí su informe."
            [showActionButton]="false"
          />
        } @else {
          <ul class="flex flex-col gap-2 p-3 md:p-4" data-testid="runs">
            @for (run of runs(); track run.id) {
              <li>
                <button
                  type="button"
                  class="flex w-full flex-col gap-1 rounded-xl border border-border p-3 text-left hover:bg-background sm:flex-row sm:items-center sm:justify-between"
                  (click)="openRun(run)"
                >
                  <span class="text-sm font-medium text-text-primary">
                    {{ dateText(run.started_at) }}
                    <app-badge variant="neutral" size="xs">
                      {{ run.trigger === 'schedule' ? 'Programada' : 'Manual' }}
                    </app-badge>
                  </span>
                  <span class="text-xs text-text-secondary">
                    {{ run.files_purged }} purgados · {{ sizeText(run.bytes_purged) }} liberados ·
                    {{ run.skipped_legal_hold }} omitidos por retención legal
                    @if (run.status !== 'completed') {
                      · {{ statusText(run.status) }}
                    }
                  </span>
                </button>
              </li>
            }
          </ul>
          <div class="flex justify-center pb-4">
            <app-pagination
              [currentPage]="runsPage()"
              [totalPages]="runsPages()"
              [total]="runsTotal()"
              [limit]="runsLimit"
              (pageChange)="onRunsPage($event)"
            />
          </div>
        }
      </app-card>
    </div>

    <app-modal
      [isOpen]="policyOpen()"
      (isOpenChange)="policyOpen.set($event)"
      [title]="editing() ? 'Editar política' : 'Nueva política'"
      size="md"
    >
      <div class="flex flex-col gap-3" data-testid="policy-form">
        <app-input
          label="Nombre"
          placeholder="Laboral"
          [ngModel]="name()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="name.set($event ?? '')"
        />
        <app-selector
          label="Sujeto del expediente"
          [options]="subjectOptions"
          [ngModel]="subjectType()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="subjectType.set($event ? String($event) : '')"
        />
        <app-input
          label="Tipo de documento"
          placeholder="Vacío: cualquiera"
          [ngModel]="docType()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="docType.set($event ?? '')"
        />
        <app-input
          type="number"
          label="Días de retención"
          helperText="Se cuentan desde el cierre del expediente. 1095 días son 3 años."
          [ngModel]="retainDays()"
          [ngModelOptions]="{ standalone: true }"
          (ngModelChange)="retainDays.set($event ?? '')"
        />
        <app-toggle label="Política activa" [checked]="isActive()" (toggled)="isActive.set($event)" />
        @if (formError()) {
          <p class="text-sm text-error" role="alert">{{ formError() }}</p>
        }
      </div>
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="policyOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="saving()" (clicked)="savePolicy()">Guardar</app-button>
      </div>
    </app-modal>
  `,
})
export class DocumentsRetentionPageComponent implements OnInit {
  private readonly api = inject(DocumentsLibraryApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly String = String;
  readonly runsLimit = RUNS_LIMIT;
  readonly subjectOptions = [{ value: ANY_SUBJECT, label: 'Cualquiera' }, ...SUBJECT_TYPE_OPTIONS];

  readonly policies = signal<RetentionPolicy[]>([]);
  readonly preview = signal<PurgePreview | null>(null);
  readonly previewing = signal(false);
  readonly running = signal(false);
  readonly runs = signal<PurgeRun[]>([]);
  readonly runsPage = signal(1);
  readonly runsTotal = signal(0);
  readonly runsPages = computed(() => Math.ceil(this.runsTotal() / RUNS_LIMIT) || 1);

  readonly policyOpen = signal(false);
  readonly editing = signal<RetentionPolicy | null>(null);
  readonly name = signal('');
  readonly subjectType = signal(ANY_SUBJECT);
  readonly docType = signal('');
  readonly retainDays = signal<string | number>('');
  readonly isActive = signal(true);
  readonly saving = signal(false);
  readonly formError = signal('');

  ngOnInit(): void {
    this.loadPolicies();
    this.loadRuns();
  }

  scopeText(policy: RetentionPolicy): string {
    const subject = policy.subject_type ? subjectSingular(policy.subject_type) : 'Cualquier sujeto';
    return `${subject} · ${policy.doc_type ?? 'Cualquier tipo'}`;
  }

  yearsText(days: number): string {
    if (days % 365 === 0) {
      const years = days / 365;
      return `${years} ${years === 1 ? 'año' : 'años'}`;
    }
    return `${days} ${days === 1 ? 'día' : 'días'}`;
  }

  sizeText(bytes: number): string {
    return bytes > 0 ? formatFileSize(bytes) : '0 B';
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  statusText(status: string): string {
    if (status === 'partial') return 'con errores';
    if (status === 'failed') return 'falló';
    if (status === 'running') return 'en curso';
    return status;
  }

  openPolicy(policy: RetentionPolicy | null): void {
    this.editing.set(policy);
    this.name.set(policy?.name ?? '');
    this.subjectType.set(policy?.subject_type ?? ANY_SUBJECT);
    this.docType.set(policy?.doc_type ?? '');
    this.retainDays.set(policy?.retain_days ?? '');
    this.isActive.set(policy?.is_active ?? true);
    this.formError.set('');
    this.policyOpen.set(true);
  }

  savePolicy(): void {
    const name = this.name().trim();
    const days = Number(this.retainDays());
    if (!name) {
      this.formError.set('Escribe un nombre para la política.');
      return;
    }
    if (!Number.isInteger(days) || days < 1) {
      this.formError.set('Los días de retención deben ser un número entero mayor que 0.');
      return;
    }
    const body = {
      name,
      subject_type: this.subjectType() || null,
      doc_type: this.docType().trim() || null,
      retain_days: days,
      is_active: this.isActive(),
    };
    const current = this.editing();
    this.saving.set(true);
    this.formError.set('');
    (current ? this.api.updatePolicy(current.id, body) : this.api.createPolicy(body))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.policyOpen.set(false);
          this.toast.success(current ? 'Política actualizada' : 'Política creada');
          this.preview.set(null);
          this.loadPolicies();
        },
        error: (error) => {
          this.saving.set(false);
          this.formError.set(libraryErrorMessage(error));
        },
      });
  }

  async removePolicy(policy: RetentionPolicy): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Eliminar política',
      message: `¿Eliminar la política "${policy.name}"? Los archivos que cubría dejarán de purgarse por ella.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .deletePolicy(policy.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Política eliminada');
          this.preview.set(null);
          this.loadPolicies();
        },
        error: (error) => this.toast.error(libraryErrorMessage(error)),
      });
  }

  loadPreview(): void {
    if (this.previewing()) return;
    this.previewing.set(true);
    this.api
      .purgePreview()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.previewing.set(false);
          this.preview.set(preview);
        },
        error: (error) => {
          this.previewing.set(false);
          this.toast.error(libraryErrorMessage(error));
        },
      });
  }

  async runPurge(): Promise<void> {
    const p = this.preview();
    if (!p || p.totals.files === 0 || this.running()) return;
    const confirmed = await this.dialog.confirm({
      title: 'Ejecutar la purga',
      message: `Se borrarán del almacenamiento ${p.totals.files} ${
        p.totals.files === 1 ? 'archivo' : 'archivos'
      }. Esta acción no se puede deshacer; el registro y su huella quedan como evidencia.`,
      confirmText: 'Ejecutar purga',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.running.set(true);
    this.api
      .runPurge()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (run) => {
          this.running.set(false);
          this.preview.set(null);
          this.toast.success(`Purga terminada: ${run.files_purged} archivos purgados`);
          this.runsPage.set(1);
          this.loadRuns();
          this.router.navigate(['/admin/documents/retention/runs', run.id]);
        },
        error: (error) => {
          this.running.set(false);
          this.toast.error(libraryErrorMessage(error));
        },
      });
  }

  openRun(run: PurgeRun): void {
    this.router.navigate(['/admin/documents/retention/runs', run.id]);
  }

  onRunsPage(page: number): void {
    this.runsPage.set(page);
    this.loadRuns();
  }

  private loadPolicies(): void {
    this.api
      .policies()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.policies.set(list),
        error: (error) => this.toast.error(libraryErrorMessage(error)),
      });
  }

  private loadRuns(): void {
    this.api
      .purgeRuns({ page: this.runsPage(), limit: RUNS_LIMIT })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.runs.set(res.data ?? []);
          this.runsTotal.set(res.meta?.total ?? res.data?.length ?? 0);
        },
        error: (error) => this.toast.error(libraryErrorMessage(error)),
      });
  }
}
