import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  SimpleChanges,
  OnChanges,
  HostListener,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import {
  IconComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';

import {
  ProductCategory,
  Brand,
  ProductQueryDto,
  ProductState,
} from '../../interfaces';

@Component({
  selector: 'app-product-filter-dropdown',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IconComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  templateUrl: './product-filter-dropdown.component.html',
  styleUrls: ['./product-filter-dropdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductFilterDropdownComponent implements OnChanges {
  @Input() searchTerm: string = '';
  @Input() selectedState: string = '';
  @Input() selectedCategory: string = '';
  @Input() selectedBrand: string = '';
  @Input() categories: ProductCategory[] = [];
  @Input() brands: Brand[] = [];
  @Input() isLoading: boolean = false;

  @Output() filterChange = new EventEmitter<ProductQueryDto>();
  @Output() clearAllFilters = new EventEmitter<void>();

  @ViewChild('dropdownContainer') dropdownContainer!: ElementRef<HTMLElement>;

  isOpen: boolean = false;
  activeFiltersCount: number = 0;

  // Local state for form
  localSelectedState: string = '';
  localSelectedCategory: string = '';
  localSelectedBrand: string = '';

  // Selector options
  stateOptions: SelectorOption[] = [
    { value: '', label: 'Todos los Estados' },
    { value: ProductState.ACTIVE, label: 'Activo' },
    { value: ProductState.INACTIVE, label: 'Inactivo' },
    { value: ProductState.ARCHIVED, label: 'Archivado' },
  ];

  categoryOptions: SelectorOption[] = [];
  brandOptions: SelectorOption[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    // Update local state when inputs change
    if (changes['selectedState']) {
      this.localSelectedState = this.selectedState;
    }
    if (changes['selectedCategory']) {
      this.localSelectedCategory = this.selectedCategory;
    }
    if (changes['selectedBrand']) {
      this.localSelectedBrand = this.selectedBrand;
    }

    // Update selector options
    this.updateSelectorOptions();

    // Calculate active filters count
    this.calculateActiveFiltersCount();
  }

  private updateSelectorOptions(): void {
    this.categoryOptions = [
      { value: '', label: 'Todas las Categorías' },
      ...this.categories.map((category) => ({
        value: category.id.toString(),
        label: category.name,
      })),
    ];

    this.brandOptions = [
      { value: '', label: 'Todas las Marcas' },
      ...this.brands.map((brand) => ({
        value: brand.id.toString(),
        label: brand.name,
      })),
    ];
  }

  private calculateActiveFiltersCount(): void {
    let count = 0;
    if (this.selectedState) count++;
    if (this.selectedCategory) count++;
    if (this.selectedBrand) count++;
    this.activeFiltersCount = count;
  }

  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      // Reset local state to current values when opening
      this.localSelectedState = this.selectedState;
      this.localSelectedCategory = this.selectedCategory;
      this.localSelectedBrand = this.selectedBrand;
    }
  }

  closeDropdown(): void {
    this.isOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (
      this.dropdownContainer &&
      !this.dropdownContainer.nativeElement.contains(event.target as Node)
    ) {
      this.closeDropdown();
    }
  }

  @HostListener('keydown.escape')
  onEscapeKey(): void {
    this.closeDropdown();
  }

  onStateChange(value: string | number | null): void {
    this.localSelectedState = value?.toString() || '';
  }

  onCategoryChange(value: string | number | null): void {
    this.localSelectedCategory = value?.toString() || '';
  }

  onBrandChange(value: string | number | null): void {
    this.localSelectedBrand = value?.toString() || '';
  }

  onApplyFilters(): void {
    const query: ProductQueryDto = {
      ...(this.localSelectedState && {
        state: this.localSelectedState as ProductState,
      }),
      ...(this.localSelectedCategory && {
        category_id: parseInt(this.localSelectedCategory),
      }),
      ...(this.localSelectedBrand && {
        brand_id: parseInt(this.localSelectedBrand),
      }),
    };

    this.filterChange.emit(query);
    this.closeDropdown();
  }

  onClearAllFilters(): void {
    this.localSelectedState = '';
    this.localSelectedCategory = '';
    this.localSelectedBrand = '';

    this.clearAllFilters.emit();
    this.closeDropdown();
  }

  onClearFilter(filterType: 'state' | 'category' | 'brand'): void {
    switch (filterType) {
      case 'state':
        this.localSelectedState = '';
        break;
      case 'category':
        this.localSelectedCategory = '';
        break;
      case 'brand':
        this.localSelectedBrand = '';
        break;
    }
  }

  hasActiveFilter(filterType: 'state' | 'category' | 'brand'): boolean {
    switch (filterType) {
      case 'state':
        return !!this.localSelectedState;
      case 'category':
        return !!this.localSelectedCategory;
      case 'brand':
        return !!this.localSelectedBrand;
      default:
        return false;
    }
  }

  getActiveFilterLabel(filterType: 'state' | 'category' | 'brand'): string {
    switch (filterType) {
      case 'state':
        const stateOption = this.stateOptions.find(
          (opt) => opt.value === this.localSelectedState,
        );
        return stateOption ? stateOption.label : '';
      case 'category':
        const categoryOption = this.categoryOptions.find(
          (opt) => opt.value === this.localSelectedCategory,
        );
        return categoryOption ? categoryOption.label : '';
      case 'brand':
        const brandOption = this.brandOptions.find(
          (opt) => opt.value === this.localSelectedBrand,
        );
        return brandOption ? brandOption.label : '';
      default:
        return '';
    }
  }
}
