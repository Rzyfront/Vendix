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
import { of } from 'rxjs';
import { catchError, startWith, switchMap } from 'rxjs/operators';
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
  SettingToggleComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

import { CustomersService } from '../../../../customers/services/customers.service';
import {
  Customer,
  CreateCustomerRequest,
} from '../../../../customers/models/customer.model';
import { CustomerModalComponent } from '../../../../customers/components/customer-modal/customer-modal.component';
import { translateCustomerError } from '../../../../customers/utils/customer-error.translator';
import { MembershipPlansService } from '../../../plans/services';
import { CreateGymMembershipDto, GymMembership } from '../../interfaces';
import { MembershipsService } from '../../services';
import { RenewMembershipModalComponent } from '../../components/renew-membership-modal/renew-membership-modal.component';

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
    ButtonComponent,
    CustomerModalComponent,
    RenewMembershipModalComponent,
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

  /** Inline "crear cliente" modal state. */
  readonly isCustomerModalOpen = signal(false);
  readonly isCreatingCustomer = signal(false);

  /** Post-alta optional charge modal (reuses the renew modal). */
  readonly showChargeModal = signal(false);
  readonly createdMembership = signal<GymMembership | null>(null);
  /** Guard: navigate to the detail exactly once when the charge flow ends. */
  private finishing = false;

  readonly form: FormGroup<MembershipFormShape> =
    this.fb.nonNullable.group<MembershipFormShape>({
      customer_id: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.required],
      }),
      plan_id: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.required],
      }),
      period_start: this.fb.nonNullable.control(toLocalDateString()),
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
      .pipe(
        // `create` returns the bare membership (no plan/customer snapshot), so we
        // enrich it via `getById` (which attaches the plan) to render the correct
        // plan name/price in the charge modal. Fall back to the raw membership if
        // the enrich call fails — the backend renew still charges the plan price.
        switchMap((created) =>
          this.membershipsService
            .getById(created.id)
            .pipe(catchError(() => of(created))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (membership) => {
          this.isSubmitting.set(false);
          this.toastService.success('Membresía asignada correctamente');
          // Offer an OPTIONAL charge right away by reusing the renew modal.
          this.finishing = false;
          this.createdMembership.set(membership);
          this.showChargeModal.set(true);
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al asignar la membresía',
          );
        },
      });
  }

  // --- Inline customer creation ------------------------------------------

  openCustomerModal(): void {
    this.isCustomerModalOpen.set(true);
  }

  onCustomerCreated(data: CreateCustomerRequest): void {
    this.isCreatingCustomer.set(true);
    this.customersService
      .createCustomer(data)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (customer: Customer) => {
          this.isCreatingCustomer.set(false);
          this.isCustomerModalOpen.set(false);
          const option: SelectorOption = {
            value: customer.id,
            label:
              `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() ||
              customer.email,
            description: customer.email ?? undefined,
          };
          // Prepend the new customer and select it in the form.
          this.customerOptions.update((opts) => [
            option,
            ...opts.filter((o) => o.value !== customer.id),
          ]);
          this.form.controls.customer_id.setValue(customer.id);
          this.toastService.success('Cliente creado y seleccionado');
        },
        error: (err: unknown) => {
          this.isCreatingCustomer.set(false);
          this.toastService.error(
            translateCustomerError(err, 'No se pudo crear el cliente'),
          );
        },
      });
  }

  // --- Optional post-alta charge (renew modal) ---------------------------

  /**
   * Fired when the charge modal open state changes. When it closes (via cancel,
   * backdrop, or after a successful charge) we navigate to the membership detail.
   * If closed without charging, the membership stays `pending_payment`.
   */
  onChargeModalOpenChange(open: boolean): void {
    this.showChargeModal.set(open);
    if (!open) this.finishToDetail();
  }

  /** Fired when the renew modal reports a successful charge. */
  onCharged(updated: GymMembership): void {
    this.createdMembership.set(updated);
    this.finishToDetail();
  }

  private finishToDetail(): void {
    if (this.finishing) return;
    this.finishing = true;
    const id = this.createdMembership()?.id;
    this.router.navigate(
      id != null
        ? ['/admin/memberships/members', id]
        : ['/admin/memberships/members'],
    );
  }
}
