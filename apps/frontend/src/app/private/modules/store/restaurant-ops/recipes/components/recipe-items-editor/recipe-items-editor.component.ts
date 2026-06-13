import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import { RecipeIngredientOption } from '../../interfaces';
import { RecipeIngredientsService } from '../../services';

/**
 * Reactive shape of a single recipe_items row in the form. Mirrors the
 * backend's `recipe_items` write contract.
 */
interface RecipeItemFormControls {
  component_product_id: FormControl<number | null>;
  quantity: FormControl<number | null>;
  waste_percent: FormControl<number | null>;
  is_optional: FormControl<boolean>;
}

/**
 * Editor for the `recipe_items` FormArray. Owns:
 *  - the product selector (filtered to `is_ingredient=true`),
 *  - quantity + waste percent inputs,
 *  - the optional flag,
 *  - add / remove row actions.
 *
 * It is a presentational + minimal-logic component: it does not talk to the
 * backend directly. The parent form drives the network calls.
 */
@Component({
  selector: 'app-recipe-items-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    SettingToggleComponent,
    TextareaComponent,
  ],
  templateUrl: './recipe-items-editor.component.html',
  styleUrl: './recipe-items-editor.component.scss',
})
export class RecipeItemsEditorComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly ingredientsService = inject(RecipeIngredientsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** The FormArray<FormGroup<...>> owned by the parent form. */
  readonly items = input.required<FormArray<FormGroup<RecipeItemFormControls>>>();

  /** Emitted when a row is added/removed so the parent can recompute stats. */
  readonly itemsChanged = output<void>();

  readonly ingredients = signal<RecipeIngredientOption[]>([]);
  readonly isLoadingIngredients = signal(false);

  /** Lazy selector modal: which row (index) is currently picking an ingredient. */
  readonly pickerIndex = signal<number | null>(null);
  readonly pickerOptions = computed<SelectorOption[]>(() =>
    this.ingredients().map((i) => ({
      value: i.id,
      label: i.name + (i.sku ? ` (${i.sku})` : ''),
      description: i.stock_unit ? `Unidad: ${i.stock_unit}` : undefined,
    })),
  );

  readonly pickerForm = this.fb.nonNullable.group({
    selected: this.fb.nonNullable.control<number | null>(null),
  });

  ngOnInit(): void {
    this.loadIngredients();
  }

  private loadIngredients(): void {
    this.isLoadingIngredients.set(true);
    this.ingredientsService
      .listIngredients()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.ingredients.set(list);
          this.isLoadingIngredients.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los ingredientes');
          this.isLoadingIngredients.set(false);
        },
      });
  }

  addItem(): void {
    const items = this.items();
    items.push(
      this.fb.nonNullable.group<RecipeItemFormControls>({
        component_product_id: this.fb.nonNullable.control<number | null>(null, {
          validators: [Validators.required],
        }),
        quantity: this.fb.nonNullable.control<number | null>(0, {
          validators: [Validators.required, Validators.min(0)],
        }),
        waste_percent: this.fb.nonNullable.control<number | null>(0, {
          validators: [Validators.min(0), Validators.max(100)],
        }),
        is_optional: this.fb.nonNullable.control(false),
      }),
    );
    this.itemsChanged.emit();
  }

  removeItem(index: number): void {
    this.items().removeAt(index);
    this.itemsChanged.emit();
  }

  /**
   * Returns the option label for a given product_id without doing an extra
   * async lookup — uses the cached `ingredients()` signal.
   */
  productLabel(productId: number | null | undefined): string {
    if (productId == null) return 'Selecciona un ingrediente';
    const found = this.ingredients().find((i) => i.id === productId);
    if (found) {
      return found.name + (found.sku ? ` (${found.sku})` : '');
    }
    return `Producto #${productId}`;
  }

  productUnit(productId: number | null | undefined): string {
    if (productId == null) return '';
    const found = this.ingredients().find((i) => i.id === productId);
    return found?.stock_unit ?? '';
  }

  openPicker(index: number): void {
    this.pickerIndex.set(index);
    const current = this.items().at(index).get('component_product_id')?.value;
    this.pickerForm.patchValue({ selected: current ?? null });
  }

  closePicker(): void {
    this.pickerIndex.set(null);
  }

  confirmPicker(): void {
    const idx = this.pickerIndex();
    if (idx == null) return;
    const selected = this.pickerForm.get('selected')?.value as number | null;
    if (selected == null) {
      this.toastService.warning('Selecciona un ingrediente primero');
      return;
    }

    // The picker form is the canonical source of truth for the modal state;
    // we explicitly set the FormControl's value (not via ngModel) so it stays
    // in sync with CVA validation in the parent FormArray.
    const control = this.items().at(idx).get('component_product_id');
    control?.setValue(selected);
    control?.markAsTouched();

    this.closePicker();
  }
}
