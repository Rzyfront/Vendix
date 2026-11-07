import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  AlertBannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  StickyHeaderComponent,
} from '../../../../../../../shared/components/index';
import { toWorkflowError } from '../../../utils/workflow-errors.util';
import { CollectionView } from '../../interfaces/records.interfaces';
import { RecordsApiService } from '../../services/records-api.service';

/** `/admin/workflows/records`: the store's custom collections (contracts, assets, policies...). */
@Component({
  selector: 'app-collections-page',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Registros"
        subtitle="Gestiona lo que Vendix no trae: contratos, activos, pólizas, trámites, con sus propios campos"
        icon="folder-open"
        variant="glass"
        [actions]="headerActions"
        (actionClicked)="onHeaderAction($event)"
      />

      @if (errorMessage()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ errorMessage() }}</app-alert-banner>
      } @else if (loading()) {
        <p class="py-8 text-center text-sm text-text-secondary" role="status">Cargando colecciones...</p>
      } @else if (collections().length === 0) {
        <app-empty-state
          icon="folder-open"
          title="Aún no tienes colecciones"
          description="Crea una colección, por ejemplo Contratos, define sus campos y empieza a registrar."
          actionButtonText="Nueva colección"
          (actionClick)="create()"
        />
      } @else {
        <div class="grid grid-cols-1 gap-3 p-2 md:grid-cols-2 md:gap-4 md:p-4 xl:grid-cols-3">
          @for (c of collections(); track c.id) {
            <article
              class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
              [attr.aria-label]="c.name"
              data-testid="collection-card"
            >
              <header class="flex items-start gap-3">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background text-primary"
                >
                  <app-icon [name]="c.icon || 'folder-open'" [size]="20" />
                </span>
                <div class="min-w-0">
                  <h2 class="truncate text-base font-semibold text-text-primary">{{ c.name }}</h2>
                  <p class="text-sm text-text-secondary">
                    {{ countText(c) }}
                  </p>
                </div>
              </header>
              @if (c.description) {
                <p class="text-sm text-text-secondary">{{ c.description }}</p>
              }
              <p class="text-xs text-text-secondary">
                {{ c.fields.length }} {{ c.fields.length === 1 ? 'campo' : 'campos' }} · Referencias
                {{ c.reference_prefix }}-000001
              </p>
              <footer class="mt-auto flex flex-wrap gap-2 pt-1">
                <app-button variant="primary" size="sm" (clicked)="open(c)">
                  <app-icon name="folder-open" [size]="14" slot="icon" />
                  Abrir
                </app-button>
                <app-button variant="outline" size="sm" (clicked)="design(c)">
                  <app-icon name="pencil" [size]="14" slot="icon" />
                  Diseñar
                </app-button>
              </footer>
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class CollectionsPageComponent implements OnInit {
  private readonly api = inject(RecordsApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly headerActions = [
    { id: 'new', label: 'Nueva colección', icon: 'plus', variant: 'primary' as const },
  ];

  readonly collections = signal<CollectionView[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.api
      .listCollections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.collections.set(rows);
          this.loading.set(false);
        },
        error: (error) => {
          this.errorMessage.set(toWorkflowError(error).message);
          this.loading.set(false);
        },
      });
  }

  countText(c: CollectionView): string {
    const n = c.records_count ?? 0;
    return `${n} ${n === 1 ? 'registro' : 'registros'}`;
  }

  onHeaderAction(id: string): void {
    if (id === 'new') this.create();
  }

  create(): void {
    this.router.navigate(['/admin/workflows/records/collections/new']);
  }

  open(c: CollectionView): void {
    this.router.navigate(['/admin/workflows/records/collections', c.id]);
  }

  design(c: CollectionView): void {
    this.router.navigate(['/admin/workflows/records/collections', c.id, 'edit']);
  }
}
