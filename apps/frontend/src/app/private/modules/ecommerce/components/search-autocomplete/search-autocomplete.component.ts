import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Subject, debounceTime, switchMap, takeUntil } from 'rxjs';
import { Product } from '../../services/catalog.service';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-search-autocomplete',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './search-autocomplete.component.html',
  styleUrls: ['./search-autocomplete.component.scss'],
})
export class SearchAutocompleteComponent {
  @Output() search = new EventEmitter<string>();

  search_query = '';
  search_results: Product[] = [];
  is_loading = false;
  show_dropdown = false;
  selected_index = -1;

  private search_subject = new Subject<string>();
  private destroy$ = new Subject<void>();

  private catalog_service = inject(CatalogService);
  private router = inject(Router);

  constructor() {
    this.search_subject
      .pipe(
        debounceTime(300),
        switchMap((query) => {
          if (query.length < 2) {
            this.show_dropdown = false;
            this.search_results = [];
            return [];
          }
          this.is_loading = true;
          return this.catalog_service.getProducts({ search: query, limit: 5 });
        }),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (response) => {
          this.search_results = response.data;
          this.show_dropdown = this.search_results.length > 0;
          this.is_loading = false;
          this.selected_index = -1;
        },
        error: () => {
          this.search_results = [];
          this.is_loading = false;
        },
      });
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.search_query = input.value;
    this.search_subject.next(this.search_query);
  }

  onProductSelect(product: Product): void {
    this.router.navigate(['/productos', product.slug]);
    this.closeDropdown();
  }

  onSubmit(): void {
    if (this.search_query.trim()) {
      this.router.navigate(['/productos'], {
        queryParams: { search: this.search_query },
      });
      this.closeDropdown();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.show_dropdown || this.search_results.length === 0) {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.onSubmit();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selected_index = Math.min(
          this.selected_index + 1,
          this.search_results.length - 1,
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selected_index = Math.max(this.selected_index - 1, -1);
        break;
      case 'Enter':
        event.preventDefault();
        if (this.selected_index >= 0) {
          this.onProductSelect(this.search_results[this.selected_index]);
        } else {
          this.onSubmit();
        }
        break;
      case 'Escape':
        this.closeDropdown();
        break;
    }
  }

  onFocus(): void {
    if (this.search_query.length >= 2 && this.search_results.length > 0) {
      this.show_dropdown = true;
    }
  }

  closeDropdown(): void {
    this.show_dropdown = false;
    this.selected_index = -1;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.search_subject.complete();
  }
}
