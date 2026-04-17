import {Component, OnInit, inject, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router, RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HelpCenterAdminService } from './services/help-center-admin.service';
import {
  ArticleStats,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './interfaces/help-center-admin.interface';
import {
  HelpArticle,
  HelpCategory,
} from '../../../modules/store/help/models/help-article.model';
import { CategoriesTabComponent } from './components/categories-tab/categories-tab.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../shared/components/selector/selector.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';
import {
  TableColumn,
  TableAction,
} from '../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../shared/components/index';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { CardComponent } from '../../../../shared/components';

@Component({
  selector: 'app-help-center-admin',
  standalone: true,
  imports: [
    RouterModule,
    ReactiveFormsModule,
    CategoriesTabComponent,
    ButtonComponent,
    SelectorComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    ConfirmationModalComponent,
    CardComponent
],
  template: `
    <!-- Standard Module Layout -->
    <div class="flex flex-col gap-4 p-6">
      <!-- Stats Grid -->
      <div class="stats-container">
        <app-stats
          title="Total Artículos"
          [value]="stats()?.total || 0"
          iconName="file-text"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-600"
        ></app-stats>
    
        <app-stats
          title="Publicados"
          [value]="stats()?.published || 0"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
    
        <app-stats
          title="Borradores"
          [value]="stats()?.draft || 0"
          iconName="edit-3"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
    
        <app-stats
          title="Vistas Totales"
          [value]="stats()?.total_views || 0"
          iconName="eye"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>
    
      <!-- Main Content Card -->
      <app-card [padding]="false" overflow="hidden">
        <!-- Tabs -->
        <div class="flex items-center gap-1 border-b border-border">
          <button
            class="px-4 py-2.5 text-sm font-medium transition-colors relative"
            [class.text-primary]="activeTab() === 'articles'"
            [class.text-text-secondary]="activeTab() !== 'articles'"
            (click)="activeTab.set('articles')"
            >
            Artículos
            @if (activeTab() === 'articles') {
              <span
                class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full"
              ></span>
            }
          </button>
          <button
            class="px-4 py-2.5 text-sm font-medium transition-colors relative"
            [class.text-primary]="activeTab() === 'categories'"
            [class.text-text-secondary]="activeTab() !== 'categories'"
            (click)="activeTab.set('categories')"
            >
            Categorías
            @if (activeTab() === 'categories') {
              <span
                class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full"
              ></span>
            }
          </button>
        </div>
    
        <!-- Articles Tab -->
        @if (activeTab() === 'articles') {
          <div>
            <!-- Header -->
            <div
              class="p-4 md:px-6 md:py-4 border-b border-[var(--color-border)] flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between"
              >
              <div class="flex-1 min-w-0">
                <h3 class="text-lg font-semibold text-text-primary">
                  Artículos de Ayuda
                </h3>
                <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
                  Gestiona el contenido del centro de ayuda.
                </p>
              </div>
              <div
                class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
                >
                <div class="w-full sm:w-60">
                  <app-inputsearch
                    placeholder="Buscar artículos..."
                    [debounceTime]="300"
                    (searchChange)="onSearch($event)"
                    size="sm"
                    fullWidth="true"
                  ></app-inputsearch>
                </div>
                <div class="w-full sm:w-40">
                  <app-selector
                    placeholder="Estado"
                    [options]="statusFilterOptions"
                    [formControl]="statusFilterControl"
                    size="sm"
                    variant="outline"
                  ></app-selector>
                </div>
                <div class="w-full sm:w-40">
                  <app-selector
                    placeholder="Tipo"
                    [options]="typeFilterOptions"
                    [formControl]="typeFilterControl"
                    size="sm"
                    variant="outline"
                  ></app-selector>
                </div>
                <div class="flex gap-2 items-center sm:ml-auto">
                  <app-button
                    variant="primary"
                    size="sm"
                    iconName="plus"
                    (clicked)="navigateToCreate()"
                    >
                    <span class="hidden sm:inline">Nuevo artículo</span>
                  </app-button>
                </div>
              </div>
            </div>
            <!-- Table Container -->
            <div class="relative min-h-[400px] p-2 md:p-4">
              @if (loading()) {
                <div
                  class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center"
                  >
                  <div
                    class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
                  ></div>
                </div>
              }
              <app-responsive-data-view
                [data]="articles()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [loading]="loading()"
                emptyMessage="No se encontraron artículos"
                emptyIcon="file-text"
                >
              </app-responsive-data-view>
            </div>
          </div>
        }
    
        <!-- Categories Tab -->
        @if (activeTab() === 'categories') {
          <app-categories-tab
          ></app-categories-tab>
        }
      </app-card>
    </div>
    
    <!-- Delete Confirmation Modal -->
    <app-confirmation-modal
      [(isOpen)]="isDeleteConfirmOpen"
      title="Eliminar Artículo"
      message="¿Estás seguro de eliminar este artículo? Esta acción no se puede deshacer."
      confirmText="Eliminar"
      confirmVariant="danger"
      (confirm)="onConfirmDelete()"
      (cancel)="isDeleteConfirmOpen = false"
    ></app-confirmation-modal>
    `,
})
export class HelpCenterAdminComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private service = inject(HelpCenterAdminService);
  private toast = inject(ToastService);
  private router = inject(Router);

  // Signals
  articles = signal<HelpArticle[]>([]);
  stats = signal<ArticleStats | null>(null);
  loading = signal<boolean>(false);
  activeTab = signal<'articles' | 'categories'>('articles');

  // Controls
  statusFilterControl = new FormControl<string | null>(null);
  typeFilterControl = new FormControl<string | null>(null);
  private searchQuery = '';

  // Delete confirmation
  isDeleteConfirmOpen = false;
  private articleToDelete?: HelpArticle;

  // Filter options
  statusFilterOptions: SelectorOption[] = [
    { label: 'Todos', value: '' },
    { label: 'Publicado', value: 'PUBLISHED' },
    { label: 'Borrador', value: 'DRAFT' },
    { label: 'Archivado', value: 'ARCHIVED' },
  ];

  typeFilterOptions: SelectorOption[] = [
    { label: 'Todos', value: '' },
    { label: 'Tutorial', value: 'TUTORIAL' },
    { label: 'FAQ', value: 'FAQ' },
    { label: 'Guía', value: 'GUIDE' },
    { label: 'Anuncio', value: 'ANNOUNCEMENT' },
    { label: 'Nota de versión', value: 'RELEASE_NOTE' },
  ];

  // Table Config
  columns: TableColumn[] = [
    {
      key: 'title',
      label: 'Título',
      width: '30%',
    },
    {
      key: 'category',
      label: 'Categoría',
      width: '15%',
      transform: (val: any) => val?.name || '-',
    },
    {
      key: 'type',
      label: 'Tipo',
      width: '12%',
      badge: true,
      transform: (val: string) => this.formatEnumLabel(val),
      badgeConfig: {
        type: 'custom',
        colorMap: {
          TUTORIAL: 'bg-blue-100 text-blue-800',
          FAQ: 'bg-green-100 text-green-800',
          GUIDE: 'bg-purple-100 text-purple-800',
          ANNOUNCEMENT: 'bg-orange-100 text-orange-800',
          RELEASE_NOTE: 'bg-cyan-100 text-cyan-800',
          default: 'bg-gray-100 text-gray-800',
        },
      },
    },
    {
      key: 'status',
      label: 'Estado',
      width: '12%',
      badge: true,
      transform: (val: string) => this.formatStatusLabel(val),
      badgeConfig: {
        type: 'custom',
        colorMap: {
          PUBLISHED: 'bg-green-100 text-green-800',
          DRAFT: 'bg-yellow-100 text-yellow-800',
          ARCHIVED: 'bg-gray-100 text-gray-800',
          default: 'bg-gray-100 text-gray-800',
        },
      },
    },
    {
      key: 'view_count',
      label: 'Vistas',
      width: '10%',
    },
    {
      key: 'created_at',
      label: 'Fecha',
      width: '15%',
      transform: (val: string) => new Date(val).toLocaleDateString(),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'info',
      action: (item: HelpArticle) => this.navigateToEdit(item),
    },
    {
      label: 'Publicar',
      icon: 'check-circle',
      variant: 'success',
      show: (item: HelpArticle) => item.status !== 'PUBLISHED',
      action: (item: HelpArticle) => this.toggleStatus(item, 'PUBLISHED'),
    },
    {
      label: 'Despublicar',
      icon: 'eye-off',
      variant: 'ghost',
      show: (item: HelpArticle) => item.status === 'PUBLISHED',
      action: (item: HelpArticle) => this.toggleStatus(item, 'DRAFT'),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: HelpArticle) => this.confirmDelete(item),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'category',
    subtitleTransform: (item: HelpArticle) => item.category?.name || '-',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        PUBLISHED: 'bg-green-100 text-green-800',
        DRAFT: 'bg-yellow-100 text-yellow-800',
        ARCHIVED: 'bg-gray-100 text-gray-800',
      },
    },
    badgeTransform: (val: string) => this.formatStatusLabel(val),
    detailKeys: [
      {
        key: 'type',
        label: 'Tipo',
        transform: (val: string) => this.formatEnumLabel(val),
      },
      { key: 'view_count', label: 'Vistas' },
      {
        key: 'created_at',
        label: 'Fecha',
        transform: (val: string) => new Date(val).toLocaleDateString(),
      },
    ],
  };

  ngOnInit() {
    this.loadArticles();
    this.loadStats();

    // Subscribe to filter changes
    this.statusFilterControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadArticles());
    this.typeFilterControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadArticles());
  }

  loadArticles() {
    this.loading.set(true);
    const params: any = {};
    if (this.searchQuery) params.search = this.searchQuery;
    if (this.statusFilterControl.value)
      params.status = this.statusFilterControl.value;
    if (this.typeFilterControl.value)
      params.type = this.typeFilterControl.value;

    this.service.getArticles(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.articles.set(response.data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading articles', err);
        this.toast.error('Error al cargar los artículos');
        this.loading.set(false);
      },
    });
  }

  loadStats() {
    this.service.getArticleStats().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => this.stats.set(data),
      error: (err) => console.error('Error loading stats', err),
    });
  }

  onSearch(query: string) {
    this.searchQuery = query;
    this.loadArticles();
  }

  navigateToCreate() {
    this.router.navigate(['/super-admin/help-center/articles/new']);
  }

  navigateToEdit(article: HelpArticle) {
    this.router.navigate([
      `/super-admin/help-center/articles/${article.id}/edit`,
    ]);
  }

  toggleStatus(article: HelpArticle, newStatus: string) {
    this.service.updateArticle(article.id, { status: newStatus }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          newStatus === 'PUBLISHED'
            ? 'Artículo publicado'
            : 'Artículo despublicado',
        );
        this.loadArticles();
        this.loadStats();
      },
      error: (err) => {
        this.toast.error('Error al cambiar el estado');
        console.error(err);
      },
    });
  }

  confirmDelete(article: HelpArticle) {
    this.articleToDelete = article;
    this.isDeleteConfirmOpen = true;
  }

  onConfirmDelete() {
    if (!this.articleToDelete) return;
    this.service.deleteArticle(this.articleToDelete.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Artículo eliminado');
        this.isDeleteConfirmOpen = false;
        this.articleToDelete = undefined;
        this.loadArticles();
        this.loadStats();
      },
      error: (err) => {
        this.toast.error('Error al eliminar el artículo');
        console.error(err);
      },
    });
  }

  formatEnumLabel(type: string): string {
    if (!type) return '';
    const labels: Record<string, string> = {
      TUTORIAL: 'Tutorial',
      FAQ: 'FAQ',
      GUIDE: 'Guía',
      ANNOUNCEMENT: 'Anuncio',
      RELEASE_NOTE: 'Nota de versión',
    };
    return labels[type] || type.replace(/_/g, ' ');
  }

  formatStatusLabel(status: string): string {
    if (!status) return '';
    const labels: Record<string, string> = {
      PUBLISHED: 'Publicado',
      DRAFT: 'Borrador',
      ARCHIVED: 'Archivado',
    };
    return labels[status] || status;
  }
}
