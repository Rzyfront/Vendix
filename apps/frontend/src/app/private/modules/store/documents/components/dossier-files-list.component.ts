import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { WorkflowsApiService } from '../../workflows/services/workflows-api.service';
import {
  formatFileSize,
  openUrlInNewTab,
  shortHash,
} from '../../workflows/utils/workflow-labels.util';
import { DossierFileItem } from '../interfaces/document-library.interfaces';
import { libraryErrorMessage } from '../services/documents-library-api.service';

const KIND_LABEL: Record<string, string> = {
  issued_document: 'Documento emitido',
  signed_document: 'Documento firmado',
};

/**
 * Files of a dossier as Documents lists them: a purged file shows "Purgado por
 * la política <nombre> el <fecha>" and has no download; the hash stays visible
 * as evidence.
 */
@Component({
  selector: 'app-dossier-files-list',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, IconComponent],
  template: `
    @if (items().length === 0) {
      <p class="text-sm text-text-secondary">Aún no hay archivos en el expediente.</p>
    } @else {
      <ul class="flex flex-col gap-2" data-testid="dossier-files">
        @for (item of items(); track item.id) {
          <li
            class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            [class.opacity-70]="item.status === 'superseded' || !!item.file?.purged_at"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <app-icon name="file-text" [size]="16" class="text-text-secondary" />
                <span class="truncate text-sm font-medium text-text-primary">
                  {{ item.file?.original_name ?? 'Archivo no disponible' }}
                </span>
                @if (item.status === 'superseded') {
                  <app-badge variant="neutral" size="xs">Reemplazado</app-badge>
                }
                @if (item.file?.purged_at) {
                  <app-badge variant="warning" size="xs">Purgado</app-badge>
                }
              </div>
              <p class="mt-1 text-xs text-text-secondary">
                {{ requirementLabel(item) }} · {{ dateText(item.created_at) }}
                @if (item.file) {
                  · {{ sizeText(item.file.size_bytes) }} ·
                  <span class="font-mono" [title]="item.file.sha256">{{ hashText(item.file.sha256) }}</span>
                }
              </p>
              @if (item.file?.purged_at; as purgedAt) {
                <p class="mt-1 text-xs text-warning" data-testid="purged-note">
                  {{ purgedText(item.file!.purge_policy_name, purgedAt) }}
                </p>
              }
            </div>
            @if (item.file && !item.file.purged_at) {
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
export class DossierFilesListComponent {
  private readonly workflows = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = input<DossierFileItem[]>([]);

  readonly downloading = signal<number | null>(null);
  private readonly timezone = computed(() => this.settings.timezone());

  requirementLabel(item: DossierFileItem): string {
    const kind = KIND_LABEL[item.kind];
    if (kind) return kind;
    return item.requirement_key ?? item.field_key ?? 'Archivo adjunto';
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

  purgedText(policy: string | null | undefined, purgedAt: string): string {
    const when = formatStoreDateTime(purgedAt, this.timezone());
    return policy
      ? `Purgado por la política ${policy} el ${when}`
      : `Purgado por política de retención el ${when}`;
  }

  download(item: DossierFileItem): void {
    const file = item.file;
    if (!file || this.downloading() !== null) return;
    this.downloading.set(file.id);
    this.workflows
      .getFileDownload(file.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.downloading.set(null);
          openUrlInNewTab(result.url);
        },
        error: (error) => {
          this.downloading.set(null);
          this.toast.error(libraryErrorMessage(error));
        },
      });
  }
}
