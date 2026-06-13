import {
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  CardComponent,
  InputComponent,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import { ProductionOrdersService } from '../../services';
import { CreateProductionOrderDto } from '../../interfaces';

interface ProductionFormControls {
  product_id: FormControl<number | null>;
  recipe_id: FormControl<number | null>;
  planned_qty: FormControl<number | null>;
  notes: FormControl<string>;
}

@Component({
  selector: 'app-production-order-form-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    TextareaComponent,
    ButtonComponent,
  ],
  templateUrl: './production-order-form-page.component.html',
  styleUrl: './production-order-form-page.component.scss',
})
export class ProductionOrderFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly productionService = inject(ProductionOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSubmitting = signal(false);

  readonly form: FormGroup<ProductionFormControls> = this.fb.group<ProductionFormControls>({
    product_id: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    recipe_id: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    planned_qty: this.fb.nonNullable.control<number | null>(null, [
      Validators.required,
      Validators.min(0.0001),
    ]),
    notes: this.fb.nonNullable.control(''),
  });

  get productIdControl(): FormControl<number | null> {
    return this.form.controls.product_id;
  }

  get recipeIdControl(): FormControl<number | null> {
    return this.form.controls.recipe_id;
  }

  get plannedQtyControl(): FormControl<number | null> {
    return this.form.controls.planned_qty;
  }

  get notesControl(): FormControl<string> {
    return this.form.controls.notes;
  }

  ngOnInit(): void {
    // No-op. The form starts empty. The user enters a product_id and
    // recipe_id (or copies them from the catalog); a richer product
    // selector with is_batch_produced filter can be wired here later
    // without changing the form contract.
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.error('Completa los campos requeridos');
      return;
    }
    const raw = this.form.getRawValue();
    if (
      raw.product_id == null ||
      raw.recipe_id == null ||
      raw.planned_qty == null
    ) {
      return;
    }

    const dto: CreateProductionOrderDto = {
      product_id: raw.product_id,
      recipe_id: raw.recipe_id,
      planned_qty: raw.planned_qty,
      notes: raw.notes?.trim() || undefined,
    };

    this.isSubmitting.set(true);
    this.productionService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.toastService.success('Orden de producción creada en estado draft');
          this.isSubmitting.set(false);
          this.router.navigate(['/admin/restaurant-ops/production']);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al crear la orden de producción',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  onCancel(): void {
    this.router.navigate(['/admin/restaurant-ops/production']);
  }
}
