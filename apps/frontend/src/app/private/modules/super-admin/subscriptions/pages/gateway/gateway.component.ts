import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import {
  GatewayEnvironment,
  PlatformGatewayView,
  TestGatewayDto,
  UpsertGatewayDto,
} from '../../interfaces/platform-gateway.interface';
import { GatewayAdminService } from '../../services/gateway-admin.service';

/**
 * Reactive form shape for the Wompi platform-gateway configuration.
 *
 * - secrets are typed as `string | null` because when the gateway is
 *   already configured we keep the field empty to mean "do not change".
 * - `confirm_production` is a cross-field validator target: required iff
 *   `environment === 'production'`.
 */
interface GatewayFormControls {
  public_key: FormControl<string | null>;
  private_key: FormControl<string | null>;
  events_secret: FormControl<string | null>;
  integrity_secret: FormControl<string | null>;
  environment: FormControl<GatewayEnvironment>;
  is_active: FormControl<boolean>;
  confirm_production: FormControl<boolean>;
}

/**
 * Cross-field validator: when `environment === 'production'`,
 * `confirm_production` must be `true`. Otherwise no constraint.
 */
const confirmProductionValidator: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const env = group.get('environment')?.value as GatewayEnvironment | null;
  const confirmed = group.get('confirm_production')?.value as boolean | null;
  if (env === 'production' && !confirmed) {
    return { confirm_production_required: true };
  }
  return null;
};

