import { Component, inject, input, signal } from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { Category } from '../../services/catalog.service';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-categories-showcase',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './categories-showcase.component.html',
  styleUrls: ['./categories-showcase.component.scss'],
})
export class CategoriesShowcaseComponent {
  readonly limit = input<number>(6);
  readonly show_all_link = input<boolean>(true);
  readonly class = input<string>('');

  readonly categories = signal<Category[]>([]);
  readonly is_loading = signal(true);

  private catalog_service = inject(CatalogService);
  private router = inject(Router);

  constructor() {
    this.loadCategories();
  }

  loadCategories(): void {
    this.catalog_service.getCategories().subscribe({
      next: response => {
        if (response.success) {
          this.categories.set(response.data.slice(0, this.limit()));
        }
        this.is_loading.set(false);
      },
      error: () => {
        this.categories.set([]);
        this.is_loading.set(false);
      },
    });
  }

  onCategoryClick(category: Category): void {
    this.router.navigate(['/catalog'], { queryParams: { category_id: category.id } });
  }

  viewAllCategories(): void {
    this.router.navigate(['/catalog']);
  }
}
