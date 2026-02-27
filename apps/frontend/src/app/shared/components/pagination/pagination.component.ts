import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type PaginationInfoStyle = 'range' | 'page' | 'none';

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './pagination.component.html',
  styleUrls: ['./pagination.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginationComponent {
  @Input() currentPage: number = 1;
  @Input() totalPages: number = 0;
  @Input() total: number = 0;
  @Input() limit: number = 10;
  @Input() infoStyle: PaginationInfoStyle = 'none';

  @Output() pageChange = new EventEmitter<number>();

  get isVisible(): boolean {
    return this.totalPages > 1;
  }

  get pageNumbers(): (number | string)[] {
    const { currentPage, totalPages } = this;
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
    return (this.currentPage - 1) * this.limit + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.currentPage * this.limit, this.total);
  }

  goToPage(page: number | string): void {
    if (typeof page === 'string') return;
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.pageChange.emit(page);
    }
  }

  isEllipsis(page: number | string): boolean {
    return page === '...';
  }

  isActivePage(page: number | string): boolean {
    return page === this.currentPage;
  }
}
