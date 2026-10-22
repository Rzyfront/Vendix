import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { DianHabilitationScannerModalComponent } from '../../../../../../../shared/components/dian-habilitation-scanner/dian-habilitation-scanner-modal.component';
import type {
  DianHabilitationScanResult,
  HabilitationScanField,
} from '../../../../../../../shared/components/dian-habilitation-scanner/interfaces/habilitation-scan-result.interface';
import {
  DianConfigFormComponent,
  type DianConfigValue,
} from '../../../../../../../shared/components/forms/dian-config-form/dian-config-form.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { DianEnablementInheritancePanelComponent } from '../../../../../../../shared/components/dian/dian-enablement-inheritance-panel/dian-enablement-inheritance-panel.component';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import type { FiscalDataEnvelope, FiscalDataSettings } from '../../../../../fiscal-operations/interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from '../../../../../fiscal-operations/services/fiscal-operations.service';
import type { ActivationContext } from '../activation-wizard.model';

/** El backend nunca devuelve el PIN: lo enmascara con este valor. */
const MASKED_SECRET = '****';

/**
 * Paso 2 del asistente de activación: software de facturación registrado ante
 * la DIAN (Software ID, PIN y Test Set ID).
 *
 * La resolución de numeración de pruebas NO se captura aquí (va en el paso 4):
 * los campos `resolution_*` del formulario compartido se ignoran al guardar y
 * al aplicar el escáner.
 */
