import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

@Component({
  selector: 'app-store-pagination',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './store-pagination.component.html',
  styleUrls: ['./store-pagination.component.scss']
})
export class StorePaginationComponent {
  @Input() pagination: PaginationInfo | null = null;
  @Input() disabled: boolean = false;

  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  pageSizeOptions: number[] = [5, 10, 25, 50, 100];

  constructor() { }

  onPageChange(page: number): void {
    if (!this.disabled && this.pagination && page >= 1 && page <= this.pagination.totalPages) {
      this.pageChange.emit(page);
    }
  }

  onPageSizeChange(pageSize: number): void {
    if (!this.disabled) {
      this.pageSizeChange.emit(pageSize);
    }
  }

  // Generate array of page numbers to display
  getVisiblePages(): number[] {
    if (!this.pagination) return [];

    const { currentPage, totalPages } = this.pagination;
    const delta = 2; // Number of pages to show on each side of current page
    const range: number[] = [];
    const rangeWithDots: number[] = [];
    let l: number;

    // Calculate the range of pages to show
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
        range.push(i);
      }
    }

    // Add dots for large gaps
    range.forEach((i) => {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push(-1); // -1 represents dots
        }
      }
      rangeWithDots.push(i);
      l = i;
    });

    return rangeWithDots;
  }

  // Get start and end item numbers for display
  getItemRange(): string {
    if (!this.pagination) return '0 - 0 of 0';

    const { currentPage, itemsPerPage, totalItems } = this.pagination;
    const start = (currentPage - 1) * itemsPerPage + 1;
    const end = Math.min(currentPage * itemsPerPage, totalItems);

    return `${start} - ${end} of ${totalItems}`;
  }

  // Check if a specific page is active
  isPageActive(page: number): boolean {
    return this.pagination?.currentPage === page;
  }

  // Check if pagination is disabled for a specific page
  isPageDisabled(page: number): boolean {
    return this.disabled || page < 1 || (this.pagination ? page > this.pagination.totalPages : true);
  }

  // Navigate to first page
  goToFirstPage(): void {
    this.onPageChange(1);
  }

  // Navigate to last page
  goToLastPage(): void {
    if (this.pagination) {
      this.onPageChange(this.pagination.totalPages);
    }
  }

  // Navigate to previous page
  goToPreviousPage(): void {
    if (this.pagination && this.pagination.hasPreviousPage) {
      this.onPageChange(this.pagination.currentPage - 1);
    }
  }

  // Navigate to next page
  goToNextPage(): void {
    if (this.pagination && this.pagination.hasNextPage) {
      this.onPageChange(this.pagination.currentPage + 1);
    }
  }
}