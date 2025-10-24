import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-organization-pagination',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div *ngIf="pagination.totalPages > 1" class="flex justify-center items-center gap-2 mt-6">
      <!-- Previous Button -->
      <button
        class="px-3 py-1 rounded-lg border border-border disabled:opacity-50 disabled:cursor-not-allowed text-text-primary hover:bg-gray-50"
        [disabled]="pagination.page <= 1"
        (click)="changePage(pagination.page - 1)">
        <app-icon name="chevron-left" [size]="16"></app-icon>
      </button>

      <!-- Page Numbers -->
      <div class="flex items-center gap-1">
        <ng-container *ngFor="let page of getPageNumbers()">
          <!-- Ellipsis -->
          <span
            *ngIf="page === '...'"
            class="px-2 text-text-muted">
            ...
          </span>
          
          <!-- Page Number -->
          <button
            *ngIf="page !== '...'"
            class="px-3 py-1 rounded-lg text-sm"
            [class]="getPageClasses(page)"
            [disabled]="page === pagination.page"
            (click)="changePage(page)">
            {{ page }}
          </button>
        </ng-container>
      </div>

      <!-- Next Button -->
      <button
        class="px-3 py-1 rounded-lg border border-border disabled:opacity-50 disabled:cursor-not-allowed text-text-primary hover:bg-gray-50"
        [disabled]="pagination.page >= pagination.totalPages"
        (click)="changePage(pagination.page + 1)">
        <app-icon name="chevron-right" [size]="16"></app-icon>
      </button>

      <!-- Page Info -->
      <span class="ml-4 text-sm text-text-muted">
        Page {{ pagination.page }} of {{ pagination.totalPages }}
        ({{ pagination.total }} items)
      </span>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class OrganizationPaginationComponent {
  @Input() pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  };

  @Output() pageChange = new EventEmitter<number>();

  changePage(page: number | string): void {
    if (typeof page === 'string') return;
    if (page >= 1 && page <= this.pagination.totalPages && page !== this.pagination.page) {
      this.pageChange.emit(page);
    }
  }

  getPageClasses(page: number | string): string {
    if (typeof page === 'string') return '';
    const baseClasses = 'hover:bg-gray-50';
    
    if (page === this.pagination.page) {
      return `${baseClasses} bg-primary text-white border-primary`;
    }
    
    return `${baseClasses} border border-border text-text-primary`;
  }

  getPageNumbers(): (number | string)[] {
    const { page, totalPages } = this.pagination;
    const pages: (number | string)[] = [];
    
    // Always show first page
    pages.push(1);
    
    // Calculate range around current page
    const startPage = Math.max(2, page - 2);
    const endPage = Math.min(totalPages - 1, page + 2);
    
    // Add ellipsis if needed before startPage
    if (startPage > 2) {
      pages.push('...');
    }
    
    // Add pages in range
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    
    // Add ellipsis if needed after endPage
    if (endPage < totalPages - 1) {
      pages.push('...');
    }
    
    // Always show last page if more than 1 page
    if (totalPages > 1) {
      pages.push(totalPages);
    }
    
    return pages;
  }
}