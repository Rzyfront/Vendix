import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map, startWith } from 'rxjs/operators';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { toUTCDateString } from '../../../../../../../shared/utils/date.util';

import {
  CreateManufacturingOrderDto,
  Formula,
  ManufacturingPriority,
  ORDER_PRIORITY_LABELS,
  UpdateManufacturingOrderDto,
} from '../../../interfaces';
import {
  ManufacturingFormulasService,
  ManufacturingOrdersService,
} from '../../../services';
import { InventoryService } from '../../../../inventory/services/inventory.service';

interface OrderFormShape {
  recipe_id: FormControl<number | null>;
  planned_qty: FormControl<number | null>;
  due_date: FormControl<string>;
  location_id: FormControl<number | null>;
  priority: FormControl<ManufacturingPriority>;
  notes: FormControl<string>;
}

const LIST_ROUTE = '/admin/manufacturing/orders';

@Component({
  selector: 'app-manufacturing-order-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ButtonComponent,
  ],
  templateUrl: './order-form-page.component.html',
})
export class OrderFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly ordersService = inject(ManufacturingOrdersService);
  private readonly formulasService = inject(ManufacturingFormulasService);
  private readonly inventoryService = inject(InventoryService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly isEditMode = signal(false);
  readonly orderId = signal<number | null>(null);
  readonly isSubmitting = signal(false);
  readonly isLoading = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly formulas = signal<Formula[]>([]);
  readonly locationOptions = signal<SelectorOption[]>([]);

  readonly priorityOptions: SelectorOption[] = (
    Object.keys(ORDER_PRIORITY_LABELS) as ManufacturingPriority[]
  ).map((value) => ({ value, label: ORDER_PRIORITY_LABELS[value] }));

  readonly form: FormGroup<OrderFormShape> = this.fb.nonNullable.group<OrderFormShape>({
    recipe_id: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required],
    }),
    planned_qty: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)],
    }),
    due_date: this.fb.nonNullable.control(''),
    location_id: this.fb.nonNullable.control<number | null>(null),
    priority: this.fb.nonNullable.control<ManufacturingPriority>('normal'),
    notes: this.fb.nonNullable.control(''),
  });

  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(
      map(() => this.form.getRawValue()),
      startWith(this.form.getRawValue()),
    ),
    { initialValue: this.form.getRawValue() },
  );

  readonly formulaOptions = computed<SelectorOption[]>(() =>
    this.formulas().map((f) => ({
      value: f.id,
      label:
        (f.product?.name ?? `Producto #${f.product_id}`) +
        (f.code ? ` · ${f.code}` : '') +
        (f.version != null && f.version !== '' ? ` v${f.version}` : ''),
      description: `Rinde ${f.yield_quantity} ${f.yield_unit}`,
    })),
  );

  readonly selectedFormula = computed<Formula | null>(() => {
    const id = Number(this.formValue().recipe_id);
    return this.formulas().find((f) => f.id === id) ?? null;
  });

  ngOnInit(): void {
    this.loadFormulas();
    this.loadLocations();
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode.set(true);
      this.orderId.set(Number(id));
      this.form.controls.recipe_id.disable({ emitEvent: false });
      this.loadOrder(Number(id));
    }
  }

  private loadFormulas(): void {
    this.formulasService
      .listPaginated({ status: 'active', limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.formulas.set(res.data ?? []),
        error: () => this.toastService.error('No se pudieron cargar las fórmulas'),
      });
  }

  private loadLocations(): void {
    this.inventoryService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) =>
          this.locationOptions.set(
            (res.data ?? []).map((l) => ({
              value: l.id,
              label: l.name + (l.code ? ` (${l.code})` : ''),
            })),
          ),
        error: () => this.toastService.error('No se pudieron cargar las bodegas'),
      });
  }

  private loadOrder(id: number): void {
    this.isLoading.set(true);
    this.ordersService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          if (order.status !== 'draft' && order.status !== 'released') {
            this.toastService.warning(
              'Solo se pueden editar órdenes en borrador o lanzadas',
            );
            this.router.navigate([LIST_ROUTE, id]);
            return;
          }
          this.form.patchValue({
            recipe_id: order.recipe_id,
            planned_qty: Number(order.planned_qty),
            due_date: order.due_date ? toUTCDateString(new Date(order.due_date)) : '',
            location_id: order.location_id ?? null,
            priority: order.priority ?? 'normal',
            notes: order.notes ?? '',
          });
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'No se pudo cargar la orden',
          );
          this.isLoading.set(false);
          this.router.navigate([LIST_ROUTE]);
        },
      });
  }

  onSubmit(): void {
    this.submitError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.error('Completa los campos requeridos');
      return;
    }
    const raw = this.form.getRawValue();
    const common = {
      planned_qty: Number(raw.planned_qty),
      priority: raw.priority,
      ...(raw.due_date ? { due_date: raw.due_date } : {}),
      ...(raw.location_id != null ? { location_id: Number(raw.location_id) } : {}),
      ...(raw.notes.trim() ? { notes: raw.notes.trim() } : {}),
    };

    this.isSubmitting.set(true);
    if (this.isEditMode()) {
      const dto: UpdateManufacturingOrderDto = common;
      this.ordersService
        .update(this.orderId() as number, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (order) => {
            this.toastService.success('Orden actualizada');
            this.isSubmitting.set(false);
            this.router.navigate([LIST_ROUTE, order.id ?? this.orderId()]);
          },
          error: (error) => this.handleError(error, 'Error al actualizar la orden'),
        });
      return;
    }

    const dto: CreateManufacturingOrderDto = {
      recipe_id: Number(raw.recipe_id),
      ...common,
    };
    this.ordersService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          this.toastService.success(
            `Orden ${order.order_number ?? `#${order.id}`} creada en borrador`,
          );
          this.isSubmitting.set(false);
          this.router.navigate([LIST_ROUTE, order.id]);
        },
        error: (error) => this.handleError(error, 'Error al crear la orden'),
      });
  }

  private handleError(error: unknown, fallback: string): void {
    this.isSubmitting.set(false);
    const message = typeof error === 'string' ? error : fallback;
    this.submitError.set(message);
    this.toastService.error(message);
  }

  onCancel(): void {
    this.router.navigate([LIST_ROUTE]);
  }
}
