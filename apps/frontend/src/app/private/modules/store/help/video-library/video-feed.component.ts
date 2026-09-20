import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { VideoLibraryService } from './services/video-library.service';
import { Video, VideoCategory } from './models/video.model';
import { VideoCardComponent } from './components/video-card/video-card.component';
import { VideoShareModalComponent } from './components/video-share-modal/video-share-modal.component';

@Component({
  selector: 'app-video-feed',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    VideoCardComponent,
    VideoShareModalComponent,
  ],
  template: `
    <div class="video-feed-container">
      <!-- Header -->
      <div class="help-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="help-title">Videos de Capacitación</h2>
          <p class="help-subtitle">Tutoriales oficiales y guías prácticas para optimizar la operación de tu negocio</p>
        </div>

        <a
          routerLink="/admin/help/center"
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary text-xs font-semibold border border-primary/20 transition-all self-start sm:self-auto group no-underline"
        >
          <app-icon name="book-open" [size]="16" class="text-primary group-hover:scale-110 transition-transform"></app-icon>
          <span>Centro de Ayuda</span>
          <app-icon name="arrow-right" [size]="14"></app-icon>
        </a>
      </div>

      <!-- Search Bar -->
      <div class="search-section">
        <div class="search-input-wrapper">
          <app-icon name="search" [size]="18" class="search-icon"></app-icon>
          <input
            type="text"
            class="search-input"
            placeholder="Buscar tutoriales..."
            [ngModel]="searchQuery()"
            (ngModelChange)="onSearchChange($event)"
          />
          @if (searchQuery()) {
            <button
              class="clear-btn"
              (click)="clearSearch()"
              aria-label="Limpiar búsqueda"
            >
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          }
        </div>
      </div>

      <!-- Category Filters -->
      @if (categories().length > 0) {
        <div class="category-filters">
          <button
            class="category-chip"
            [class.active]="!selectedCategory()"
            (click)="selectCategory(null)"
          >
            Todos
          </button>
          @for (cat of categories(); track cat.id) {
            <button
              class="category-chip"
              [class.active]="selectedCategory() === cat.slug"
              (click)="selectCategory(cat.slug)"
            >
              @if (cat.icon) {
                <app-icon [name]="cat.icon" [size]="14"></app-icon>
              }
              {{ cat.name }}
              @if (cat._count?.videos) {
                <span class="chip-count">{{ cat._count!.videos }}</span>
              }
            </button>
          }
        </div>
      }

      <!-- Loading State -->
      @if (isLoading()) {
        <div class="flex justify-center items-center py-24">
          <app-spinner size="lg"></app-spinner>
        </div>
      }

      <!-- Video Grid (YouTube Style) -->
      @if (!isLoading() && videos().length > 0) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
          @for (video of videos(); track video.id) {
            <app-video-card [video]="video" layout="vertical" (shareClicked)="onShareVideo($event)"></app-video-card>
          }
        </div>
      }

      <!-- Empty State -->
      @if (!isLoading() && videos().length === 0) {
        <div class="flex flex-col items-center justify-center py-20 px-4 text-center rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 bg-surface">
          <div class="w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 flex items-center justify-center mb-3">
            <app-icon name="video" [size]="28"></app-icon>
          </div>
          <h3 class="text-base font-bold text-neutral-900 dark:text-neutral-100">
            No se encontraron videos
          </h3>
          <p class="text-sm text-neutral-500 dark:text-neutral-400 mt-1 max-w-sm">
            @if (searchQuery()) {
              No hay videos que coincidan con "{{ searchQuery() }}". Prueba con otros términos.
            } @else {
              No hay videos disponibles en esta categoría actualmente.
            }
          </p>
          @if (searchQuery() || selectedCategory()) {
            <button
              class="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 transition-colors cursor-pointer"
              (click)="resetFilters()"
            >
              Restablecer filtros
            </button>
          }
        </div>
      }

      <!-- Modal para compartir video -->
      <app-video-share-modal
        [(isOpen)]="isShareModalOpen"
        [video]="selectedVideoForShare()"
      ></app-video-share-modal>
    </div>
  `,
  styles: [
    `
      .video-feed-container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 1.5rem 1rem;
        width: 100%;
      }

      .help-header {
        margin-bottom: 1.5rem;
      }

      .help-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--color-text, #111827);
        margin: 0 0 0.25rem 0;
      }

      .help-subtitle {
        font-size: 0.875rem;
        color: var(--color-text-secondary, #6b7280);
        margin: 0;
      }

      /* Search */
      .search-section {
        margin-bottom: 1.25rem;
      }

      .search-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }

      .search-icon {
        position: absolute;
        left: 14px;
        color: var(--color-text-tertiary, #9ca3af);
        pointer-events: none;
      }

      .search-input {
        width: 100%;
        padding: 0.75rem 2.5rem 0.75rem 2.75rem;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 12px;
        font-size: 0.9375rem;
        background: var(--color-surface, #fff);
        color: var(--color-text, #111827);
        outline: none;
        transition: all 0.15s;
      }

      .search-input:focus {
        border-color: var(--color-primary, #3b82f6);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .search-input::placeholder {
        color: var(--color-text-tertiary, #9ca3af);
      }

      .clear-btn {
        position: absolute;
        right: 12px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        color: var(--color-text-tertiary, #9ca3af);
        border-radius: 4px;
      }

      .clear-btn:hover {
        color: var(--color-text, #111827);
      }

      /* Category Filters */
      .category-filters {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        padding-bottom: 0.5rem;
        margin-bottom: 1.25rem;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }

      .category-filters::-webkit-scrollbar {
        display: none;
      }

      .category-chip {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 20px;
        background: var(--color-surface, #fff);
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-secondary, #6b7280);
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s;
      }

      .category-chip:hover {
        border-color: var(--color-primary, #3b82f6);
        color: var(--color-primary, #3b82f6);
      }

      .category-chip.active {
        background: var(--color-primary, #3b82f6);
        border-color: var(--color-primary, #3b82f6);
        color: white;
      }

      .chip-count {
        font-size: 11px;
        background: rgba(0, 0, 0, 0.08);
        padding: 1px 6px;
        border-radius: 10px;
      }

      .category-chip.active .chip-count {
        background: rgba(255, 255, 255, 0.25);
      }
    `,
  ],
})
export class VideoFeedComponent implements OnInit {
  private videoService = inject(VideoLibraryService);
  private destroyRef = inject(DestroyRef);
  private searchSubject = new Subject<string>();

