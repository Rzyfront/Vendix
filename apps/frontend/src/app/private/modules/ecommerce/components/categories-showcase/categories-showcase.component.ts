import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule, Router } from '@angular/router';
import { Category } from '../../services/catalog.service';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-categories-showcase',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './categories-showcase.component.html',
  styleUrls: ['./categories-showcase.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesShowcaseComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  readonly limit = input<number>(6);
  readonly title = input<string>('Categorías');
  readonly subtitle = input<string>('');
  readonly show_all_link = input<boolean>(true);
  readonly class = input<string>('');

  readonly categories = signal<Category[]>([]);
  readonly is_loading = signal(true);

  private catalog_service = inject(CatalogService);
  private router = inject(Router);

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.catalog_service.getCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.router.navigate(['/catalog'], { queryParams: { category: category.id } });
  }

  viewAllCategories(): void {
    this.router.navigate(['/catalog']);
  }
}
