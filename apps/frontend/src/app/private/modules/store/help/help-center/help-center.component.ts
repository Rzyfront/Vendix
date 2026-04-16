import { Component, OnInit, OnDestroy, inject } from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { HelpCenterService } from '../services/help-center.service';
import { HelpArticle, HelpCategory } from '../models/help-article.model';
import { HelpArticleCardComponent } from './components/help-article-card/help-article-card.component';

@Component({
  selector: 'app-help-center',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SpinnerComponent,
    HelpArticleCardComponent
],
  template: `
    <div class="help-center-container">
      <!-- Header -->
      <div class="help-header">
        <h2 class="help-title">Centro de Ayuda</h2>
        <p class="help-subtitle">Encuentra respuestas, tutoriales y guías para aprovechar Vendix al máximo</p>
      </div>
    
      <!-- Search Bar -->
      <div class="search-section">
        <div class="search-input-wrapper">
          <app-icon name="search" [size]="18" class="search-icon"></app-icon>
          <input
            type="text"
            class="search-input"
            placeholder="Buscar artículos..."
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange($event)"
            />
          @if (searchQuery) {
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
      @if (categories.length > 0 && !searchQuery) {
        <div class="category-filters">
          <button
            class="category-chip"
            [class.active]="!selectedCategory"
            (click)="selectCategory(null)"
            >
            Todos
          </button>
          @for (cat of categories; track cat) {
            <button
              class="category-chip"
              [class.active]="selectedCategory === cat.slug"
              (click)="selectCategory(cat.slug)"
              >
              @if (cat.icon) {
                <app-icon [name]="cat.icon" [size]="14"></app-icon>
              }
              {{ cat.name }}
              @if (cat._count?.articles) {
                <span class="chip-count">{{ cat._count!.articles }}</span>
              }
            </button>
          }
        </div>
      }
    
      <!-- Loading State -->
      @if (isLoading) {
        <div class="loading-state">
          <app-spinner size="md"></app-spinner>
        </div>
      }
    
      <!-- Articles Grid -->
      @if (!isLoading && articles.length > 0) {
        <div class="articles-grid">
          @for (article of articles; track trackBySlug($index, article)) {
            <app-help-article-card
              [article]="article"
              [isExpanded]="expandedSlug === article.slug"
              (expanded)="onArticleExpanded($event)"
            ></app-help-article-card>
          }
        </div>
      }
    
      <!-- Empty State -->
      @if (!isLoading && articles.length === 0) {
        <div class="empty-state">
          <app-icon name="search" [size]="48" class="empty-icon"></app-icon>
          <h3>No se encontraron artículos</h3>
          @if (searchQuery) {
            <p>Intenta con otros términos de búsqueda</p>
          }
          @if (!searchQuery) {
            <p>Aún no hay artículos en esta categoría</p>
          }
        </div>
      }
    
      <!-- Load More -->
      @if (!isLoading && hasMore && !searchQuery) {
        <div class="load-more">
          <button class="load-more-btn" (click)="loadMore()" [disabled]="isLoadingMore">
            @if (isLoadingMore) {
              <app-spinner size="sm"></app-spinner>
            }
            @if (!isLoadingMore) {
              <span>Cargar más artículos</span>
            }
          </button>
        </div>
      }
    </div>
    `,
  styles: [`
    .help-center-container {
      max-width: 960px;
      margin: 0 auto;
      padding: 1rem 0.5rem;
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
      margin-bottom: 1rem;
    }

    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 12px;
      color: var(--color-text-tertiary, #9ca3af);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: 0.75rem 2.5rem 0.75rem 2.5rem;
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: 10px;
      font-size: 0.9375rem;
      background: var(--color-surface, #fff);
      color: var(--color-text, #111827);
      outline: none;
      transition: border-color 0.15s;
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
      right: 10px;
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
      gap: 4px;
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
      background: rgba(0, 0, 0, 0.1);
      padding: 1px 6px;
      border-radius: 10px;
    }

    .category-chip.active .chip-count {
      background: rgba(255, 255, 255, 0.25);
    }

    /* Articles Grid */
    .articles-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    @media (min-width: 640px) {
      .articles-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (min-width: 1024px) {
      .articles-grid {
        grid-template-columns: repeat(3, 1fr);
      }

      .help-center-container {
        padding: 1.5rem 1rem;
      }
    }

    /* Loading */
    .loading-state {
      display: flex;
      justify-content: center;
      padding: 3rem 0;
    }

    /* Empty */
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--color-text-secondary, #6b7280);
    }

    .empty-icon {
      opacity: 0.3;
      margin-bottom: 1rem;
    }

    .empty-state h3 {
      margin: 0 0 0.25rem 0;
      font-size: 1.125rem;
      color: var(--color-text, #111827);
    }

    .empty-state p {
      margin: 0;
      font-size: 0.875rem;
    }

    /* Load More */
    .load-more {
      display: flex;
      justify-content: center;
      padding: 1.5rem 0;
    }

    .load-more-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1.5rem;
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: 8px;
      background: var(--color-surface, #fff);
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-secondary, #6b7280);
      cursor: pointer;
      transition: all 0.15s;
    }

    .load-more-btn:hover:not(:disabled) {
      border-color: var(--color-primary, #3b82f6);
      color: var(--color-primary, #3b82f6);
    }

    .load-more-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `],
})
export class HelpCenterComponent implements OnInit, OnDestroy {
  private helpCenterService = inject(HelpCenterService);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  articles: HelpArticle[] = [];
  categories: HelpCategory[] = [];
  searchQuery = '';
  selectedCategory: string | null = null;
  expandedSlug: string | null = null;
  isLoading = false;
  isLoadingMore = false;
  hasMore = false;
  currentPage = 1;
  private readonly PAGE_SIZE = 10;

