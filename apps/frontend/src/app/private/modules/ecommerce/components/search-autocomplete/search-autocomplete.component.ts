import { Component, ChangeDetectionStrategy, inject, DestroyRef, output, signal } from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EcommerceProduct } from '../../services/catalog.service';
import { CatalogService } from '../../services/catalog.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-search-autocomplete',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './search-autocomplete.component.html',
  styleUrls: ['./search-autocomplete.component.scss'],
})
export class SearchAutocompleteComponent {
  readonly search = output<string>();

  readonly search_query = signal('');
  readonly search_results = signal<EcommerceProduct[]>([]);
  readonly is_loading = signal(false);
  readonly show_dropdown = signal(false);
  readonly selected_index = signal(-1);

  private search_subject = new Subject<string>();
  private destroyRef = inject(DestroyRef);

  private catalog_service = inject(CatalogService);
  private router = inject(Router);

  constructor() {
    this.search_subject
      .pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        if (query.trim().length >= 2) {
          this.onSubmit();
        } else if (query.trim().length === 0) {
          // Navegar sin el parámetro search para limpiar resultados
          this.router.navigate(['/productos'], {
            queryParams: { search: null },
            queryParamsHandling: 'merge',
          });
        }
      });
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.search_query.set(input.value);
    this.search_subject.next(this.search_query());
  }

  onSubmit(): void {
    if (this.search_query().trim()) {
      this.router.navigate(['/productos'], {
        queryParams: { search: this.search_query() },
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
    if (this.search_query().length >= 2 && this.search_results().length > 0) {
      this.show_dropdown.set(true);
    }
  }

  closeDropdown(): void {
    this.show_dropdown.set(false);
    this.selected_index.set(-1);
  }

  ngOnDestroy(): void {
    this.search_subject.complete();
  }
}
