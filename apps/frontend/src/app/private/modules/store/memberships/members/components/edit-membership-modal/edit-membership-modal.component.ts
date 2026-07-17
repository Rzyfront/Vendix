import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';

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
import { toUTCDateString } from '../../../../../../../shared/utils/date.util';

import {
  GymMembership,
  GymMembershipStatus,
  GYM_MEMBERSHIP_STATUS_LABELS,
  UpdateGymMembershipDto,
} from '../../interfaces';
import { MembershipsService } from '../../services';
import { MembershipPlansService } from '../../../plans/services';

interface EditFormShape {
  plan_id: FormControl<number | null>;
  period_start: FormControl<string>;
  period_end: FormControl<string>;
  status: FormControl<GymMembershipStatus | null>;
  auto_renew: FormControl<boolean>;
  notes: FormControl<string>;
}

/** Cross-field validator: period_start must not be after period_end. */
function periodOrderValidator(group: AbstractControl): ValidationErrors | null {
  const start = group.get('period_start')?.value as string | null;
  const end = group.get('period_end')?.value as string | null;
  if (start && end && start > end) return { periodOrder: true };
  return null;
}

/**
 * Admin "Editar membresía" modal (Membership Suite).
 *
 * Lets an admin edit every editable field of a membership — plan, start/end
 * dates, status, auto-renew and notes — and persists via
 * `MembershipsService.update` (PATCH). Only fields that actually changed are
 * sent. Dates are handled UTC-safe (`YYYY-MM-DD`, which the backend widens to
 * a full UTC day) to avoid off-by-one shifts. Zoneless + signals only.
 * Emits `saved` with the refreshed membership so the parent updates its view.
 */
