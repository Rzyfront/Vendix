import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Category } from '../../services/catalog.service';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-categories-showcase',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './categories-showcase.component.html',
  styleUrls: ['./categories-showcase.component.scss'],
})
export class CategoriesShowcaseComponent {
  @Input() limit = 6;
  @Input() show_all_link = true;
  @Input() class = '';

  categories: Category[] = [];
  is_loading = true;

  private catalog_service = inject(CatalogService);
  private router = inject(Router);

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.catalog_service.getCategories().subscribe({
      next: response => {
        if (response.success) {
          this.categories = response.data.slice(0, this.limit);
        }
        this.is_loading = false;
      },
      error: () => {
        this.categories = [];
        this.is_loading = false;
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
