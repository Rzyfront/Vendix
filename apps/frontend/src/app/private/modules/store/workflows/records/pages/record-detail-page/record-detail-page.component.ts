import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { formatStoreDateTime } from '../../../../../../../shared/utils/date.util';
import { DossierItemView } from '../../../interfaces/workflow.interfaces';
import { isPlanLimit, toWorkflowError } from '../../../utils/workflow-errors.util';
import {
  formatFileSize,
  instanceStatusLabel,
  instanceStatusTone,
  openUrlInNewTab,
} from '../../../utils/workflow-labels.util';
import { RecordDetail } from '../../interfaces/records.interfaces';
import { RecordsApiService } from '../../services/records-api.service';
import { formatRecordValue } from '../../utils/records-ui.util';

/** `/admin/workflows/records/:recordId`: fields, dossier ("Expediente"), requests and "Iniciar flujo". */
@Component({
  selector: 'app-record-detail-page',
  standalone: true,
  providers: [CurrencyPipe],
  imports: [
    RouterLink,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      @if (loadError()) {
        <app-sticky-header
          title="Registro"
          icon="folder-open"
          variant="glass"
          [showBackButton]="true"
          backRoute="/admin/workflows/records"
        />
        <app-alert-banner variant="danger" icon="alert-circle">{{ loadError() }}</app-alert-banner>
      } @else if (detail(); as d) {
        <app-sticky-header
          [title]="d.reference + ' · ' + d.title"
          [subtitle]="d.collection.name"
          [icon]="d.collection.icon || 'folder-open'"
          variant="glass"
          [showBackButton]="true"
          [backRoute]="'/admin/workflows/records/collections/' + d.collection.id"
          [actions]="headerActions"
          (actionClicked)="onHeaderAction($event)"
        />

        <div class="flex flex-col gap-3 p-2 md:gap-4 md:p-4">
          <app-card [responsive]="true">
            <h2 class="mb-3 text-sm font-bold text-text-primary">Datos</h2>
            <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="record-fields">
              @for (row of fieldRows(); track row.key) {
                <div>
                  <dt class="text-xs text-text-secondary">{{ row.label }}</dt>
                  <dd class="text-sm font-medium text-text-primary">{{ row.text }}</dd>
                </div>
              }
            </dl>
          </app-card>

          <app-card [responsive]="true">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-sm font-bold text-text-primary">Expediente</h2>
              <div>
                <input
                  #fileInput
                  type="file"
                  class="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt"
                  (change)="onFilePicked($event)"
                />
                <app-button variant="outline" size="sm" [loading]="uploading()" (clicked)="fileInput.click()">
                  <app-icon name="upload" [size]="14" slot="icon" />
                  Subir archivo
                </app-button>
              </div>
            </div>
            @if (uploadError()) {
              <p class="mb-2 text-sm text-error" role="alert">{{ uploadError() }}</p>
            }
            @if (items().length === 0) {
              <p class="text-sm text-text-secondary">Aún no hay archivos en el expediente.</p>
            } @else {
              <ul class="flex flex-col gap-2" data-testid="dossier-items">
                @for (item of items(); track item.id) {
                  <li class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <app-icon name="file-text" [size]="16" class="text-text-secondary" />
                        <span class="truncate text-sm font-medium text-text-primary">
                          {{ item.file?.original_name ?? 'Archivo no disponible' }}
                        </span>
                      </div>
                      <p class="mt-1 text-xs text-text-secondary">
                        {{ dateText(item.created_at) }}
                        @if (item.file) {
                          · {{ sizeText(item.file.size_bytes) }}
                        }
                      </p>
                    </div>
                    @if (item.file; as file) {
                      <app-button
                        variant="outline"
                        size="sm"
                        [loading]="downloading() === file.id"
                        (clicked)="download(d.id, file.id)"
                      >
                        <app-icon name="download" [size]="14" slot="icon" />
                        Descargar
                      </app-button>
                    }
                  </li>
                }
              </ul>
            }
          </app-card>

          <app-card [responsive]="true">
            <h2 class="mb-3 text-sm font-bold text-text-primary">Solicitudes</h2>
            @if (d.instances.length === 0) {
              <p class="text-sm text-text-secondary">Este registro aún no tiene solicitudes.</p>
            } @else {
              <ul class="flex flex-col gap-2" data-testid="record-instances">
                @for (i of d.instances; track i.id) {
                  <li>
                    <a
                      [routerLink]="['/admin/workflows/instances', i.id]"
                      class="flex flex-col gap-1 rounded-xl border border-border p-3 hover:bg-background sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span class="min-w-0">
                        <span class="block truncate text-sm font-medium text-text-primary">
                          {{ i.reference }} · {{ i.title }}
                        </span>
                        <span class="block text-xs text-text-secondary">
                          {{ i.definition_name ?? 'Flujo' }} · {{ dateText(i.created_at) }}
                        </span>
                      </span>
                      <app-badge [variant]="tone(i.status)" size="sm">{{ statusText(i.status) }}</app-badge>
                    </a>
                  </li>
                }
              </ul>
            }
          </app-card>

          <app-card [responsive]="true">
            <h2 class="mb-1 text-sm font-bold text-text-primary">Iniciar flujo</h2>
            <p class="mb-3 text-xs text-text-secondary">
              Inicia una solicitud con este registro: los campos con el mismo nombre se llenan solos.
            </p>
            @if (startError()) {
              <p class="mb-2 text-sm text-error" role="alert">{{ startError() }}</p>
            }
            @if (d.flows.length === 0) {
              <p class="text-sm text-text-secondary" data-testid="no-flows">
                No hay flujos publicados para {{ d.collection.name }}. Crea uno en Flujos con el sujeto
                «Registro personalizado» y esta colección.
              </p>
            } @else {
              <div class="flex flex-wrap gap-2">
                @for (flow of d.flows; track flow.id) {
                  <app-button
                    variant="outline"
                    size="sm"
                    [loading]="starting() === flow.id"
                    [disabled]="starting() !== null"
                    (clicked)="startFlow(d.id, flow.id)"
                  >
                    <app-icon name="play" [size]="14" slot="icon" />
                    {{ flow.name }}
                  </app-button>
                }
              </div>
            }
          </app-card>
        </div>
      } @else {
        <p class="py-8 text-center text-sm text-text-secondary" role="status">Cargando registro...</p>
      }
    </div>
  `,
})
export class RecordDetailPageComponent implements OnInit {
  private readonly api = inject(RecordsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly currencyPipe = inject(CurrencyPipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly headerActions = [
    { id: 'edit', label: 'Editar', icon: 'pencil', variant: 'outline' as const },
    { id: 'archive', label: 'Archivar', icon: 'archive', variant: 'outline' as const },
  ];

  readonly detail = signal<RecordDetail | null>(null);
  readonly loadError = signal('');
  readonly uploading = signal(false);
  readonly uploadError = signal('');
  readonly downloading = signal<number | null>(null);
  readonly starting = signal<number | null>(null);
  readonly startError = signal('');
  /** One key per flow while its start has not succeeded: a retry never creates two requests. */
  private readonly startKeys = new Map<number, string>();
  private readonly timezone = computed(() => this.settings.timezone());

  readonly items = computed<DossierItemView[]>(() => this.detail()?.dossier?.items ?? []);

  readonly fieldRows = computed(() => {
    const d = this.detail();
    if (!d) return [];
    return d.collection.fields.map((f) => ({
      key: f.key,
      label: f.label,
      text: formatRecordValue(f, d.values[f.key], (n) => this.currencyPipe.transform(n)),
    }));
  });

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('recordId'));
    if (!Number.isInteger(id) || id < 1) {
      this.loadError.set('No se encontró el registro.');
      return;
    }
    this.load(id);
  }

  tone(status: string) {
    return instanceStatusTone(status);
  }

  statusText(status: string): string {
    return instanceStatusLabel(status);
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.timezone());
  }

  sizeText(bytes: number | string): string {
    return formatFileSize(bytes);
  }

  onHeaderAction(id: string): void {
    const d = this.detail();
    if (!d) return;
    if (id === 'edit') this.router.navigate(['/admin/workflows/records', d.id, 'edit']);
    if (id === 'archive') void this.archive(d);
  }

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const d = this.detail();
    input.value = '';
    if (!file || !d || this.uploading()) return;
    this.uploading.set(true);
    this.uploadError.set('');
    this.api
      .uploadFile(d.id, file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploading.set(false);
          this.toast.success('Archivo recibido');
          this.load(d.id);
        },
        error: (error) => {
          this.uploading.set(false);
          const failure = toWorkflowError(error);
          // A plan limit already opened the paywall: no error of its own on top.
          this.uploadError.set(isPlanLimit(failure) ? '' : failure.message);
        },
      });
  }

  download(recordId: number, fileId: number): void {
    if (this.downloading() !== null) return;
    this.downloading.set(fileId);
    this.api
      .getFileDownload(recordId, fileId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.downloading.set(null);
          openUrlInNewTab(result.url);
        },
        error: (error) => {
          this.downloading.set(null);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }

  startFlow(recordId: number, definitionId: number): void {
    if (this.starting() !== null) return;
    const key = this.startKeys.get(definitionId) ?? crypto.randomUUID();
    this.startKeys.set(definitionId, key);
    this.starting.set(definitionId);
    this.startError.set('');
    this.api
      .startFlow(recordId, definitionId, key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.starting.set(null);
          this.startKeys.delete(definitionId);
          this.toast.success(`Solicitud ${result.instance.reference} iniciada`);
          this.router.navigate(['/admin/workflows/instances', result.instance.id]);
        },
        error: (error) => {
          this.starting.set(null);
          const failure = toWorkflowError(error);
          this.startError.set(isPlanLimit(failure) ? '' : failure.message);
        },
      });
  }

  async archive(d: RecordDetail): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Archivar registro',
      message: `¿Archivar "${d.title}" (${d.reference})? Sale de la lista; sus solicitudes y su expediente se conservan.`,
      confirmText: 'Archivar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .archiveRecord(d.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Registro archivado');
          this.router.navigate(['/admin/workflows/records/collections', d.collection.id]);
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  private load(id: number): void {
    this.api
      .getRecord(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.detail.set(d);
          this.loadError.set('');
        },
        error: (error) => this.loadError.set(toWorkflowError(error).message),
      });
  }
}
