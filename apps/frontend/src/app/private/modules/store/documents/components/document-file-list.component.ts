import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
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
} from '../../workflows/utils/workflow-labels.util';
import {
  LibraryFile,
  dateOnlyText,
  subjectSingular,
} from '../interfaces/document-library.interfaces';
import { libraryErrorMessage } from '../services/documents-library-api.service';

/**
 * Files found by the search or inside a folder: type, tags, expiry, retention
 * hold, the dossier / subject / request they belong to, download and (when the
 * person may manage) the edit action.
 */
@Component({
  selector: 'app-document-file-list',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, IconComponent, RouterLink],
  template: `
    <ul class="flex flex-col gap-2" data-testid="document-file-list">
      @for (file of files(); track file.id) {
        <li
          class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <app-icon name="file-text" [size]="16" class="text-text-secondary" />
              <span class="truncate text-sm font-medium text-text-primary">{{ file.original_name }}</span>
              @if (file.doc_type) {
                <app-badge variant="primary" size="xs">{{ file.doc_type }}</app-badge>
              }
              @for (tag of file.tags; track tag) {
                <app-badge variant="neutral" size="xs">{{ tag }}</app-badge>
              }
              @if (file.valid_until) {
                <app-badge variant="info" size="xs">Vence {{ dateOnly(file.valid_until) }}</app-badge>
              }
              @if (file.legal_hold) {
                <app-badge variant="warning" size="xs">Retención legal</app-badge>
              }
            </div>
            <p class="mt-1 text-xs text-text-secondary">
              @if (file.subject) {
                {{ subjectText(file) }} ·
              }
              @if (file.dossier) {
                {{ file.dossier.reference }} ·
              }
              {{ dateText(file.created_at) }} · {{ sizeText(file.size_bytes) }}
              @if (file.request?.id; as requestId) {
                ·
                <a
                  class="text-primary hover:underline"
                  [routerLink]="['/admin/workflows/instances', requestId]"
                  >{{ file.request?.reference ?? 'Ver solicitud' }}</a
                >
              }
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            @if (canEdit()) {
              <app-button variant="outline" size="sm" (clicked)="edit.emit(file)">
                <app-icon name="pencil" [size]="14" slot="icon" />
                Editar datos
              </app-button>
            }
            <app-button
              variant="outline"
              size="sm"
              [loading]="downloading() === file.id"
              (clicked)="download(file)"
            >
              <app-icon name="download" [size]="14" slot="icon" />
              Descargar
            </app-button>
          </div>
        </li>
      }
    </ul>
  `,
})
export class DocumentFileListComponent {
  private readonly workflows = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly files = input<LibraryFile[]>([]);
  readonly canEdit = input<boolean>(false);
  readonly edit = output<LibraryFile>();

  readonly downloading = signal<number | null>(null);

  dateOnly(value: string): string {
    return dateOnlyText(value);
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  sizeText(bytes: number | string): string {
    return formatFileSize(bytes);
  }

  subjectText(file: LibraryFile): string {
    const s = file.subject;
    if (!s) return '';
    const kind = s.collection_name ?? subjectSingular(s.type);
    return `${kind}: ${s.label}`;
  }

  download(file: LibraryFile): void {
    if (this.downloading() !== null) return;
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