@Component({
  selector: 'app-gateway',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    StickyHeaderComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './gateway.component.html',
})
export class GatewayComponent {
  private fb = inject(FormBuilder);
  private gateway = inject(GatewayAdminService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // ── State signals ─────────────────────────────────────────────────
  readonly currentConfig = signal<PlatformGatewayView | null>(null);
  readonly loading = signal<boolean>(true);
  readonly saving = signal<boolean>(false);
  readonly testing = signal<boolean>(false);

  /**
   * `true` when the backend already has a valid (parseable) configuration.
   * In that case the secret inputs become optional — leaving them empty
   * means "do not change". Bound from `currentConfig().configured`.
   */
  readonly isConfigured = computed(
    () => this.currentConfig()?.configured === true,
  );

  /**
   * Status pill: green only if configured AND active (Wompi can be saved
   * but kept disabled for staging/migration). Red otherwise.
   */
  readonly statusActive = computed(() => {
    const cfg = this.currentConfig();
    return !!cfg && cfg.configured && cfg.is_active;
  });

  // ── Selector options ──────────────────────────────────────────────
  readonly environmentOptions = [
    { value: 'sandbox', label: 'Sandbox' },
    { value: 'production', label: 'Production' },
  ];

  // ── Form ──────────────────────────────────────────────────────────
  readonly form: FormGroup<GatewayFormControls> = this.fb.group<GatewayFormControls>(
    {
      public_key: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.pattern(/^pub_(test|prod)_/),
      ]),
      private_key: this.fb.control<string | null>(null, [
        Validators.required,
        Validators.pattern(/^prv_(test|prod)_/),
      ]),
      events_secret: this.fb.control<string | null>(null, [
        Validators.required,
      ]),
      integrity_secret: this.fb.control<string | null>(null, [
        Validators.required,
      ]),
      environment: this.fb.nonNullable.control<GatewayEnvironment>('sandbox', [
        Validators.required,
      ]),
      is_active: this.fb.nonNullable.control(false),
      confirm_production: this.fb.nonNullable.control(false),
    },
    { validators: confirmProductionValidator },
  );

  // ── Header actions ────────────────────────────────────────────────
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'test',
      label: 'Probar conexión',
      variant: 'outline',
      icon: 'zap',
      loading: this.testing(),
      disabled:
        this.testing() ||
        this.saving() ||
        // When NOT configured the user must fill the secrets first.
        // When configured we can re-test stored credentials.
        (!this.isConfigured() && !this.allSecretsFilled()),
    },
    {
      id: 'save',
      label: this.isConfigured() ? 'Actualizar pasarela' : 'Guardar pasarela',
      variant: 'primary',
      icon: 'save',
      loading: this.saving(),
      disabled: this.saving() || this.testing() || this.form.invalid,
    },
  ]);

  /**
   * `true` only when all 4 secret fields have a non-empty value. Used to
   * decide whether the "test" button can run on un-saved credentials.
   */
  allSecretsFilled(): boolean {
    const v = this.form.getRawValue();
    return !!(
      v.public_key &&
      v.private_key &&
      v.events_secret &&
      v.integrity_secret
    );
  }

  constructor() {
    this.loadConfig();

    // When environment changes back to sandbox, reset the production
    // confirmation flag so the form becomes valid again.
    this.form.controls.environment.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((env) => {
        if (env !== 'production') {
          this.form.controls.confirm_production.setValue(false, {
            emitEvent: false,
          });
        }
        this.form.updateValueAndValidity({ emitEvent: false });
      });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  loadConfig(): void {
    this.loading.set(true);
    this.gateway
      .getWompi()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => {
          this.currentConfig.set(view);
          this.applyConfigToForm(view);
          this.loading.set(false);
        },
        error: () => {
          this.toast.error(
            'No se pudo cargar la configuración de la pasarela',
            'Error',
          );
          this.loading.set(false);
        },
      });
  }

  /**
   * Adjusts validators based on whether the gateway is already configured:
   *  - When configured: secrets become OPTIONAL (empty = keep stored value).
   *  - When NOT configured: secrets are REQUIRED with format pattern.
   *
   * Also pre-fills `environment` and `is_active` from the stored config.
   */
  private applyConfigToForm(view: PlatformGatewayView): void {
    if (view.configured) {
      this.form.controls.public_key.clearValidators();
      this.form.controls.public_key.addValidators([
        Validators.pattern(/^pub_(test|prod)_/),
      ]);

      this.form.controls.private_key.clearValidators();
      this.form.controls.private_key.addValidators([
        Validators.pattern(/^prv_(test|prod)_/),
      ]);

      this.form.controls.events_secret.clearValidators();
      this.form.controls.integrity_secret.clearValidators();
    } else {
      this.form.controls.public_key.setValidators([
        Validators.required,
        Validators.pattern(/^pub_(test|prod)_/),
      ]);
      this.form.controls.private_key.setValidators([
        Validators.required,
        Validators.pattern(/^prv_(test|prod)_/),
      ]);
      this.form.controls.events_secret.setValidators([Validators.required]);
      this.form.controls.integrity_secret.setValidators([Validators.required]);
    }

    if (view.environment) {
      this.form.controls.environment.setValue(view.environment, {
        emitEvent: false,
      });
    }
    this.form.controls.is_active.setValue(view.is_active ?? false, {
      emitEvent: false,
    });

    // Reset confirm_production to false on every load — user must opt-in
    // each session if they want to activate production.
    this.form.controls.confirm_production.setValue(false, {
      emitEvent: false,
    });

    // Re-evaluate validity after swapping validators.
    Object.values(this.form.controls).forEach((c) =>
      c.updateValueAndValidity({ emitEvent: false }),
    );
    this.form.updateValueAndValidity({ emitEvent: false });
  }

  // ── Header callback ───────────────────────────────────────────────

  onHeaderAction(id: string): void {
    if (id === 'test') this.onTest();
    if (id === 'save') this.onSave();
  }

  // ── Test connection ───────────────────────────────────────────────

  onTest(): void {
    if (this.testing() || this.saving()) return;

    this.testing.set(true);
    const dto = this.buildTestDto();

    this.gateway
      .testWompi(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.testing.set(false);
          if (result.ok) {
            this.toast.success(
              result.merchant_id
                ? `Conexión OK · merchant ${result.merchant_id}`
                : 'Conexión OK',
              'Test exitoso',
            );
          } else {
            this.toast.error(
              result.message ?? 'No se pudo conectar con Wompi',
              'Test fallido',
            );
          }
          // Refresh `last_tested_at` / `last_test_result` from the server.
          this.loadConfig();
        },
        error: (err: { error?: { message?: string } }) => {
          this.testing.set(false);
          this.toast.error(
            err?.error?.message ?? 'Error al ejecutar el test',
            'Test fallido',
          );
        },
      });
  }

  /**
   * Builds the optional body for POST /test:
   *  - If the user filled fresh secrets, send them (probe un-saved creds).
   *  - Otherwise return undefined → backend tests stored credentials.
   */
  private buildTestDto(): TestGatewayDto | undefined {
    if (!this.allSecretsFilled()) return undefined;
    const v = this.form.getRawValue();
    return {
      public_key: v.public_key ?? undefined,
      private_key: v.private_key ?? undefined,
      events_secret: v.events_secret ?? undefined,
      integrity_secret: v.integrity_secret ?? undefined,
      environment: v.environment,
    };
  }

  // ── Save ──────────────────────────────────────────────────────────

  onSave(): void {
    if (this.saving() || this.testing()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.allSecretsFilled() && !this.isConfigured()) {
      this.toast.warning(
        'Debes completar las 4 credenciales antes de guardar',
        'Faltan datos',
      );
      return;
    }

    this.saving.set(true);
    const dto = this.buildSaveDto();

    this.gateway
      .saveWompi(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => {
          this.saving.set(false);
          this.currentConfig.set(view);
          this.applyConfigToForm(view);
          // Clear secret inputs after save — they are stored encrypted,
          // we'll never display them again, leaving them visible would
          // confuse the user.
          this.form.controls.public_key.setValue(null, { emitEvent: false });
          this.form.controls.private_key.setValue(null, { emitEvent: false });
          this.form.controls.events_secret.setValue(null, { emitEvent: false });
          this.form.controls.integrity_secret.setValue(null, {
            emitEvent: false,
          });
          this.toast.success(
            'Configuración de pasarela guardada',
            'Pasarela actualizada',
          );
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.toast.error(
            err?.error?.message ?? 'No se pudo guardar la configuración',
            'Error',
          );
        },
      });
  }

  /**
   * Builds the body for PATCH. Secrets that the operator did NOT type
   * are omitted from the payload entirely — the backend interprets a
   * missing field as "no rotation" and merges with the stored encrypted
   * plaintext. Only fresh, non-empty values travel over the wire.
   */
  private buildSaveDto(): UpsertGatewayDto {
    const v = this.form.getRawValue();
    const dto: UpsertGatewayDto = {
      environment: v.environment,
      is_active: v.is_active,
    };
    if (v.public_key) dto.public_key = v.public_key;
    if (v.private_key) dto.private_key = v.private_key;
    if (v.events_secret) dto.events_secret = v.events_secret;
    if (v.integrity_secret) dto.integrity_secret = v.integrity_secret;
    if (v.environment === 'production') {
      dto.confirm_production = v.confirm_production;
    }
    return dto;
  }

  // ── Template helpers (called from .html) ──────────────────────────

  /**
   * Placeholder text shown for a secret input when the gateway is already
   * configured. Falls back to a generic mask when the masked value is null.
   */
  maskedPlaceholder(
    field:
      | 'public_key'
      | 'private_key'
      | 'events_secret'
      | 'integrity_secret',
  ): string {
    const cfg = this.currentConfig();
    if (!cfg?.configured) return '';
    const masked = cfg.credentials_masked?.[field] ?? null;
    return masked
      ? `${masked} · dejar vacío para no cambiar`
      : 'Configurado · dejar vacío para no cambiar';
  }

  /** Localized environment label for the status pill. */
  environmentLabel(): string {
    const env = this.currentConfig()?.environment;
    if (env === 'production') return 'Production';
    if (env === 'sandbox') return 'Sandbox';
    return '—';
  }
}
