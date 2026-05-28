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
import { Router } from '@angular/router';

import { Brand, CatalogService } from '../../services/catalog.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-brands-showcase',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './brands-showcase.component.html',
  styleUrls: ['./brands-showcase.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandsShowcaseComponent implements OnInit {
  readonly limit = input<number>(8);
  readonly title = input<string>('Marcas');
  readonly subtitle = input<string>('');
  readonly show_all_link = input<boolean>(true);
  readonly class = input<string>('');

  readonly brands = signal<Brand[]>([]);
  readonly is_loading = signal(true);

  private readonly catalogService = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.loadBrands();
  }

  private loadBrands(): void {
    this.catalogService
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.brands.set(response.success ? response.data.slice(0, this.limit()) : []);
          this.is_loading.set(false);
        },
        error: () => {
          this.brands.set([]);
          this.is_loading.set(false);
        },
      });
  }

  onBrandClick(brand: Brand): void {
    this.router.navigate(['/catalog'], { queryParams: { brand: brand.id } });
  }

  viewAllBrands(): void {
    this.router.navigate(['/catalog']);
  }
}
