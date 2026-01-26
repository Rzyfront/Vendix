import {
  Component,
  EventEmitter,
  Output,
  inject,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Subject, debounceTime, switchMap, takeUntil } from 'rxjs';
import { EcommerceProduct } from '../../services/catalog.service';
import { CatalogService } from '../../services/catalog.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-search-autocomplete',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './search-autocomplete.component.html',
  styleUrls: ['./search-autocomplete.component.scss'],
})
export class SearchAutocompleteComponent implements OnDestroy {
  @Output() search = new EventEmitter<string>();

  search_query = '';
  search_results: EcommerceProduct[] = [];
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
        debounceTime(400), // Adjusted to 400ms (0.4s) as requested
        takeUntil(this.destroy$),
      )
      .subscribe((query) => {
        if (query.trim().length >= 2) {
          this.onSubmit();
        }
      });
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.search_query = input.value;
    this.search_subject.next(this.search_query);
  }

  onSubmit(): void {
    if (this.search_query.trim()) {
      this.router.navigate(['/productos'], {
        queryParams: { search: this.search_query },
      });
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onSubmit();
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
