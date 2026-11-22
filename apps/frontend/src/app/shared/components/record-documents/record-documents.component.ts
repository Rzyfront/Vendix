import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { StoreSettingsFacade } from '../../../core/store/store-settings/store-settings.facade';
import { LibraryFile } from '../../../private/modules/store/documents/interfaces/document-library.interfaces';
import { formatFileSize } from '../../../private/modules/store/workflows/utils/workflow-labels.util';
import { formatStoreDateTime } from '../../utils/date.util';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { ToastService } from '../toast/toast.service';
import { DocumentViewerComponent, documentViewerKind } from './document-viewer.component';
import { RecordDocumentsApiService } from './record-documents-api.service';

/** Singular noun by subject type, for the empty state. */
const SUBJECT_NOUN: Record<string, string> = {
  customer: 'Este cliente',
  order: 'Esta orden',
};

/**
 * "Documentos" panel of a record: files stored against a subject (by Vex or by
 * flows). Reads `store/record-documents`, open in every industry to whoever can
 * read the record; a record without folders is the empty state and a 403 (no
 * read permission on the record) is a calm notice.
 */
@Component({
  selector: 'app-record-documents',
  standalone: true,
  imports: [ButtonComponent, IconComponent, SpinnerComponent, DocumentViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex flex-col gap-3" aria-label="Documentos del registro" data-testid="record-documents">
      @if (loading()) {
        <div class="flex justify-center py-8" role="status" aria-label="Cargando documentos">
          <app-spinner />
        </div>
      } @else if (forbidden()) {
        <p class="text-sm text-text-secondary py-6 text-center" data-testid="record-documents-forbidden">
          No tienes permiso para ver los documentos de este registro.
        </p>
      } @else if (failed()) {
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <p class="text-sm text-text-secondary">No pudimos cargar los documentos.</p>
          <app-button variant="outline" size="sm" (clicked)="load()">Reintentar</app-button>
        </div>
      } @else if (files().length === 0) {
        <div class="flex flex-col items-center gap-2 py-8 text-center" data-testid="record-documents-empty">
          <app-icon name="folder-open" [size]="28" class="text-text-secondary" />
          <p class="text-sm text-text-secondary">{{ emptyText() }}</p>
        </div>
      } @else {
        <ul class="flex flex-col gap-2" data-testid="record-documents-list">
          @for (file of files(); track file.id) {
            <li
              class="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex items-center gap-3 min-w-0">
                <span class="w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-primary/10 text-primary" aria-hidden="true">
                  <app-icon [name]="iconFor(file)" [size]="20" />
                </span>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-text-primary">{{ file.original_name }}</p>
                  <p class="text-xs text-text-secondary">
                    {{ typeText(file) }} · {{ sizeText(file) }} · {{ dateText(file) }}
                  </p>
                </div>
              </div>
              <div class="flex gap-2 shrink-0">
                <app-button
                  variant="outline"
                  size="sm"
                  [loading]="busy() === file.id"
                  [ariaLabel]="'Ver ' + file.original_name"
                  (clicked)="view(file)"
                >
                  <app-icon name="eye" [size]="14" slot="icon" />
                  Ver
                </app-button>
                <app-button
                  variant="outline"
                  size="sm"
                  [disabled]="busy() === file.id"
                  [ariaLabel]="'Descargar ' + file.original_name"
                  (clicked)="download(file)"
                >
                  <app-icon name="download" [size]="14" slot="icon" />
                  Descargar
                </app-button>
              </div>
            </li>
          }
        </ul>
      }
    </section>

    <app-document-viewer
      [(isOpen)]="viewerOpen"
      [url]="viewerUrl()"
      [mimeType]="viewerMime()"
      [name]="viewerName()"
    />
  `,
})
export class RecordDocumentsComponent {
  private readonly records = inject(RecordDocumentsApiService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly subjectType = input.required<string>();
  readonly subjectId = input.required<number>();

  readonly files = signal<LibraryFile[]>([]);
  readonly loading = signal(false);
  readonly forbidden = signal(false);
  readonly failed = signal(false);
  readonly busy = signal<number | null>(null);

  readonly viewerOpen = signal(false);
  readonly viewerUrl = signal('');
  readonly viewerMime = signal<string | null>(null);
  readonly viewerName = signal('');

  private readonly timezone = computed(() => this.settings.timezone());
  readonly emptyText = computed(
    () => `${SUBJECT_NOUN[this.subjectType()] ?? 'Este registro'} aún no tiene documentos`,
  );

  constructor() {
    effect(() => {
      this.subjectType();
      this.subjectId();
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.forbidden.set(false);
    this.failed.set(false);
    this.records
      .list(this.subjectType(), this.subjectId(), { limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (files) => {
          this.files.set(files);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          const status = error instanceof HttpErrorResponse ? error.status : 0;
          this.files.set([]);
          if (status === 403) this.forbidden.set(true);
          else if (status !== 404) this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  iconFor(file: LibraryFile): string {
    const kind = documentViewerKind(file.mime_type, file.original_name);
    return kind === 'image' ? 'image' : 'file-text';
  }

  typeText(file: LibraryFile): string {
    const kind = documentViewerKind(file.mime_type, file.original_name);
    if (file.doc_type) return file.doc_type;
    return kind === 'image' ? 'Imagen' : kind === 'pdf' ? 'PDF' : 'Archivo';
  }

  sizeText(file: LibraryFile): string {
    return formatFileSize(file.size_bytes);
  }

  dateText(file: LibraryFile): string {
    return formatStoreDateTime(file.created_at, this.timezone());
  }

  view(file: LibraryFile): void {
    if (documentViewerKind(file.mime_type, file.original_name) === 'other') {
      this.download(file);
      return;
    }
    this.signed(file, (result) => {
      this.viewerUrl.set(result.url);
      this.viewerMime.set(file.mime_type);
      this.viewerName.set(file.original_name);
      this.viewerOpen.set(true);
    });
  }

  download(file: LibraryFile): void {
    this.signed(file, (result) => window.open(result.url, '_blank', 'noopener'));
  }

  private signed(file: LibraryFile, done: (result: { url: string }) => void): void {
    if (this.busy() !== null) return;
    this.busy.set(file.id);
    this.records
      .download(this.subjectType(), this.subjectId(), file.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(null);
          done(result);
        },
        error: () => {
          this.busy.set(null);
          this.toast.error('No pudimos abrir el documento. Inténtalo de nuevo.');
        },
      });
  }
}
