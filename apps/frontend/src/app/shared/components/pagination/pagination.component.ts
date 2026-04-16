import {
  Component,
  input,
  output
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type PaginationInfoStyle = 'range' | 'page' | 'none';

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './pagination.component.html',
  styleUrls: ['./pagination.component.scss'],
})
export class PaginationComponent {
  readonly currentPage = input<number>(1);
  readonly totalPages = input<number>(0);
  readonly total = input<number>(0);
  readonly limit = input<number>(10);
  readonly infoStyle = input<PaginationInfoStyle>('none');

  readonly pageChange = output<number>();

  get isVisible(): boolean {
    return this.totalPages() > 1;
  }

  get pageNumbers(): (number | string)[] {
    const { currentPage: currentPageInput, totalPages: totalPagesInput } = this;
    const currentPage = currentPageInput();
    const totalPages = totalPagesInput();
    const pages: (number | string)[] = [];

    pages.push(1);

    const startPage = Math.max(2, currentPage - 2);
    const endPage = Math.min(totalPages - 1, currentPage + 2);

    if (startPage > 2) {
      pages.push('...');
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    if (endPage < totalPages - 1) {
      pages.push('...');
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  }

  get rangeStart(): number {
    return (this.currentPage() - 1) * this.limit() + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.currentPage() * this.limit(), this.total());
  }

  goToPage(page: number | string): void {
    if (typeof page === 'string') return;
    if (page >= 1 && page <= this.totalPages() && page !== this.currentPage()) {
      this.pageChange.emit(page);
    }
  }

  isEllipsis(page: number | string): boolean {
    return page === '...';
  }

  isActivePage(page: number | string): boolean {
    return page === this.currentPage();
  }
}
