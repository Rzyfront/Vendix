import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { EMPTY, Subject, catchError, debounceTime, switchMap, tap } from 'rxjs';
import {
  CardComponent,
  EmptyStateComponent,
  InputComponent,
  InputsearchComponent,
  PaginationComponent,
  SelectorComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { DocumentFileListComponent } from '../../components/document-file-list.component';
import { FileProfileModalComponent } from '../../components/file-profile-modal.component';
import {
  LibraryFile,
  SUBJECT_TYPE_OPTIONS,
} from '../../interfaces/document-library.interfaces';
import {
  DocumentsLibraryApiService,
  libraryErrorMessage,
} from '../../services/documents-library-api.service';

/** "Buscar": files of every dossier by name, type, tags and the text read from them. */
@Component({
  selector: 'app-documents-search-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    InputsearchComponent,
    SelectorComponent,
    PaginationComponent,
    EmptyStateComponent,
    DocumentFileListComponent,
    FileProfileModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Documentos"
        subtitle="Busca en todos los expedientes"
        icon="folder-open"
        variant="glass"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="flex flex-col gap-3 border-b border-border px-2 py-3 md:px-6 md:py-4">
          <app-inputsearch
            class="w-full rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none"
            size="sm"
            placeholder="Buscar por nombre, tipo, etiqueta o texto del documento..."
            [debounceTime]="300"
            (searchChange)="onSearch($event)"
          />
          <div class="grid gap-3 sm:grid-cols-3">
            <app-input
              label="Tipo de documento"
              placeholder="RUT, Póliza..."
              [ngModel]="docType()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onDocType($event)"
            />
            <app-input
              label="Etiqueta"
              placeholder="seguro"
              [ngModel]="tag()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onTag($event)"
            />
            <app-selector
              label="Tipo de sujeto"
              placeholder="Todos"
              [options]="subjectOptions"
              [ngModel]="subjectType()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onSubjectType($event)"
            />
          </div>
        </div>

        @if (loading()) {
          <div class="p-4 text-center md:p-6">
            <div class="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Buscando documentos...</p>
          </div>
        } @else if (total() === 0) {
          <app-empty-state
            icon="search"
            [title]="hasFilters() ? 'Ningún documento coincide con tu búsqueda' : 'Aún no hay documentos'"
            description="Cambia el texto o los filtros para ampliar la búsqueda."
            [showActionButton]="false"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <p class="mb-2 text-xs text-text-secondary" data-testid="search-total">
              {{ total() }} {{ total() === 1 ? 'documento' : 'documentos' }}
            </p>
            <app-document-file-list
              [files]="files()"
              [canEdit]="canManage"
              (edit)="openProfile($event)"
            />
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="total()"
                [limit]="limit"
                (pageChange)="onPageChange($event)"
              />
            </div>
          </div>
        }
      </app-card>
    </div>

    <app-file-profile-modal
      [(isOpen)]="profileOpen"
      [file]="editing()"
      (saved)="onSaved($event)"
    />
  `,
})
export class DocumentsSearchPageComponent implements OnInit {
  private readonly api = inject(DocumentsLibraryApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly limit = 20;
  readonly subjectOptions = [{ value: '', label: 'Todos' }, ...SUBJECT_TYPE_OPTIONS];
  readonly canManage = this.auth.isOwner() || this.auth.hasPermission('store:workflows:manage');

  readonly q = signal('');
  readonly docType = signal('');
  readonly tag = signal('');
  readonly subjectType = signal('');
  readonly page = signal(1);
  readonly total = signal(0);
  readonly files = signal<LibraryFile[]>([]);
  readonly loading = signal(false);
  readonly totalPages = computed(() => Math.ceil(this.total() / this.limit) || 1);
  readonly hasFilters = computed(
    () => !!(this.q() || this.docType() || this.tag() || this.subjectType()),
  );

  readonly profileOpen = signal(false);
  readonly editing = signal<LibraryFile | null>(null);

  private readonly filterChange$ = new Subject<void>();
  private readonly request$ = new Subject<void>();

  ngOnInit(): void {
    this.filterChange$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.page.set(1);
        this.request$.next();
      });
    this.request$
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(() =>
          this.api
            .search({
              q: this.q() || undefined,
              doc_type: this.docType().trim() || undefined,
              tag: this.tag().trim() || undefined,
              subject_type: this.subjectType() || undefined,
              page: this.page(),
              limit: this.limit,
            })
            .pipe(
              catchError((error) => {
                this.loading.set(false);
                this.toast.error(libraryErrorMessage(error));
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.files.set(res.data ?? []);
        this.total.set(res.meta?.total ?? res.data?.length ?? 0);
        this.loading.set(false);
      });
    this.request$.next();
  }

  onSearch(term: string): void {
    this.q.set(term ?? '');
    this.filterChange$.next();
  }

  onDocType(value: string | null): void {
    this.docType.set(value ?? '');
    this.filterChange$.next();
  }

  onTag(value: string | null): void {
    this.tag.set(value ?? '');
    this.filterChange$.next();
  }

  onSubjectType(value: string | number | null): void {
    this.subjectType.set(value ? String(value) : '');
    this.filterChange$.next();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.request$.next();
  }

  openProfile(file: LibraryFile): void {
    this.editing.set(file);
    this.profileOpen.set(true);
  }

  onSaved(updated: LibraryFile): void {
    this.files.update((list) => list.map((f) => (f.id === updated.id ? updated : f)));
  }
}
