import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { DossierItemView } from '../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';
import {
  formatFileSize,
  openUrlInNewTab,
  shortHash,
} from '../utils/workflow-labels.util';

/** Files of a dossier: name, requirement, date, short hash, superseded mark and download. */
@Component({
  selector: 'app-dossier-items-list',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, IconComponent],
  template: `
    @if (items().length === 0) {
      <p class="text-sm text-text-secondary">
        Aún no hay archivos en el expediente.
      </p>
    } @else {
      <ul class="flex flex-col gap-2" data-testid="dossier-items">
        @for (item of items(); track item.id) {
          <li
            class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            [class.opacity-70]="item.status === 'superseded'"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <app-icon
                  name="file-text"
                  [size]="16"
                  class="text-text-secondary"
                />
                <span class="truncate text-sm font-medium text-text-primary">
                  {{ item.file?.original_name ?? 'Archivo no disponible' }}
                </span>
                @if (item.status === 'superseded') {
                  <app-badge variant="neutral" size="xs">Reemplazado</app-badge>
                }
              </div>
              <p class="mt-1 text-xs text-text-secondary">
                {{ requirementLabel(item) }} · {{ dateText(item.created_at) }}
                @if (item.file) {
                  · {{ sizeText(item.file.size_bytes) }} ·
                  <span class="font-mono" [title]="item.file.sha256">
                    {{ hashText(item.file.sha256) }}
                  </span>
                }
              </p>
            </div>
            @if (item.file?.purged_at) {
              <span class="text-xs text-text-secondary" data-testid="purged-note">
                Purgado por la política {{ item.file?.purge_policy_name ?? 'de retención' }} el
                {{ dateText(item.file?.purged_at ?? '') }}
              </span>
            } @else if (item.file) {
              <app-button
                variant="outline"
                size="sm"
                [loading]="downloading() === item.file.id"
                (clicked)="download(item)"
              >
                <app-icon name="download" [size]="14" slot="icon" />
                Descargar
              </app-button>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class DossierItemsListComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly settings = inject(StoreSettingsFacade);

  readonly items = input<DossierItemView[]>([]);
  /** requirement/field key -> human label. */
  readonly labels = input<Record<string, string>>({});

  readonly downloading = signal<number | null>(null);
  private readonly timezone = computed(() => this.settings.timezone());

  requirementLabel(item: DossierItemView): string {
    const key = item.requirement_key ?? item.field_key;
    if (!key) return 'Archivo adjunto';
    return this.labels()[key] ?? key;
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.timezone());
  }

  sizeText(bytes: number | string): string {
    return formatFileSize(bytes);
  }

  hashText(hash: string): string {
    return shortHash(hash);
  }

  download(item: DossierItemView): void {
    const file = item.file;
    if (!file || this.downloading() !== null) return;
    this.downloading.set(file.id);
    this.api
      .getFileDownload(file.id)
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
}
