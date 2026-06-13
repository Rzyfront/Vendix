import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/index';
import { ProductsService } from '../../../../products/services/products.service';
import {
  TableSessionAddItem,
  SellableProductOption,
} from '../../interfaces';

interface ProductRow extends SellableProductOption {
  quantity: number;
}

/**
 * Modal to append lines to an open table session (cuenta abierta).
 *
 * The user picks a product (filtered to `is_sellable=true` server-side
 * by the `addItems` endpoint) and a quantity. Multiple lines can be
 * added in a single call; the form serializes them on submit.
 */
@Component({
  selector: 'app-add-items-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SpinnerComponent,
    CurrencyPipe,
  ],
  templateUrl: './add-items-modal.component.html',
  styleUrl: './add-items-modal.component.scss',
})
export class AddItemsModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly loadingInput = input(false, { alias: 'loading' });
  readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());

  readonly isOpenChange = output<boolean>();
  readonly addItems = output<TableSessionAddItem[]>();

  readonly products = signal<SellableProductOption[]>([]);
  readonly productRows = signal<ProductRow[]>([]);
  readonly productsLoading = signal(false);
  readonly searchTerm = signal('');

  readonly filteredRows = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const rows = this.productRows();
    if (!term) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(term));
  });

  readonly hasItems = computed(() =>
    this.productRows().some((r) => r.quantity > 0),
  );

  readonly totalPreview = computed(() => {
    return this.productRows().reduce((acc, r) => {
      const price = Number(r.base_price ?? 0);
      return acc + price * r.quantity;
    }, 0);
  });

  readonly form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      search: [''],
    });
  }

  ngOnInit(): void {
    this.loadProducts();
  }

  onOpenChange(open: boolean): void {
    this.isOpenChange.emit(open);
  }

  onCancel(): void {
    this.onOpenChange(false);
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
  }

  increment(row: ProductRow): void {
    row.quantity += 1;
    this.productRows.set([...this.productRows()]);
  }

  decrement(row: ProductRow): void {
    if (row.quantity > 0) {
      row.quantity -= 1;
      this.productRows.set([...this.productRows()]);
    }
  }

  onSubmit(): void {
    const items = this.productRows()
      .filter((r) => r.quantity > 0)
      .map((r) => ({ product_id: r.id, quantity: r.quantity }));
    if (items.length === 0) {
      this.toastService.error('Agrega al menos un producto con cantidad > 0');
      return;
    }
    this.addItems.emit(items);
  }

  trackById(_i: number, row: ProductRow): number {
    return row.id;
  }

  private loadProducts(): void {
    this.productsLoading.set(true);
    this.productsService
      .getProducts({ limit: 100, is_sellable: true } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = (res.data ?? []) as unknown as SellableProductOption[];
          this.products.set(list);
          this.productRows.set(
            list.map((p) => ({
              ...p,
              quantity: 0,
            })),
          );
          this.productsLoading.set(false);
        },
        error: () => {
          this.productsLoading.set(false);
        },
      });
  }
}
