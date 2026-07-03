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
import { startWith } from 'rxjs/operators';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  CardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import { CustomersService } from '../../../../customers/services/customers.service';
import { Customer } from '../../../../customers/models/customer.model';
import { MembershipPlansService } from '../../../plans/services';
import { CreateGymMembershipDto } from '../../interfaces';
import { MembershipsService } from '../../services';

interface MembershipFormShape {
  customer_id: FormControl<number | null>;
  plan_id: FormControl<number | null>;
  period_start: FormControl<string>;
  auto_renew: FormControl<boolean>;
  notes: FormControl<string>;
}

@Component({
  selector: 'app-membership-form-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
    TextareaComponent,
    IconComponent,
  ],
  templateUrl: './membership-form-page.component.html',
})
export class MembershipFormPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly membershipsService = inject(MembershipsService);
  private readonly plansService = inject(MembershipPlansService);
  private readonly customersService = inject(CustomersService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSubmitting = signal(false);
  readonly isLoadingOptions = signal(false);

  readonly customerOptions = signal<SelectorOption[]>([]);
  readonly planOptions = signal<SelectorOption[]>([]);

  readonly form: FormGroup<MembershipFormShape> =
    this.fb.nonNullable.group<MembershipFormShape>({
      customer_id: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.required],
      }),
      plan_id: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.required],
      }),
      period_start: this.fb.nonNullable.control(''),
      auto_renew: this.fb.nonNullable.control(false),
      notes: this.fb.nonNullable.control(''),
    });

  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const invalid = this.formStatus() !== 'VALID';
    return [
      {
        id: 'cancel',
        label: 'Cancelar',
        variant: 'outline',
        disabled: this.isSubmitting(),
      },
      {
        id: 'save',
        label: 'Asignar membresía',
        icon: 'plus',
        variant: 'primary',
        loading: this.isSubmitting(),
        disabled: invalid || this.isSubmitting(),
      },
    ];
  });

  ngOnInit(): void {
    this.loadOptions();

    const rawCustomerId = this.route.snapshot.queryParamMap.get('customer_id');
    const customerId = rawCustomerId ? Number(rawCustomerId) : NaN;
    if (Number.isFinite(customerId)) {
      this.form.controls.customer_id.setValue(customerId);
    }
  }

  private loadOptions(): void {
    this.isLoadingOptions.set(true);

    this.customersService
      .getCustomers(1, 500)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.customerOptions.set(
            rows.map((c: Customer) => ({
              value: c.id,
              label: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() ||
                c.email,
              description: c.email ?? undefined,
            })),
          );
        },
        error: () =>
          this.toastService.error('No se pudieron cargar los clientes'),
      });

    this.plansService
      .listPaginated({ limit: 500, is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.planOptions.set(
            rows.map((p) => ({
              value: p.id,
              label: p.name,
              description: `${p.code} · ${p.duration_days} días`,
            })),
          );
          this.isLoadingOptions.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los planes');
          this.isLoadingOptions.set(false);
        },
      });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') this.router.navigate(['/admin/memberships/members']);
    else if (actionId === 'save') this.submit();
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.toastService.warning('Selecciona el socio y el plan antes de guardar');
      return;
    }

    const raw = this.form.getRawValue();
    const dto: CreateGymMembershipDto = {
      customer_id: raw.customer_id as number,
      plan_id: raw.plan_id as number,
      period_start: raw.period_start || undefined,
      auto_renew: raw.auto_renew,
      notes: raw.notes?.trim() || undefined,
    };

    this.isSubmitting.set(true);
    this.membershipsService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (membership) => {
          this.isSubmitting.set(false);
          this.toastService.success('Membresía asignada correctamente');
          this.router.navigate(['/admin/memberships/members', membership.id]);
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al asignar la membresía',
          );
        },
      });
  }
}