@Component({
  selector: 'vendix-activation-software-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    DianConfigFormComponent,
    DianHabilitationScannerModalComponent,
    DianEnablementInheritancePanelComponent,
  ],
  template: `
    <app-card>
      <div class="flex flex-col gap-4">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-[var(--color-text-primary)]">Software ante la DIAN</h2>
          <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Identificador del software, PIN y Test Set ID que la DIAN te entregó al inscribirlo en el
            portal de habilitación.
          </p>
        </div>

        @if (context().readOnly && context().readOnlyReason) {
          <app-alert-banner variant="info" icon="info">{{ context().readOnlyReason }}</app-alert-banner>
        }

        @if (!context().readOnly) {
          <section
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3"
          >
            <div class="min-w-0 flex-1 basis-60">
              <p class="text-sm font-medium text-[var(--color-text-primary)]">
                ¿Tienes a la mano el set de pruebas de la DIAN?
              </p>
              <p class="text-xs text-[var(--color-text-secondary)]">
                Sube una foto y la IA llena Software ID, PIN y Test Set ID. Podrás revisar cada campo antes
                de aplicarlo.
              </p>
            </div>
            <app-button variant="outline" size="sm" [disabled]="saving()" (clicked)="scannerOpen.set(true)">
              <span class="inline-flex items-center gap-2">
                <app-icon name="sparkles" [size]="14"></app-icon>
                Escanear con IA
              </span>
            </app-button>
          </section>
          <app-dian-habilitation-scanner-modal
            [isOpen]="scannerOpen()"
            [scope]="context().scope"
            (isOpenChange)="scannerOpen.set($event)"
            (confirmed)="onScanConfirmed($event)"
          ></app-dian-habilitation-scanner-modal>
        }

        @if (pinStored()) {
          <p class="text-xs text-[var(--color-text-secondary)] inline-flex items-center gap-1.5">
            <app-icon name="check-circle" [size]="14" class="text-[var(--color-success)]"></app-icon>
            PIN guardado. Déjalo como está para conservarlo o escribe uno nuevo para reemplazarlo.
          </p>
        }

        <app-dian-config-form
          #form
          [initialValue]="initial()"
          [disabled]="saving() || context().readOnly"
          [hideCertificate]="true"
          [requireDianCredentials]="true"
          (validityChange)="valid.set($event)"
        ></app-dian-config-form>

        @if (context().config?.id; as configId) {
          @if (!context().readOnly) {
            <app-dian-enablement-inheritance-panel
              [configId]="configId"
              [disabled]="saving()"
              (inherited)="changed.emit()"
            ></app-dian-enablement-inheritance-panel>
          }
        }

        @if (error(); as message) {
          <app-alert-banner variant="danger" icon="alert-triangle">{{ message }}</app-alert-banner>
        }

        @if (!context().readOnly) {
          <div class="flex justify-end">
            <app-button variant="primary" [loading]="saving()" [disabled]="saving()" (clicked)="save()">
              Guardar y continuar
            </app-button>
          </div>
        }
      </div>
    </app-card>
  `,
})
export class ActivationSoftwareStepComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly fiscalOps = inject(FiscalOperationsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = input.required<ActivationContext>();
  readonly changed = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly valid = signal(false);
  readonly scannerOpen = signal(false);
  /** Identidad fiscal del paso 1, para sembrar el alta cuando aún no hay configuración. */
  private readonly fiscalData = signal<FiscalDataSettings | null>(null);

  private readonly form = viewChild.required<DianConfigFormComponent>('form');

  readonly pinStored = computed(() => Boolean(this.context().config?.software_pin_encrypted));

  readonly initial = computed<Partial<DianConfigValue> | null>(() => {
    const config = this.context().config;
    if (config) {
      return {
        name: config.name ?? '',
        nit: config.nit ?? '',
        nit_dv: config.nit_dv ?? '',
        nit_type: config.nit_type ?? 'NIT',
        environment: config.environment ?? 'test',
        software_id: config.software_id ?? '',
        software_pin: config.software_pin_encrypted ? MASKED_SECRET : '',
        test_set_id: config.test_set_id ?? '',
      };
    }
    const fiscal = this.fiscalData();
    if (!fiscal) return null;
    return {
      name: fiscal.legal_name ?? '',
      nit: fiscal.nit ?? '',
      nit_dv: fiscal.nit_dv ?? '',
      nit_type: 'NIT',
      environment: 'test',
      software_id: '',
      software_pin: '',
      test_set_id: '',
    };
  });

  constructor() {
    // Sin configuración todavía: hereda NIT, DV y razón social del paso 1.
    effect(() => {
      const hasConfig = this.context().config !== null;
      const scope = this.context().scope;
      if (hasConfig || untracked(() => this.fiscalData() !== null)) return;
      this.fiscalOps
        .getFiscalDataSettings(scope)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (envelope) => this.fiscalData.set(this.unwrap(envelope)),
          // Best-effort: el formulario queda vacío y editable.
          error: () => undefined,
        });
    });
  }

  /** Aplica lo leído por la IA, salvo la resolución (va en el paso 4). */
  onScanConfirmed(scan: DianHabilitationScanResult): void {
    const patch: Partial<DianConfigValue> = {};
    const take = <K extends keyof DianConfigValue>(key: K, field: HabilitationScanField<DianConfigValue[K] & {}>): void => {
      if (field.value !== null && field.value !== undefined) patch[key] = field.value;
    };
    take('name', scan.name);
    take('nit', scan.nit);
    take('nit_dv', scan.nit_dv);
    take('software_id', scan.software_id);
    take('software_pin', scan.software_pin);
    take('test_set_id', scan.test_set_id);
    if (patch.nit) patch.nit_type = 'NIT';

    this.form().applyScan(patch);
    this.error.set(null);
  }

  save(): void {
    if (this.context().readOnly) return;
    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) {
      const problems = form.describeInvalidFields();
      this.error.set(
        problems.length
          ? `No se puede guardar. Revisa: ${problems.join(', ')}.`
          : 'Revisa los datos: hay campos obligatorios incompletos.',
      );
      return;
    }

    const value = form.getValue();
    const config = this.context().config;
    const pinTouched = Boolean(value.software_pin) && value.software_pin !== MASKED_SECRET;
    const missing: string[] = [];
    if (!value.software_id?.trim()) missing.push('Software ID');
    if (!pinTouched && !config?.software_pin_encrypted) missing.push('PIN del software');
    if (!value.test_set_id?.trim()) missing.push('Test Set ID');
    if (missing.length) {
      this.error.set(`Para continuar necesitas: ${missing.join(', ')}.`);
      return;
    }

    const body: Record<string, unknown> = {
      name: value.name,
      nit: value.nit,
      nit_dv: value.nit_dv,
      nit_type: value.nit_type || 'NIT',
      software_id: value.software_id,
      test_set_id: value.test_set_id,
      ...(pinTouched ? { software_pin: value.software_pin } : {}),
    };

    this.saving.set(true);
    this.error.set(null);
    const request$ = config
      ? this.api.updateDianConfig(config.id, body)
      : this.api.createDianConfig({
          ...body,
          configuration_type: 'invoicing',
          is_default: true,
          environment: 'test',
        });

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Software guardado');
        this.changed.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(parseApiError(err).userMessage);
      },
    });
  }

  private unwrap(envelope: FiscalDataEnvelope): FiscalDataSettings | null {
    if (envelope && 'fiscal_data' in envelope) return envelope.fiscal_data ?? null;
    const wrapped = envelope as { data?: { fiscal_data?: FiscalDataSettings | null } } | null;
    return wrapped?.data?.fiscal_data ?? null;
  }
}