@Component({
  selector: 'app-edit-membership-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    SettingToggleComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="open"
      title="Editar membresía"
      subtitle="Ajusta el plan, la vigencia y el estado de la membresía."
      size="md"
      (closed)="onClose()"
    >
      <form [formGroup]="form" class="space-y-4">
        <app-selector
          formControlName="plan_id"
          label="Plan"
          placeholder="Selecciona un plan"
          [options]="planOptions()"
          [searchable]="true"
          [required]="true"
          [disabled]="isLoadingPlans()"
          tooltipText="Plan de membresía asignado. No recalcula el precio cobrado."
        />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <app-input
            formControlName="period_start"
            label="Inicio del período"
            type="date"
            tooltipText="Fecha en que inicia la vigencia."
          />
          <app-input
            formControlName="period_end"
            label="Vence el"
            type="date"
            tooltipText="Fecha en que termina la vigencia."
          />
        </div>

        @if (periodOrderError()) {
          <p class="ems-error">
            La fecha de inicio no puede ser posterior a la de vencimiento.
          </p>
        }

        <app-selector
          formControlName="status"
          label="Estado"
          placeholder="Selecciona un estado"
          [options]="statusOptions"
          [required]="true"
          tooltipText="Estado de la membresía. Se aplica directamente al guardar."
        />

        <app-setting-toggle
          formControlName="auto_renew"
          label="Renovación automática"
          description="Marca la membresía para renovarse al vencer."
        />

        <app-textarea
          formControlName="notes"
          label="Notas"
          placeholder="Observaciones internas."
          [rows]="3"
          [maxlength]="2000"
        />
      </form>

      <div slot="footer" class="ems-footer">
        <app-button
          variant="primary"
          [fullWidth]="true"
          [loading]="isSubmitting()"
          [disabled]="!canSave() || !membership()"
          (clicked)="submit()"
        >
          <app-icon slot="icon" name="check-circle" [size]="18" />
          Guardar cambios
        </app-button>
        <app-button
          variant="ghost"
          [fullWidth]="true"
          [disabled]="isSubmitting()"
          (clicked)="onClose()"
          >Cancelar</app-button
        >
      </div>
    </app-modal>
  `,
  styles: [
    `
      .ems-error {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-danger, #dc2626);
        margin: -8px 0 0 0;
      }

      .ems-footer {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }
    `,
  ],
})
export class EditMembershipModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly membershipsService = inject(MembershipsService);
  private readonly plansService = inject(MembershipPlansService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model<boolean>(false);
  readonly membership = input<GymMembership | null>(null);
  readonly saved = output<GymMembership>();

  readonly planOptions = signal<SelectorOption[]>([]);
  readonly isLoadingPlans = signal(false);
  readonly isSubmitting = signal(false);
  private plansLoaded = false;
  private wasOpen = false;

  /** Static status options derived from the shared label map. */
  readonly statusOptions: SelectorOption[] = (
    Object.keys(GYM_MEMBERSHIP_STATUS_LABELS) as GymMembershipStatus[]
  ).map((s) => ({ value: s, label: GYM_MEMBERSHIP_STATUS_LABELS[s] }));

  readonly form: FormGroup<EditFormShape> = this.fb.nonNullable.group<EditFormShape>(
    {
      plan_id: this.fb.nonNullable.control<number | null>(null, {
        validators: [Validators.required],
      }),
      period_start: this.fb.nonNullable.control(''),
      period_end: this.fb.nonNullable.control(''),
      status: this.fb.nonNullable.control<GymMembershipStatus | null>(null, {
        validators: [Validators.required],
      }),
      auto_renew: this.fb.nonNullable.control(false),
      notes: this.fb.nonNullable.control(''),
    },
    { validators: [periodOrderValidator] },
  );

  /** Reactive form status bridge (zoneless: plain form.status is not a signal). */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly canSave = computed(
    () => this.formStatus() === 'VALID' && !this.isSubmitting(),
  );

  /** Reactive value bridge to surface the date-order error inline. */
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly periodOrderError = computed(() => {
    const v = this.formValue();
    return !!(v.period_start && v.period_end && v.period_start > v.period_end);
  });

  constructor() {
    effect(() => {
      const isOpen = this.open();
      if (isOpen && !this.wasOpen) {
        if (!this.plansLoaded) {
          this.plansLoaded = true;
          this.loadPlans();
        }
        this.prefillFromMembership();
      }
      this.wasOpen = isOpen;
    });
  }

  private loadPlans(): void {
    this.isLoadingPlans.set(true);
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
          this.isLoadingPlans.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los planes');
          this.isLoadingPlans.set(false);
        },
      });
  }

  /** Convert a backend date-only field (midnight UTC) to a `YYYY-MM-DD` input value. */
  private toInputDate(value?: string | null): string {
    return value ? toUTCDateString(new Date(value)) : '';
  }

  private prefillFromMembership(): void {
    const m = this.membership();
    if (!m) return;
    this.form.patchValue(
      {
        plan_id: m.plan_id ?? null,
        period_start: this.toInputDate(m.period_start),
        period_end: this.toInputDate(m.period_end),
        status: m.status ?? null,
        auto_renew: m.auto_renew ?? false,
        notes: m.notes ?? '',
      },
      { emitEvent: false },
    );
    this.form.markAsPristine();
  }

  onClose(): void {
    this.open.set(false);
  }

  submit(): void {
    const m = this.membership();
    if (!m) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      if (this.periodOrderError()) {
        this.toastService.warning(
          'La fecha de inicio no puede ser posterior a la de vencimiento',
        );
      } else {
        this.toastService.warning('Completa el plan y el estado');
      }
      return;
    }

    const raw = this.form.getRawValue();
    const dto: UpdateGymMembershipDto = {};

    if (raw.plan_id != null && raw.plan_id !== m.plan_id) {
      dto.plan_id = raw.plan_id;
    }
    if (raw.period_start && raw.period_start !== this.toInputDate(m.period_start)) {
      dto.period_start = raw.period_start;
    }
    if (raw.period_end && raw.period_end !== this.toInputDate(m.period_end)) {
      dto.period_end = raw.period_end;
    }
    if (raw.status && raw.status !== m.status) {
      dto.status = raw.status;
    }
    if (raw.auto_renew !== m.auto_renew) {
      dto.auto_renew = raw.auto_renew;
    }
    const notes = raw.notes?.trim() ?? '';
    if (notes !== (m.notes ?? '')) {
      dto.notes = notes;
    }

    if (Object.keys(dto).length === 0) {
      this.toastService.info('No hay cambios para guardar');
      this.open.set(false);
      return;
    }

    this.isSubmitting.set(true);
    this.membershipsService
      .update(m.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.isSubmitting.set(false);
          this.toastService.success('Membresía actualizada');
          this.open.set(false);
          this.saved.emit(updated);
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'No se pudo actualizar la membresía',
          );
        },
      });
  }
}
