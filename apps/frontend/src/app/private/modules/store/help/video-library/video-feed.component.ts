import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { VideoLibraryService } from './services/video-library.service';
import { Video, VideoCategory } from './models/video.model';
import { VideoCardComponent } from './components/video-card/video-card.component';

@Component({
  selector: 'app-video-feed',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    SpinnerComponent,
    VideoCardComponent,
  ],
  template: `
    <div class="flex flex-col gap-5 p-4 md:p-6 max-w-7xl mx-auto w-full">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
            Videos de Capacitación
          </h1>
          <p class="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Tutoriales oficiales y guías prácticas para optimizar la operación de tu negocio
          </p>
        </div>

        <!-- Search Input -->
        <div class="relative w-full md:w-80">
          <app-icon
            name="search"
            [size]="18"
            class="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
          ></app-icon>
          <input
            type="text"
            class="w-full pl-10 pr-10 py-2.5 bg-surface border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all text-neutral-900 dark:text-neutral-100 placeholder-neutral-400"
            placeholder="Buscar tutoriales..."
            [ngModel]="searchQuery()"
            (ngModelChange)="onSearchChange($event)"
          />
          @if (searchQuery()) {
            <button
              class="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              (click)="clearSearch()"
              aria-label="Limpiar búsqueda"
            >
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          }
        </div>
      </div>

      <!-- Categories Pills Bar (YouTube Style) -->
      @if (categories().length > 0) {
        <div class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            class="px-4 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer"
            [ngClass]="
              !selectedCategory()
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            "
            (click)="selectCategory(null)"
          >
            Todos
          </button>
          @for (cat of categories(); track cat.id) {
            <button
              class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer"
              [ngClass]="
                selectedCategory() === cat.slug
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
              "
              (click)="selectCategory(cat.slug)"
            >
              @if (cat.icon) {
                <app-icon [name]="cat.icon" [size]="14"></app-icon>
              }
              <span>{{ cat.name }}</span>
              @if (cat._count?.videos) {
                <span
                  class="text-[10px] px-1.5 py-0.2 rounded-full"
                  [ngClass]="
                    selectedCategory() === cat.slug
                      ? 'bg-white/20 text-white dark:bg-neutral-900/20 dark:text-neutral-900'
                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300'
                  "
                >
                  {{ cat._count!.videos }}
                </span>
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
            <app-video-card [video]="video" layout="vertical"></app-video-card>
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
    </div>
  `,
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
}