  ngOnInit(): void {
    // Load categories
    this.helpCenterService.getCategories()
      .pipe(takeUntil(this.destroy$))
      .subscribe(cats => this.categories = cats);

    // Setup search debounce
    this.searchSubject$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
      )
      .subscribe(query => {
        if (query.trim().length >= 2) {
          this.performSearch(query);
        } else if (!query.trim()) {
          this.loadArticles();
        }
      });

    // Check for slug param (deep link to specific article)
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['slug']) {
        this.expandedSlug = params['slug'];
      }
    });

    this.loadArticles();
  }

  loadArticles(): void {
    this.isLoading = true;
    this.currentPage = 1;

    this.helpCenterService.getArticles({
      page: 1,
      limit: this.PAGE_SIZE,
      category: this.selectedCategory || undefined,
    }).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.articles = res.data;
          this.hasMore = res.meta.page < res.meta.total_pages;
          this.isLoading = false;

          // Auto-scroll to expanded article if slug provided
          if (this.expandedSlug) {
            setTimeout(() => this.scrollToArticle(this.expandedSlug!), 100);
          }
        },
        error: () => {
          this.isLoading = false;
        },
      });
  }

  loadMore(): void {
    this.isLoadingMore = true;
    this.currentPage++;

    this.helpCenterService.getArticles({
      page: this.currentPage,
      limit: this.PAGE_SIZE,
      category: this.selectedCategory || undefined,
    }).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.articles = [...this.articles, ...res.data];
          this.hasMore = res.meta.page < res.meta.total_pages;
          this.isLoadingMore = false;
        },
        error: () => {
          this.isLoadingMore = false;
        },
      });
  }

  onSearchChange(query: string): void {
    this.searchSubject$.next(query);
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.loadArticles();
  }

  private performSearch(query: string): void {
    this.isLoading = true;
    this.helpCenterService.searchArticles(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (results) => {
          this.articles = results;
          this.hasMore = false;
          this.isLoading = false;
        },
        error: () => {
          this.isLoading = false;
        },
      });
  }

  selectCategory(slug: string | null): void {
    this.selectedCategory = slug;
    this.loadArticles();
  }

  onArticleExpanded(article: HelpArticle): void {
    this.expandedSlug = article.slug;
    this.helpCenterService.incrementView(article.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe();
  }

  trackBySlug(_index: number, article: HelpArticle): string {
    return article.slug;
  }

  private scrollToArticle(slug: string): void {
    const el = document.getElementById('article-' + slug);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
