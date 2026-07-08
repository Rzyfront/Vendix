import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';

import { CustomersService } from '../../../../customers/services/customers.service';
import { Customer } from '../../../../customers/models/customer.model';
import {
  CreateCredentialDto,
  CreateCredentialResponse,
  GymAccessCredential,
  GymCredentialType,
  UpdateCredentialDto,
} from '../../interfaces';
import { MembershipAccessService } from '../../services';

interface CredentialFormShape {
  customer_id: FormControl<number | null>;
  credential_type: FormControl<GymCredentialType>;
  credential_value: FormControl<string>;
  is_active: FormControl<boolean>;
}

/**
 * Create / edit a membership access credential.
 *
 * On CREATE the operator picks a customer + type. For `qr` / `pin` the
 * backend auto-generates the value one-shot (returned in the response so the
 * modal can show + email it); for `external_ref` the operator supplies the
 * device id.
 *
 * On EDIT only the value and active flag can change (owner and type are
 * immutable). The API returns a masked hint, so the input starts EMPTY — an
 * empty submit means "keep the current value".
 *
 * Emits `saved` when the write succeeds.
 */
@Component({
  selector: 'app-membership-credential-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    SelectorComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="open"
      [title]="credential() ? 'Editar credencial' : 'Nueva credencial'"
      subtitle="Referencia de acceso (QR, PIN o referencia externa)."
      size="md"
      (closed)="onClose()"
    >
      <form [formGroup]="form" class="space-y-4">
        @if (!credential()) {
          <app-selector
            formControlName="customer_id"
            label="Socio"
            placeholder="Selecciona un socio"
            [options]="customerOptions()"
            [searchable]="true"
            [required]="true"
            [disabled]="isLoadingCustomers()"
          />
          <app-selector
            formControlName="credential_type"
            label="Tipo de credencial"
            placeholder="Selecciona un tipo"
            [options]="typeOptions"
            [required]="true"
          />
        }

        @if (valueFieldVisible()) {
          <app-input
            formControlName="credential_value"
            label="Valor de la credencial"
            [placeholder]="valuePlaceholder()"
            [helperText]="valueHelper()"
            [required]="!credential()"
          />
        } @else {
          <p class="text-xs text-text-muted">
            El valor se generará automáticamente al crear (solo se muestra una
            vez, en este modal y por email al socio).
          </p>
        }

        <label class="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" formControlName="is_active" class="rounded" />
          Credencial activa
        </label>

        <p class="text-xs text-text-muted">
          No se almacenan huellas ni datos biométricos: la biometría vive en el
          dispositivo de acceso; aquí solo se guarda una referencia.
        </p>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="onClose()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="isSubmitting()"
          [disabled]="isSubmitting() || form.invalid"
          (clicked)="submit()"
          >{{ credential() ? 'Guardar' : 'Crear credencial' }}</app-button
        >
      </div>
    </app-modal>
  `,
})
export class MembershipCredentialFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly accessService = inject(MembershipAccessService);
  private readonly customersService = inject(CustomersService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model<boolean>(false);
  readonly credential = input<GymAccessCredential | null>(null);
  readonly saved = output<void>();

  readonly typeOptions: SelectorOption[] = [
    { value: 'qr', label: 'Código QR', icon: 'scan-line' },
    { value: 'pin', label: 'PIN', icon: 'hash' },
    {
      value: 'external_ref',
      label: 'Huella (lector biométrico)',
      icon: 'fingerprint',
      description: 'Solo referencia; la huella vive en el dispositivo',
    },
  ];

  /** Edit shows the masked value as a hint; create keeps the generic prompt. */
  readonly valuePlaceholder = computed(() => {
    const existing = this.credential();
    return existing
      ? existing.credential_value_masked || 'Valor actual oculto'
      : 'Ej. código QR, PIN o referencia del dispositivo';
  });

  readonly valueHelper = computed(() =>
    this.credential()
      ? 'Déjalo vacío para mantener el valor actual. Escribe uno nuevo solo si deseas cambiarlo.'
      : '',
  );

  readonly customerOptions = signal<SelectorOption[]>([]);
  readonly isLoadingCustomers = signal(false);
  readonly isSubmitting = signal(false);
  private customersLoaded = false;

  readonly form: FormGroup<CredentialFormShape> =
    this.fb.nonNullable.group<CredentialFormShape>({
      customer_id: this.fb.nonNullable.control<number | null>(null),
      credential_type: this.fb.nonNullable.control<GymCredentialType>('qr'),
      credential_value: this.fb.nonNullable.control('', {
        validators: [Validators.maxLength(255)],
      }),
      is_active: this.fb.nonNullable.control(true),
    });

  /**
   * Signal mirror of `form.controls.credential_type.value` so that the
   * `valueFieldVisible` computed and the validator-side-effect below can
   * react to type changes (Zoneless: plain `form.controls.X.value` reads are
   * NOT reactive inside `computed` / `effect`).
   */
  private readonly credentialTypeSignal = toSignal(
    this.form.controls.credential_type.valueChanges,
    {
      initialValue: this.form.controls.credential_type.value,
    },
  );

  /**
   * The raw `credential_value` input is only meaningful for `external_ref`
   * (operator-supplied device id) and for EDIT (sensitive value can be
   * re-supplied). For `qr` / `pin` in CREATE the backend auto-generates the
   * value one-shot, so the input is replaced by a hint.
   */
  readonly valueFieldVisible = computed(() => {
    const t = this.credentialTypeSignal();
    return t === 'external_ref' || !!this.credential();
  });

  constructor() {
    // Sync validators + prefill each time the modal opens.
    effect(() => {
      const isOpen = this.open();
      const existing = this.credential();

      if (!isOpen) return;

      if (existing) {
        // Edit: customer + type immutable; value is a sensitive field. The API
        // returns only a masked hint, so the input starts EMPTY — an empty
        // submit means "keep the current value" (see submit()).
        this.form.controls.customer_id.clearValidators();
        this.form.controls.customer_id.updateValueAndValidity({
          emitEvent: false,
        });
        this.form.controls.credential_value.setValidators([
          Validators.maxLength(255),
        ]);
        this.form.controls.credential_value.updateValueAndValidity({
          emitEvent: false,
        });
        this.form.patchValue(
          {
            customer_id: existing.customer_id,
            credential_type: existing.credential_type,
            credential_value: '',
            is_active: existing.is_active,
          },
          { emitEvent: false },
        );
      } else {
        // Create: customer required; value is auto-generated by the backend
        // for qr/pin, so it stays optional. We reset it to '' to avoid stale
        // text leaking in from a prior edit session.
        this.form.controls.customer_id.setValidators([Validators.required]);
        this.form.controls.customer_id.updateValueAndValidity({
          emitEvent: false,
        });
        this.applyCredentialValueValidators(this.credentialTypeSignal());
        this.form.patchValue(
          {
            customer_id: null,
            credential_type: 'qr',
            credential_value: '',
            is_active: true,
          },
          { emitEvent: false },
        );
        if (!this.customersLoaded) {
          this.customersLoaded = true;
          this.loadCustomers();
        }
      }
    });

    // Keep `credential_value` validators in sync with the selected type in
    // CREATE mode. For `qr` / `pin` the backend generates the value, so the
    // field must NOT be `required` (it can be left blank). For `external_ref`
    // the operator must supply the device id.
    effect(() => {
      // Skip during edit — the open/credential effect above already handled
      // that branch with the existing (non-required) validator set.
      if (this.credential()) return;
      this.applyCredentialValueValidators(this.credentialTypeSignal());
    });
  }

  /**
   * Re-apply validators for `credential_value` based on the current type and
   * wipe the input when the field is hidden, so a stale value from a previous
   * type is not submitted.
   */
  private applyCredentialValueValidators(type: GymCredentialType): void {
    const control = this.form.controls.credential_value;
    if (type === 'external_ref') {
      control.setValidators([
        Validators.required,
        Validators.maxLength(255),
      ]);
    } else {
      // qr / pin — backend auto-generates, so the field is optional and we
      // wipe any value the operator may have typed in a previous step.
      control.setValidators([Validators.maxLength(255)]);
      control.setValue('', { emitEvent: false });
    }
    control.updateValueAndValidity({ emitEvent: false });
  }

  private loadCustomers(): void {
    this.isLoadingCustomers.set(true);
    this.customersService
      .getCustomers(1, 500)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = response.data ?? [];
          this.customerOptions.set(
            rows.map((c: Customer) => ({
              value: c.id,
              label:
                `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email,
              description: c.email ?? undefined,
            })),
          );
          this.isLoadingCustomers.set(false);
        },
        error: () => {
          this.toastService.error('No se pudieron cargar los socios');
          this.isLoadingCustomers.set(false);
        },
      });
  }

  onClose(): void {
    this.open.set(false);
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.toastService.warning('Completa los campos requeridos');
      return;
    }

    const raw = this.form.getRawValue();
    const existing = this.credential();
    this.isSubmitting.set(true);

    if (existing) {
      // Sensitive field: only send a new value if the user actually typed one.
      // An empty input keeps the stored credential untouched.
      const newValue = raw.credential_value.trim();
      const dto: UpdateCredentialDto = {
        is_active: raw.is_active,
      };
      if (newValue) {
        dto.credential_value = newValue;
      }
      this.accessService
        .updateCredential(existing.id, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.onSuccess('Credencial actualizada'),
          error: (err: unknown) => this.onError(err),
        });
    } else {
      // Create: build the DTO conditionally. For `qr` / `pin` the backend
      // auto-generates the value, so we DO NOT send `credential_value` (the
      // DTO field is optional). For `external_ref` the operator must supply
      // the device id, so we forward the trimmed value.
      const dto: CreateCredentialDto = {
        customer_id: raw.customer_id as number,
        credential_type: raw.credential_type,
        is_active: raw.is_active,
      };
      if (raw.credential_type === 'external_ref') {
        const supplied = raw.credential_value.trim();
        if (supplied) {
          dto.credential_value = supplied;
        }
      }
      this.accessService
        .createCredential(dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created: CreateCredentialResponse) =>
            this.onCreateSuccess(created),
          error: (err: unknown) => this.onError(err),
        });
    }
  }

  private onCreateSuccess(created: CreateCredentialResponse): void {
    this.isSubmitting.set(false);

    const type = created.credential_type;
    const value = created.credential_value;
    const emailSent = created.email_sent;

    // Surface the one-shot value to the operator. The backend never returns
    // it again, so this toast is the only chance to read it back after submit.
    if (type === 'qr') {
      this.toastService.success(
        `QR creado: ${value} — enviado por email`,
        'Credencial creada',
      );
    } else if (type === 'pin') {
      this.toastService.success(
        `PIN creado: ${value} — enviado por email`,
        'Credencial creada',
      );
    } else {
      // external_ref (fingerprint reference) — the value is just an opaque
      // device id, not a secret; we still confirm + show email status.
      this.toastService.success(
        `Huella registrada: ${value} — aviso enviado`,
        'Credencial creada',
      );
    }

    if (!emailSent) {
      this.toastService.warning(
        'No se pudo enviar el email (el socio no tiene email configurado o falló el envío).',
        'Aviso',
      );
    }

    this.form.reset({ credential_type: 'qr', is_active: true });
    this.open.set(false);
    this.saved.emit();
  }

  private onSuccess(message: string): void {
    this.isSubmitting.set(false);
    this.toastService.success(message);
    this.form.reset({ credential_type: 'qr', is_active: true });
    this.open.set(false);
    this.saved.emit();
  }

  private onError(err: unknown): void {
    this.isSubmitting.set(false);
    this.toastService.error(
      typeof err === 'string' ? err : 'Error al guardar la credencial',
    );
  }
}
