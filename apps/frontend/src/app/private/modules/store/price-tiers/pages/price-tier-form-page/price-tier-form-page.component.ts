import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';

import {
  InputComponent,
  TextareaComponent,
  SettingToggleComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  CardComponent,
  ToastService,
} from '../../../../../../shared/components/index';

import {
  CreatePriceTierDto,
  PriceTier,
  UpdatePriceTierDto,
} from '../../interfaces';
import { PriceTiersService, PriceTierCacheService } from '../../services';

/**
 * Reactive form group typed for the price tier form.
 * Mirrors CreatePriceTierDto with frontend defaults.
 */
interface PriceTierFormControls {
  name: FormControl<string>;
  code: FormControl<string>;
  description: FormControl<string>;
  discount_percentage: FormControl<number | null>;
  is_active: FormControl<boolean>;
  is_default: FormControl<boolean>;
  is_package_unit: FormControl<boolean>;
  sort_order: FormControl<number | null>;
}

@Component({
  selector: 'app-price-tier-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    TextareaComponent,
    SettingToggleComponent,
  ],
  templateUrl: './price-tier-form-page.component.html',
  styleUrl: './price-tier-form-page.component.scss',
})
export class PriceTierFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly priceTiersService = inject(PriceTiersService);
  private readonly priceTierCache = inject(PriceTierCacheService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tierId = signal<number | null>(null);
  readonly isEditMode = computed(() => this.tierId() !== null);
  readonly isLoading = signal(false);
  readonly isSubmitting = signal(false);

  readonly form: FormGroup<PriceTierFormControls> =
    this.fb.nonNullable.group<PriceTierFormControls>({
      name: this.fb.nonNullable.control('', {
        validators: [Validators.required, Validators.maxLength(100)],
      }),
      code: this.fb.nonNullable.control('', {
        validators: [Validators.maxLength(50)],
      }),
      description: this.fb.nonNullable.control('', {
        validators: [Validators.maxLength(500)],
      }),
      discount_percentage: new FormControl<number | null>(0, {
        validators: [Validators.min(0), Validators.max(100)],
      }),
      is_active: this.fb.nonNullable.control(true),
      is_default: this.fb.nonNullable.control(false),
      is_package_unit: this.fb.nonNullable.control(false),
      sort_order: new FormControl<number | null>(0, {
        validators: [Validators.min(0)],
      }),
    });

  /**
   * Signal mirror of `form.status` so `computed()` can react to validity changes.
   * Without this, `headerActions` computes once with the initial invalid state
   * (name vacío = required) and the "Crear Tarifa" button stays permanently
   * disabled even after the user fills the form.
   */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'cancel',
      label: 'Cancelar',
      variant: 'outline',
      disabled: this.isSubmitting(),
    },
    {
      id: 'save',
      label: this.isEditMode() ? 'Guardar Cambios' : 'Crear Tarifa',
      variant: 'primary',
      icon: 'save',
      loading: this.isSubmitting(),
      disabled: this.isSubmitting() || this.formStatus() === 'INVALID',
    },
  ]);

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isFinite(id) || id <= 0) {
        this.toastService.error('Identificador de tarifa inválido');
        this.router.navigate(['/admin/price-tiers']);
        return;
      }
      this.tierId.set(id);
      this.loadTier(id);
    }
  }

  private loadTier(id: number): void {
    this.isLoading.set(true);
    this.priceTiersService
      .getById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tier) => {
          this.patchForm(tier);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al cargar la tarifa',
          );
          this.isLoading.set(false);
          this.router.navigate(['/admin/price-tiers']);
        },
      });
  }

  private patchForm(tier: PriceTier): void {
    this.form.patchValue({
      name: tier.name ?? '',
      code: tier.code ?? '',
      description: tier.description ?? '',
      discount_percentage:
        tier.discount_percentage == null
          ? 0
          : Number(tier.discount_percentage),
      is_active: tier.is_active,
      is_default: tier.is_default,
      is_package_unit: tier.is_package_unit,
      sort_order: tier.sort_order ?? 0,
    });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') {
      this.cancel();
    } else if (actionId === 'save') {
      this.save();
    }
  }

  cancel(): void {
    this.router.navigate(['/admin/price-tiers']);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.warning('Revisa los campos del formulario');
      return;
    }

    const raw = this.form.getRawValue();
    const payload: CreatePriceTierDto = {
      name: raw.name.trim(),
      code: raw.code?.trim() ? raw.code.trim() : undefined,
      description: raw.description?.trim() ? raw.description.trim() : undefined,
      discount_percentage:
        raw.discount_percentage == null ? 0 : Number(raw.discount_percentage),
      is_active: raw.is_active,
      is_default: raw.is_default,
      is_package_unit: raw.is_package_unit,
      sort_order: raw.sort_order == null ? 0 : Number(raw.sort_order),
    };

    this.isSubmitting.set(true);

    const currentId = this.tierId();
    const request$ = currentId
      ? this.priceTiersService.update(currentId, payload as UpdatePriceTierDto)
      : this.priceTiersService.create(payload);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            currentId
              ? 'Tarifa actualizada correctamente'
              : 'Tarifa creada correctamente',
          );
          // Force POS/quotations/etc. to re-fetch the catalog on next open.
          this.priceTierCache.invalidate();
          this.isSubmitting.set(false);
          this.router.navigate(['/admin/price-tiers']);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al guardar la tarifa',
          );
          this.isSubmitting.set(false);
        },
      });
  }

  getError(fieldName: keyof PriceTierFormControls): string {
    const control = this.form.get(fieldName);
    if (!control || !control.touched || !control.errors) return '';
    if (control.errors['required']) return 'Este campo es requerido';
    if (control.errors['maxlength']) return 'Texto demasiado largo';
    if (control.errors['min']) return `Mínimo ${control.errors['min'].min}`;
    if (control.errors['max']) return `Máximo ${control.errors['max'].max}`;
    return '';
  }
}
