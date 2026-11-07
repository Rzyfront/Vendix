import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  PaginationComponent,
  SelectorComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { DocumentsTabsComponent } from '../../components/documents-tabs.component';
import { FileProfileModalComponent } from '../../components/file-profile-modal.component';
import {
  ExpiringRow,
  LibraryFile,
  dateOnlyText,
  daysLeftText,
  subjectSingular,
} from '../../interfaces/document-library.interfaces';
import {
  DocumentsLibraryApiService,
  libraryErrorMessage,
} from '../../services/documents-library-api.service';

const LIMIT = 20;
const WINDOW_OPTIONS = [
  { value: 30, label: 'Próximos 30 días' },
  { value: 60, label: 'Próximos 60 días' },
  { value: 90, label: 'Próximos 90 días' },
  { value: 365, label: 'Próximo año' },
];

/** "Por vencer": documents close to (or past) their expiry date and their renewal request. */
@Component({
  selector: 'app-documents-expiring-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    StickyHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    PaginationComponent,
    EmptyStateComponent,
    DocumentsTabsComponent,
    FileProfileModalComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Documentos"
        subtitle="Documentos por vencer y su renovación"
        icon="folder-open"
        variant="glass"
      />
      <app-documents-tabs active="expiring" />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="flex items-center justify-between gap-3 border-b border-border px-2 py-3 md:px-6 md:py-4">
          <h2 class="text-[13px] font-bold text-gray-600 md:text-lg md:font-semibold md:text-text-primary">
            Por vencer ({{ total() }})
          </h2>
          <div class="w-48">
            <app-selector
              size="sm"
              [options]="windowOptions"
              [ngModel]="days()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onDays($event)"
            />
          </div>
        </div>

        @if (loading()) {
          <div class="p-4 text-center md:p-6">
            <div class="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando vencimientos...</p>
          </div>
        } @else if (total() === 0) {
          <app-empty-state
            icon="calendar-clock"
            title="No hay documentos por vencer"
            description="Ponle tipo y fecha de vencimiento a un archivo desde Buscar o Carpetas y Vendix te avisará 30 días antes."
            [showActionButton]="false"
          />
        } @else {
          <ul class="flex flex-col gap-2 px-2 pb-2 pt-3 md:p-4" data-testid="expiring-list">
            @for (row of rows(); track row.file_id) {
              <li
                class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <app-icon name="file-text" [size]="16" class="text-text-secondary" />
                    <span class="truncate text-sm font-medium text-text-primary">{{ row.file_name }}</span>
                    @if (row.doc_type) {
                      <app-badge variant="primary" size="xs">{{ row.doc_type }}</app-badge>
                    }
                    <app-badge [variant]="row.days_left < 0 ? 'error' : 'warning'" size="xs">
                      {{ daysText(row.days_left) }}
                    </app-badge>
                  </div>
                  <p class="mt-1 text-xs text-text-secondary">
                    Vence el {{ dateText(row.valid_until) }}
                    @if (row.dossier) {
                      · {{ row.dossier.reference }}
                    }
                    @if (row.subject_type) {
                      · {{ subjectText(row.subject_type) }}
                    }
                  </p>
                  <p class="mt-1 text-xs">
                    @if (row.renewal; as renewal) {
                      Renovación:
                      <a
                        class="text-primary hover:underline"
                        [routerLink]="['/admin/workflows/instances', renewal.id]"
                        >{{ renewal.reference }} · {{ renewal.title }}</a
                      >
                    } @else {
                      <span class="text-text-secondary">Sin solicitud de renovación</span>
                    }
                  </p>
                </div>
                @if (canManage) {
                  <app-button variant="outline" size="sm" (clicked)="openProfile(row)">
                    <app-icon name="pencil" [size]="14" slot="icon" />
                    Editar datos
                  </app-button>
                }
              </li>
            }
          </ul>
          <div class="flex justify-center pb-4">
            <app-pagination
              [currentPage]="page()"
              [totalPages]="totalPages()"
              [total]="total()"
              [limit]="limit"
              (pageChange)="onPageChange($event)"
            />
          </div>
        }
      </app-card>
    </div>

    <app-file-profile-modal
      [(isOpen)]="profileOpen"
      [file]="editing()"
      (saved)="onSaved()"
    />
  `,
})
export class DocumentsExpiringPageComponent implements OnInit {
  private readonly api = inject(DocumentsLibraryApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly limit = LIMIT;
  readonly windowOptions = WINDOW_OPTIONS;
  readonly canManage = this.auth.isOwner() || this.auth.hasPermission('store:workflows:manage');

  readonly days = signal(30);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly rows = signal<ExpiringRow[]>([]);
  readonly loading = signal(false);
  readonly totalPages = computed(() => Math.ceil(this.total() / LIMIT) || 1);

  readonly profileOpen = signal(false);
  readonly editing = signal<LibraryFile | null>(null);

  private readonly request$ = new Subject<void>();

  ngOnInit(): void {
    this.request$
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap(() =>
          this.api.expiring({ days: this.days(), page: this.page(), limit: LIMIT }).pipe(
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
        this.rows.set(res.data ?? []);
        this.total.set(res.meta?.total ?? res.data?.length ?? 0);
        this.loading.set(false);
      });
    this.request$.next();
  }

  daysText(days: number): string {
    return daysLeftText(days);
  }

  dateText(value: string): string {
    return dateOnlyText(value);
  }

  subjectText(type: string): string {
    return subjectSingular(type);
  }

  onDays(value: string | number | null): void {
    this.days.set(Number(value) || 30);
    this.page.set(1);
    this.request$.next();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.request$.next();
  }

  openProfile(row: ExpiringRow): void {
    this.editing.set({
      id: row.file_id,
      original_name: row.file_name,
      mime_type: '',
      size_bytes: 0,
      created_at: '',
      legal_hold: row.legal_hold,
      doc_type: row.doc_type,
      tags: row.tags,
      valid_until: row.valid_until,
      dossier: row.dossier,
      subject: null,
      request: null,
    });
    this.profileOpen.set(true);
  }

  /** The date may have moved out of the window: reload the list. */
  onSaved(): void {
    this.request$.next();
  }
}
