import { Component, input, output, signal, computed } from '@angular/core';
import { NgClass } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { HelpArticle } from '../../../models/help-article.model';
import { markdownToHtml } from '../../../../../../../shared/utils/markdown.util';

@Component({
  selector: 'app-help-article-card',
  standalone: true,
  imports: [NgClass, IconComponent],
  host: { '[class.is-expanded]': 'isExpanded()' },
  template: `
    <div
      class="article-card"
      [class.expanded]="isExpanded()"
      [attr.id]="'article-' + article().slug"
      >
      <!-- Card Header -->
      <div class="article-header" (click)="toggle()">
        <div class="article-meta">
          <span class="meta-badge category-badge">{{ article().category.name }}</span>
          <span class="meta-badge" [ngClass]="'type-' + article().type.toLowerCase()">{{ getTypeLabel(article().type) }}</span>
          @if (article().is_featured) {
            <span class="featured-badge">
              <app-icon name="star" [size]="12"></app-icon>
              Destacado
            </span>
          }
        </div>
    
        <h3 class="article-title">{{ article().title }}</h3>
        <p class="article-summary">{{ article().summary }}</p>
    
        <div class="article-footer">
          <div class="article-stats">
            <span class="stat-item">
              <app-icon name="eye" [size]="14"></app-icon>
              {{ article().view_count }} vistas
            </span>
            @if (article().module) {
              <span class="stat-item">
                <app-icon name="layout-grid" [size]="14"></app-icon>
                {{ article().module }}
              </span>
            }
          </div>
          <button class="expand-btn" [attr.aria-label]="isExpanded() ? 'Colapsar' : 'Ver más'">
            <span>{{ isExpanded() ? 'Cerrar' : 'Ver más' }}</span>
            <app-icon
              [name]="isExpanded() ? 'chevron-up' : 'chevron-down'"
              [size]="16"
            ></app-icon>
          </button>
        </div>
      </div>
    
      <!-- Expanded Content -->
      @if (isExpanded()) {
        <div class="article-content">
          <div class="content-divider"></div>
          <div class="content-body" [innerHTML]="renderedContent()"></div>
        </div>
      }
    </div>
    `,
  styles: [`
    .article-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border, #e5e7eb);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s ease;
    }

    .article-card:hover {
      border-color: var(--color-primary, #3b82f6);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }

    .article-card.expanded {
      border-color: var(--color-primary, #3b82f6);
    }

    .article-header {
      padding: 1rem;
      cursor: pointer;
    }

    .article-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }

    .meta-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }

    .category-badge {
      background: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
    }

    .type-tutorial { background: rgba(16, 185, 129, 0.1); color: #059669; }
    .type-faq { background: rgba(245, 158, 11, 0.1); color: #d97706; }
    .type-guide { background: rgba(59, 130, 246, 0.1); color: #2563eb; }
    .type-announcement { background: rgba(239, 68, 68, 0.1); color: #dc2626; }
    .type-release_note { background: rgba(107, 114, 128, 0.1); color: #4b5563; }

    .featured-badge {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 11px;
      font-weight: 600;
      color: #f59e0b;
    }

    .article-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text, #111827);
      margin: 0 0 0.5rem 0;
      line-height: 1.4;
    }

    .article-summary {
      font-size: 0.875rem;
      color: var(--color-text-secondary, #6b7280);
      margin: 0 0 0.75rem 0;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .article-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .article-stats {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--color-text-tertiary, #9ca3af);
    }

    .expand-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-primary, #3b82f6);
      padding: 4px 8px;
      border-radius: 6px;
      transition: background 0.15s;
    }

    .expand-btn:hover {
      background: var(--color-primary-light, rgba(59, 130, 246, 0.08));
    }

    .content-divider {
      height: 1px;
      background: var(--color-border, #e5e7eb);
      margin: 0 1rem;
    }

    .article-content {
      animation: slideDown 0.2s ease;
    }

    .content-body {
      padding: 1rem;
      font-size: 0.875rem;
      line-height: 1.7;
      color: var(--color-text, #374151);
    }

    :host ::ng-deep .content-body h2 {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 1.5rem 0 0.75rem 0;
      color: var(--color-text, #111827);
    }

    :host ::ng-deep .content-body h3 {
      font-size: 1rem;
      font-weight: 600;
      margin: 1.25rem 0 0.5rem 0;
      color: var(--color-text, #111827);
    }

    :host ::ng-deep .content-body ul,
    :host ::ng-deep .content-body ol {
      padding-left: 1.25rem;
      margin: 0.5rem 0;
    }

    :host ::ng-deep .content-body li {
      margin-bottom: 0.25rem;
    }

    :host ::ng-deep .content-body strong {
      font-weight: 600;
      color: var(--color-text, #111827);
    }

    :host ::ng-deep .content-body p {
      margin: 0.5rem 0;
    }

    /* Expanded card spans full grid width */
    :host(.is-expanded) {
      grid-column: 1 / -1;
    }

    @keyframes slideDown {
      from { opacity: 0; max-height: 0; }
      to { opacity: 1; max-height: 2000px; }
    }
  `],
})
export class HelpArticleCardComponent {
  readonly article = input.required<HelpArticle>();
  readonly isExpanded = input<boolean>(false);
  readonly expanded = output<HelpArticle | null>();

  readonly renderedContent = computed(() => this.markdownToHtml(this.article().content));

  toggle(): void {
    // Emit null to collapse (parent sets expandedSlug to null), or emit article to expand
    this.expanded.emit(this.isExpanded() ? null : this.article());
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      TUTORIAL: 'Tutorial',
      FAQ: 'FAQ',
      GUIDE: 'Guía',
      ANNOUNCEMENT: 'Anuncio',
      RELEASE_NOTE: 'Novedad',
    };
    return labels[type] || type;
  }

  private markdownToHtml(md: string): string {
    return markdownToHtml(md);
  }
}