  videos = signal<Video[]>([]);
  categories = signal<VideoCategory[]>([]);
  selectedCategory = signal<string | null>(null);
  searchQuery = signal<string>('');
  isLoading = signal<boolean>(true);
  isShareModalOpen = signal<boolean>(false);
  selectedVideoForShare = signal<Video | null>(null);

  ngOnInit() {
    this.loadCategories();
    this.loadVideos();

    this.searchSubject
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        this.searchQuery.set(query);
        this.loadVideos();
      });
  }

  loadCategories() {
    this.videoService
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cats) => this.categories.set(cats),
        error: () => this.categories.set([]),
      });
  }

  loadVideos() {
    this.isLoading.set(true);
    const query = {
      category: this.selectedCategory() || undefined,
      search: this.searchQuery() || undefined,
    };

    this.videoService
      .getVideos(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.videos.set(response.data || []);
          this.isLoading.set(false);
        },
        error: () => {
          this.videos.set([]);
          this.isLoading.set(false);
        },
      });
  }

  selectCategory(categorySlug: string | null) {
    this.selectedCategory.set(categorySlug);
    this.loadVideos();
  }

  onSearchChange(query: string) {
    this.searchSubject.next(query);
  }

  clearSearch() {
    this.searchQuery.set('');
    this.searchSubject.next('');
  }

  resetFilters() {
    this.searchQuery.set('');
    this.selectedCategory.set(null);
    this.loadVideos();
  }

  onShareVideo(video: Video) {
    this.selectedVideoForShare.set(video);
    this.isShareModalOpen.set(true);
  }
}
