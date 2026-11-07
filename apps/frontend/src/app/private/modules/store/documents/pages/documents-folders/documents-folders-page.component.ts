import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  BadgeComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  PaginationComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { DocumentFileListComponent } from '../../components/document-file-list.component';
import { DocumentsTabsComponent } from '../../components/documents-tabs.component';
import { FileProfileModalComponent } from '../../components/file-profile-modal.component';
import {
  FolderEntity,
  FolderFilesResult,
  FolderGroup,
  LibraryFile,
  folderLabel,
  subjectSingular,
} from '../../interfaces/document-library.interfaces';
import {
  DocumentsLibraryApiService,
  libraryErrorMessage,
} from '../../services/documents-library-api.service';

const LIMIT = 20;

/**
 * "Carpetas": dossiers grouped by kind of entity (customer, supplier,
 * employee, custom collection...). Three levels on one page, by route:
 * `folders` (kinds), `folders/:subjectType` (entities) and
 * `folders/:subjectType/:subjectId` (every file of every dossier of the entity).
 */
@Component({
  selector: 'app-documents-folders-page',
  standalone: true,
  imports: [
    RouterLink,
    StickyHeaderComponent,
    CardComponent,
    BadgeComponent,
    IconComponent,
    EmptyStateComponent,
    PaginationComponent,
    DocumentsTabsComponent,
    DocumentFileListComponent,
    FileProfileModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Documentos"
        [subtitle]="subtitle()"
        icon="folder-open"
        variant="glass"
      />
      <app-documents-tabs active="folders" />

      @if (level() !== 'groups') {
        <div class="px-2 pb-2 md:px-0">
          <a
            class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            [routerLink]="backLink()"
            [queryParams]="backParams()"
          >
            <app-icon name="chevron-left" [size]="14" />
            {{ level() === 'files' ? 'Volver a ' + folderTitle() : 'Volver a Carpetas' }}
          </a>
        </div>
      }

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        @if (loading()) {
          <div class="p-4 text-center md:p-6">
            <div class="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando carpetas...</p>
          </div>
        } @else if (level() === 'groups') {
          @if (groups().length === 0) {
            <app-empty-state
              icon="folder-open"
              title="Aún no hay carpetas"
              description="Las carpetas aparecen cuando una solicitud de un cliente, proveedor, empleado o registro tiene archivos."
              [showActionButton]="false"
            />
          } @else {
            <div class="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 md:p-4" data-testid="folder-groups">
              @for (group of groups(); track groupKey(group)) {
                <button
                  type="button"
                  class="flex items-center gap-3 rounded-xl border border-border p-4 text-left hover:bg-background"
                  (click)="openGroup(group)"
                >
                  <app-icon name="folder" [size]="28" class="text-primary" />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold text-text-primary">
                      {{ groupLabel(group) }}
                    </span>
                    <span class="block text-xs text-text-secondary">
                      {{ group.entities }} {{ group.entities === 1 ? 'carpeta' : 'carpetas' }} ·
                      {{ group.files }} {{ group.files === 1 ? 'archivo' : 'archivos' }}
                    </span>
                  </span>
                </button>
              }
            </div>
          }
        } @else if (level() === 'entities') {
          @if (entities().length === 0) {
            <app-empty-state
              icon="folder-open"
              title="Esta carpeta está vacía"
              description="No hay entidades con expedientes de este tipo."
              [showActionButton]="false"
            />
          } @else {
            <div class="flex flex-col gap-2 p-3 md:p-4" data-testid="folder-entities">
              @for (entity of entities(); track entity.id) {
                <button
                  type="button"
                  class="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-left hover:bg-background"
                  (click)="openEntity(entity)"
                >
                  <span class="flex min-w-0 items-center gap-3">
                    <app-icon name="folder" [size]="20" class="text-primary" />
                    <span class="truncate text-sm font-medium text-text-primary">{{ entity.label }}</span>
                  </span>
                  <span class="flex shrink-0 gap-2">
                    <app-badge variant="neutral" size="xs">
                      {{ entity.dossiers }} {{ entity.dossiers === 1 ? 'expediente' : 'expedientes' }}
                    </app-badge>
                    <app-badge variant="primary" size="xs">
                      {{ entity.files }} {{ entity.files === 1 ? 'archivo' : 'archivos' }}
                    </app-badge>
                  </span>
                </button>
              }
              <div class="mt-2 flex justify-center">
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
        } @else if (detail(); as d) {
          <div class="flex flex-col gap-3 p-3 md:p-4">
            <div class="flex flex-wrap items-center gap-2" data-testid="folder-dossiers">
              <span class="text-sm font-semibold text-text-primary">{{ d.subject.label }}</span>
              @for (dossier of d.dossiers; track dossier.id) {
                <app-badge variant="neutral" size="xs">{{ dossier.reference }}</app-badge>
              }
            </div>
            @if (files().length === 0) {
              <app-empty-state
                icon="file-text"
                title="Sin archivos"
                description="Esta carpeta aún no tiene archivos vigentes."
                [showActionButton]="false"
              />
            } @else {
              <app-document-file-list
                [files]="files()"
                [canEdit]="canManage"
                (edit)="openProfile($event)"
              />
              <div class="flex justify-center">
                <app-pagination
                  [currentPage]="page()"
                  [totalPages]="totalPages()"
                  [total]="total()"
                  [limit]="limit"
                  (pageChange)="onPageChange($event)"
                />
              </div>
            }
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
export class DocumentsFoldersPageComponent {
  private readonly api = inject(DocumentsLibraryApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly limit = LIMIT;
  readonly canManage = this.auth.isOwner() || this.auth.hasPermission('store:workflows:manage');

  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly subjectType = computed(() => this.params().get('subjectType'));
  readonly subjectId = computed(() => {
    const raw = this.params().get('subjectId');
    return raw ? Number(raw) : null;
  });
  readonly collection = computed(() => this.query().get('collection'));
  readonly level = computed<'groups' | 'entities' | 'files'>(() => {
    if (this.subjectType() && this.subjectId() !== null) return 'files';
    return this.subjectType() ? 'entities' : 'groups';
  });

  readonly loading = signal(false);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.total() / LIMIT) || 1);
  readonly groups = signal<FolderGroup[]>([]);
  readonly entities = signal<FolderEntity[]>([]);
  readonly detail = signal<FolderFilesResult | null>(null);
  readonly files = signal<LibraryFile[]>([]);

  readonly profileOpen = signal(false);
  readonly editing = signal<LibraryFile | null>(null);

  readonly folderTitle = computed(() => {
    const type = this.subjectType();
    return type ? folderLabel(type, this.currentCollectionName()) : 'Carpetas';
  });
  readonly subtitle = computed(() =>
    this.level() === 'groups'
      ? 'Carpetas por cliente, proveedor, empleado o registro'
      : this.level() === 'entities'
        ? this.folderTitle()
        : `${subjectSingular(this.subjectType())}: ${this.detail()?.subject.label ?? ''}`,
  );
  readonly backLink = computed(() =>
    this.level() === 'files' && this.subjectType()
      ? ['/admin/documents/folders', this.subjectType()!]
      : ['/admin/documents/folders'],
  );
  readonly backParams = computed(() =>
    this.level() === 'files' && this.collection() ? { collection: this.collection() } : {},
  );

  private currentCollectionName(): string | null {
    const key = this.collection();
    if (!key) return null;
    const detail = this.detail()?.subject.collection_name;
    return detail ?? this.groups().find((g) => g.collection_key === key)?.collection_name ?? this.entities()[0]?.collection_name ?? null;
  }

  constructor() {
    effect(() => {
      // Reload whenever the route (level, type, entity, collection) changes.
      this.level();
      this.subjectType();
      this.subjectId();
      this.collection();
      untracked(() => {
        this.page.set(1);
        this.load();
      });
    });
  }

  groupKey(group: FolderGroup): string {
    return `${group.subject_type}|${group.collection_key ?? ''}`;
  }

  groupLabel(group: FolderGroup): string {
    return folderLabel(group.subject_type, group.collection_name);
  }

  openGroup(group: FolderGroup): void {
    this.router.navigate(['/admin/documents/folders', group.subject_type], {
      queryParams: group.collection_key ? { collection: group.collection_key } : {},
    });
  }

  openEntity(entity: FolderEntity): void {
    this.router.navigate(['/admin/documents/folders', entity.subject_type, entity.id], {
      queryParams: entity.collection_key ? { collection: entity.collection_key } : {},
    });
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  openProfile(file: LibraryFile): void {
    this.editing.set(file);
    this.profileOpen.set(true);
  }

  onSaved(updated: LibraryFile): void {
    this.files.update((list) => list.map((f) => (f.id === updated.id ? updated : f)));
  }

  private inflight: Subscription | null = null;

  private fail(error: unknown): void {
    this.loading.set(false);
    this.toast.error(libraryErrorMessage(error));
  }

  private load(): void {
    this.inflight?.unsubscribe();
    this.loading.set(true);
    const type = this.subjectType();
    const id = this.subjectId();
    if (!type) {
      this.inflight = this.api
        .folders()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (groups) => {
            this.groups.set(groups);
            this.loading.set(false);
          },
          error: (error) => this.fail(error),
        });
    } else if (id === null) {
      this.inflight = this.api
        .folderEntities(type, {
          collection: this.collection() ?? undefined,
          page: this.page(),
          limit: LIMIT,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.entities.set(res.data ?? []);
            this.total.set(res.meta?.total ?? res.data?.length ?? 0);
            this.loading.set(false);
          },
          error: (error) => this.fail(error),
        });
    } else {
      this.inflight = this.api
        .folderFiles(type, id, { page: this.page(), limit: LIMIT })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.detail.set(res);
            this.files.set(res.data ?? []);
            this.total.set(res.total ?? 0);
            this.loading.set(false);
          },
          error: (error) => this.fail(error),
        });
    }
  }
}
