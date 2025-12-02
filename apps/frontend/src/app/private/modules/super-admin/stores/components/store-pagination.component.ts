import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components';

@Component({
  selector: 'app-store-pagination',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="flex items-center justify-between">
      <div class="text-sm text-text-secondary">
        Showing
        {{ pagination.page * pagination.limit - pagination.limit + 1 }} to
        {{ getEndItem() }} of {{ pagination.total }} results
      </div>

      <div class="flex items-center gap-2">
        <!-- Previous Button -->
        <app-button
          variant="outline"
          size="sm"
          (clicked)="previousPage()"
          [disabled]="pagination.page <= 1"
          title="Previous page"
        >
          <app-icon name="chevron-left" [size]="16" slot="icon"></app-icon>
        </app-button>

        <!-- Page Numbers -->
        <div class="flex items-center gap-1">
          <ng-container *ngFor="let page of getVisiblePages()">
            <app-button
              *ngIf="page !== '...'"
              [variant]="page === pagination.page ? 'primary' : 'outline'"
              size="sm"
              (clicked)="goToPage(page)"
              [disabled]="page === pagination.page"
            >
              {{ page }}
            </app-button>

            <span
              *ngIf="page === '...'"
              class="px-2 py-1 text-sm text-text-secondary"
            >
              ...
            </span>
          </ng-container>
        </div>

        <!-- Next Button -->
        <app-button
          variant="outline"
          size="sm"
          (clicked)="nextPage()"
          [disabled]="pagination.page >= pagination.totalPages"
          title="Next page"
        >
          <app-icon name="chevron-right" [size]="16" slot="icon"></app-icon>
        </app-button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StorePaginationComponent {
  @Input() pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  @Output() pageChange = new EventEmitter<number>();

  constructor() {}

  previousPage(): void {
    if (this.pagination.page > 1) {
      this.pageChange.emit(this.pagination.page - 1);
    }
  }

  nextPage(): void {
    if (this.pagination.page < this.pagination.totalPages) {
      this.pageChange.emit(this.pagination.page + 1);
    }
  }

  goToPage(page: number | string): void {
    if (
      typeof page === 'number' &&
      page !== this.pagination.page &&
      page >= 1 &&
      page <= this.pagination.totalPages
    ) {
      this.pageChange.emit(page);
    }
  }

  getEndItem(): number {
    return Math.min(
      this.pagination.page * this.pagination.limit,
      this.pagination.total,
    );
  }

  getVisiblePages(): (number | string)[] {
    const { page, totalPages } = this.pagination;
    const pages: (number | string)[] = [];

    if (totalPages <= 7) {
      // Show all pages if there are 7 or fewer
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (page <= 4) {
        // Show pages 2-5 when current page is near the start
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (page >= totalPages - 3) {
        // Show pages near the end when current page is near the end
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show pages around current page
        pages.push('...');
        for (let i = page - 1; i <= page + 1; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      }
    }

    return pages;
  }
}
