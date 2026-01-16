import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-template-pagination',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div class="flex items-center justify-between">
      <div class="text-sm text-text-secondary">
        Showing {{ (pagination.page - 1) * pagination.limit + 1 }} to
        {{ displayEnd }} of
        {{ pagination.total }} templates
      </div>
      <div class="flex gap-2">
        <app-button
          variant="outline"
          size="sm"
          (clicked)="previousPage()"
          [disabled]="pagination.page === 1"
        >
          Previous
        </app-button>
        <app-button
          variant="outline"
          size="sm"
          (clicked)="nextPage()"
          [disabled]="pagination.page === pagination.totalPages"
        >
          Next
        </app-button>
      </div>
    </div>
  `,
})
export class TemplatePaginationComponent {
  @Input() pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  @Output() pageChange = new EventEmitter<number>();

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

  get displayEnd(): number {
    return Math.min(this.pagination.page * this.pagination.limit, this.pagination.total);
  }
}
