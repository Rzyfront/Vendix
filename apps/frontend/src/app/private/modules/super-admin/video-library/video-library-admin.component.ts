import { Component, OnInit, inject, signal, computed, DestroyRef, viewChild, TemplateRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { VideoLibraryAdminService } from './services/video-library-admin.service';
import {
  Video,
  VideoCategory,
  VideoStats,
} from '../../store/help/video-library/models/video.model';
import { VideoCategoriesTabComponent } from './components/video-categories-tab/video-categories-tab.component';
import { VideoSeriesTabComponent } from './components/video-series-tab/video-series-tab.component';
import { BadgeComponent } from '../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../shared/components/tooltip/tooltip.component';
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
  PaginationComponent,
} from '../../../../shared/components/index';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-video-library-admin',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    VideoCategoriesTabComponent,
    VideoSeriesTabComponent,
    BadgeComponent,
    TooltipComponent,
    ButtonComponent,
    SelectorComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    ConfirmationModalComponent,
    CardComponent,
  ],
  template: `
    <ng-template #titleCell let-video>
      <div class="flex flex-col gap-1 items-start min-w-0">
        <span class="font-medium truncate max-w-full">{{ video.title }}</span>
        @if (video.search_text_insufficient) {
          <app-tooltip
            color="warning"
            position="bottom"
            content="Completa el resumen, la descripción, las etiquetas y las palabras clave para que Vex y el buscador encuentren este video."
          >
            <span tabindex="0" class="inline-flex">
              <app-badge variant="warning" size="xs">Texto insuficiente para búsqueda</app-badge>
            </span>
          </app-tooltip>
        }
      </div>
    </ng-template>

    <div class="flex flex-col gap-5 p-4 md:p-6 max-w-7xl mx-auto w-full">
      <!-- Stats Grid -->
      <div class="stats-container">
        <app-stats
          title="Total Videos"
          [value]="stats()?.total || 0"
          iconName="video"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Publicados"
          [value]="stats()?.published || 0"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
        ></app-stats>

        <app-stats
          title="Borradores"
          [value]="stats()?.draft || 0"
          iconName="edit-3"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
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
        <div class="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800 px-4 pt-2">
          <button
            class="px-4 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer"
            [class.border-primary]="activeTab() === 'videos'"
            [class.text-primary]="activeTab() === 'videos'"
            [class.border-transparent]="activeTab() !== 'videos'"
            [class.text-neutral-500]="activeTab() !== 'videos'"
            (click)="setTab('videos')"
          >
            Videos de Capacitación
          </button>
          <button
            class="px-4 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer"
            [class.border-primary]="activeTab() === 'categories'"
            [class.text-primary]="activeTab() === 'categories'"
            [class.border-transparent]="activeTab() !== 'categories'"
            [class.text-neutral-500]="activeTab() !== 'categories'"
            (click)="setTab('categories')"
          >
            Categorías
          </button>
          <button
            class="px-4 py-3 text-sm font-semibold transition-colors border-b-2 cursor-pointer"
            [class.border-primary]="activeTab() === 'series'"
            [class.text-primary]="activeTab() === 'series'"
            [class.border-transparent]="activeTab() !== 'series'"
            [class.text-neutral-500]="activeTab() !== 'series'"
            (click)="setTab('series')"
          >
            Series
          </button>
        </div>

        <!-- Tab 1: Videos -->
        @if (activeTab() === 'videos') {
          <div class="p-4 md:p-6 flex flex-col gap-4">
            <!-- Filter Bar -->
            <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div class="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center flex-wrap gap-3">
                <div class="w-full sm:w-64 md:w-72">
                  <app-inputsearch
                    placeholder="Buscar videos..."
                    (searchChange)="onSearch($event)"
                  ></app-inputsearch>
                </div>
                <div class="w-full sm:w-60 md:w-64">
                  <app-selector
                    placeholder="Categoría"
                    [options]="categoryOptions()"
                    [formControl]="categoryControl"
                  ></app-selector>
                </div>
                <div class="w-full sm:w-48 md:w-52">
                  <app-selector
                    placeholder="Estado"
                    [options]="statusOptions"
                    [formControl]="statusControl"
                  ></app-selector>
                </div>
              </div>

              <app-button
                variant="primary"
                size="sm"
                iconName="plus"
                routerLink="/super-admin/video-library/new"
              >
                Nuevo Video
              </app-button>
            </div>

            <!-- Data View -->
            <app-responsive-data-view
              [data]="videos()"
              [columns]="tableColumns()"
              [actions]="tableActions"
              [cardConfig]="cardConfig"
              [loading]="loadingVideos()"
              emptyMessage="No se encontraron videos de capacitación."
              emptySubMessage="Crea tu primer video para comenzar a capacitar a las tiendas."
            ></app-responsive-data-view>

            @if (totalPages() > 1) {
              <div class="flex justify-center pt-2">
                <app-pagination
                  [currentPage]="page()"
                  [totalPages]="totalPages()"
                  [total]="totalVideos()"
                  [limit]="limit"
                  infoStyle="range"
                  (pageChange)="onPageChange($event)"
                />
              </div>
            }
          </div>
        }

        <!-- Tab 2: Categories -->
        @if (activeTab() === 'categories') {
          <app-video-categories-tab></app-video-categories-tab>
        }

        <!-- Tab 3: Series (learning paths) -->
        @if (activeTab() === 'series') {
          <app-video-series-tab></app-video-series-tab>
        }
      </app-card>

      <!-- Confirmation Modal -->
      <app-confirmation-modal
        [(isOpen)]="isDeleteModalOpen"
        title="Eliminar Video"
        [message]="'¿Estás seguro de eliminar el video \\'' + (videoToDelete()?.title || '') + '\\'?'"
        confirmText="Eliminar"
        confirmVariant="danger"
        (confirm)="deleteVideo()"
        (cancel)="isDeleteModalOpen.set(false)"
      ></app-confirmation-modal>
    </div>
  `,
})
export class VideoLibraryAdminComponent implements OnInit {
  private videoService = inject(VideoLibraryAdminService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  activeTab = signal<'videos' | 'categories' | 'series'>('videos');
  private readonly titleCell = viewChild<TemplateRef<unknown>>('titleCell');
  videos = signal<Video[]>([]);
  stats = signal<VideoStats | null>(null);
  loadingVideos = signal<boolean>(true);
  isDeleteModalOpen = signal<boolean>(false);
  videoToDelete = signal<Video | null>(null);

  categories = signal<VideoCategory[]>([]);
  searchQuery = signal<string>('');
  readonly limit = 10;
  page = signal<number>(1);
  totalPages = signal<number>(0);
  totalVideos = signal<number>(0);
  categoryControl = new FormControl<string>('');
  statusControl = new FormControl<string>('');

  categoryOptions = computed<SelectorOption[]>(() => [
    { label: 'Todas las categorías', value: '' },
    ...this.categories().map((cat) => ({
      label: cat.name,
      value: cat.slug,
      icon: cat.icon || undefined,
    })),
  ]);

  statusOptions: SelectorOption[] = [
    { label: 'Todos los estados', value: '' },
    { label: 'Publicados', value: 'PUBLISHED' },
    { label: 'Borradores', value: 'DRAFT' },
    { label: 'Archivados', value: 'ARCHIVED' },
  ];

  private readonly baseColumns: TableColumn[] = [
    {
      key: 'title',
      label: 'Video',
      width: '28%',
    },
    {
      key: 'category',
      label: 'Categoría',
      width: '16%',
      transform: (val: any) => val?.name || 'General',
    },
    {
      key: 'duration_seconds',
      label: 'Duración',
      width: '10%',
      transform: (sec: number) => {
        if (!sec) return '—';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
      },
    },
    {
      key: 'view_count',
      label: 'Vistas',
      width: '10%',
      transform: (views: number) => `${views || 0}`,
    },
    {
      key: 'like_count',
      label: 'Likes',
      width: '10%',
      transform: (likes: number) => `${likes || 0}`,
    },
    {
      key: 'status',
      label: 'Estado',
      width: '16%',
      badge: true,
      transform: (status: string) =>
        status === 'PUBLISHED' ? 'Publicado' : status === 'DRAFT' ? 'Borrador' : 'Archivado',
      // The table paints custom badges with inline colors: it needs CSS colors, not Tailwind classes.
      badgeConfig: {
        type: 'custom',
        colorMap: {
          PUBLISHED: '#059669',
          DRAFT: '#d97706',
          ARCHIVED: '#6b7280',
        },
      },
    },
  ];

  // The title cell template only exists after the first render, hence computed.
  readonly tableColumns = computed<TableColumn[]>(() =>
    this.baseColumns.map((c) =>
      c.key === 'title' ? { ...c, template: this.titleCell() } : c,
    ),
  );

  tableActions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'ghost',
      action: (item: Video) => {
        this.router.navigate(['/super-admin/video-library', item.id, 'edit']);
      },
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Video) => {
        this.videoToDelete.set(item);
        this.isDeleteModalOpen.set(true);
      },
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'summary',
    badgeKey: 'status',
    badgeTransform: (status: string) => (status === 'PUBLISHED' ? 'Publicado' : 'Borrador'),
    noteTransform: (item: Video) =>
      item.search_text_insufficient ? 'Texto insuficiente para búsqueda' : null,
  };

  ngOnInit() {
    this.loadStats();
    this.loadCategories();
    this.loadVideos();

    // A new filter changes the result set: start again from the first page.
    this.statusControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reloadFromFirstPage());

    this.categoryControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reloadFromFirstPage());
  }

  private reloadFromFirstPage() {
    this.page.set(1);
    this.loadVideos();
  }

  onPageChange(page: number) {
    this.page.set(page);
    this.loadVideos();
  }

  setTab(tab: 'videos' | 'categories' | 'series') {
    this.activeTab.set(tab);
    if (tab === 'videos') {
      this.loadCategories();
    }
  }

  loadCategories() {
    this.videoService
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cats) => this.categories.set(cats || []),
        error: () => this.categories.set([]),
      });
  }

  loadStats() {
    this.videoService
      .getVideoStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.stats.set(s),
      });
  }

  loadVideos() {
    this.loadingVideos.set(true);
    const query = {
      page: this.page(),
      limit: this.limit,
      search: this.searchQuery() || undefined,
      category: this.categoryControl.value || undefined,
      status: this.statusControl.value || undefined,
    };

    this.videoService
      .getVideos(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const totalPages = res.meta?.total_pages ?? 0;
          // Deleting the only video of the last page leaves the requested page
          // past the end: move to the last existing page instead of an empty list.
          if (totalPages > 0 && this.page() > totalPages) {
            this.page.set(totalPages);
            this.loadVideos();
            return;
          }
          this.videos.set(res.data || []);
          this.totalPages.set(totalPages);
          this.totalVideos.set(res.meta?.total ?? 0);
          this.loadingVideos.set(false);
        },
        error: (err) => {
          const parsed = parseApiError(err);
          this.toast.error(parsed.userMessage || 'Error al cargar videos');
          this.loadingVideos.set(false);
        },
      });
  }

  onSearch(query: string) {
    this.searchQuery.set(query);
    this.reloadFromFirstPage();
  }

  deleteVideo() {
    const v = this.videoToDelete();
    if (!v) return;

    this.videoService
      .deleteVideo(v.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Video eliminado');
          this.isDeleteModalOpen.set(false);
          this.loadStats();
          this.loadVideos();
        },
        error: (err) => {
          const parsed = parseApiError(err);
          this.toast.error(parsed.userMessage || 'Error al eliminar el video');
          this.isDeleteModalOpen.set(false);
        },
      });
  }
}
