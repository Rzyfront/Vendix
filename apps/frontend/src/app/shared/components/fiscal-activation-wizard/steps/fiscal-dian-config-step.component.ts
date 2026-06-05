import {
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { FiscalActivationWizardService } from '../../../../core/services/fiscal-activation-wizard.service';
import { FiscalWizardStepId } from '../../../../core/models/fiscal-status.model';
import {
  WizardPrefillDianConfig,
} from '../../../../core/models/wizard-prefill.model';
import { FiscalWizardStepHost } from '../wizard-step.contract';
import {
  DianConfigFormComponent,
  DianConfigValue,
} from '../../forms/dian-config-form/dian-config-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-dian-config-step',
  standalone: true,
  imports: [CommonModule, DianConfigFormComponent],
  template: `
    <div class="step-body">
      <app-dian-config-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        (validityChange)="onValidity($event)"
      ></app-dian-config-form>

      @if (localError()) {
        <p class="step-error" role="alert">{{ localError() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .step-body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive, #b91c1c);
      }
    `,
  ],
})
export class FiscalDianConfigStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);

  readonly stepId: FiscalWizardStepId = 'dian_config';
  readonly valid = signal(false);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<DianConfigValue> | null>(null);
  readonly existingConfigId = signal<number | null>(null);
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form = viewChild.required<DianConfigFormComponent>('form');
  private loadedContextKey: string | null = null;

  constructor() {
    effect(() => {
      const key = this.service.fiscalContextKey();
      if (key && key !== this.loadedContextKey) {
        this.loadedContextKey = key;
        void this.loadInitial();
      }
    });
  }

  private baseUrl(): string {
    // userScope routes the request; backend resolves fiscal ownership.
    return `${environment.apiUrl}/${this.service.userScope()}/invoicing/dian-config`;
  }

  private async loadInitial(): Promise<void> {
    // Replaces the previous N+1 GET against `/invoicing/dian-config`. The
    // prefill snapshot already contains the active dian_config row, which
    // is what we need to seed the form. The canonical PATCH/POST endpoints
    // in submit() are still the write path.
    const dian = this.service.prefill()?.dian_config;
    if (!dian) {
      // No prefill yet or backend reported no DIAN config — empty form.
      return;
    }
    this.existingConfigId.set(dian.id);
    this.initial.set(this.toDianFormValue(dian));
  }

  private toDianFormValue(
    dian: WizardPrefillDianConfig,
  ): Partial<DianConfigValue> {
    return {
      name: dian.name ?? '',
      nit: dian.nit ?? '',
      nit_dv: dian.nit_dv ?? '',
      nit_type: dian.nit_type ?? 'NIT',
      environment: dian.environment ?? 'test',
      // software_id / software_pin / test_set_id are intentionally left
      // blank — they're not part of the dian_configurations row and must be
      // re-entered / re-fetched from a deeper endpoint if needed (the
      // certificate is uploaded separately via /upload-certificate).
      software_id: '',
      software_pin: '',
      test_set_id: '',
    } as Partial<DianConfigValue>;
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) return null;

    this.submitting.set(true);
    this.localError.set(null);
    if (this.readOnlyForStore()) {
      const ref = {
        dian_config_id: this.existingConfigId(),
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      this.submitting.set(false);
      return { ref };
    }
    // ORG_ADMIN + fiscal_scope=STORE writes need a target store. The org
    // service rejects with "store_id is required when fiscal_scope=STORE".
    // For fiscal_scope=ORGANIZATION the row is anchored to the organization
    // only (store_id IS NULL), so no store selection is required.
    if (
      this.service.userScope() === 'organization' &&
      this.service.fiscalDataOwner() === 'store' &&
      this.service.targetStoreId() === null
    ) {
      this.localError.set(
        'Selecciona una tienda en el panel de manejo fiscal antes de continuar.',
      );
      this.submitting.set(false);
      return null;
    }
    try {
      const value = form.getValue();

      // Body matches CreateDianConfigDto. For ORG_ADMIN + fiscal_scope=STORE
      // spread the selected store_id so the backend pins the row to the
      // chosen store. For fiscal_scope=ORGANIZATION do NOT send store_id —
      // the row must be org-scoped (store_id IS NULL).
      const body = {
        name: value.name,
        nit: value.nit,
        nit_dv: value.nit_dv,
        nit_type: value.nit_type || 'NIT',
        software_id: value.software_id,
        software_pin: value.software_pin,
        environment: value.environment,
        test_set_id: value.test_set_id || undefined,
        is_default: true,
        ...this.service.storeContext(),
      };

      let configId: number | null = this.existingConfigId();
      if (configId) {
        const res: any = await firstValueFrom(
          this.http.patch(`${this.baseUrl()}/${configId}`, body),
        );
        const payload = res?.data ?? res;
        configId =
          typeof payload?.id === 'number' ? payload.id : (configId ?? null);
      } else {
        const res: any = await firstValueFrom(
          this.http.post(this.baseUrl(), body),
        );
        const payload = res?.data ?? res;
        configId = typeof payload?.id === 'number' ? payload.id : null;
      }

      // Upload certificate if provided. FormData payload — no body merge.
      if (value.certificate_file && configId && value.certificate_password) {
        const fd = new FormData();
        fd.append('certificate', value.certificate_file);
        fd.append('password', value.certificate_password);
        fd.append('config_id', String(configId));
        await firstValueFrom(
          this.http.post(`${this.baseUrl()}/upload-certificate`, fd),
        );
      }

      const ref = {
        dian_config_id: configId,
        environment: value.environment,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      return { ref };
    } catch (e) {
      this.localError.set(parseApiError(e).userMessage);
      return null;
    } finally {
      this.submitting.set(false);
    }
  }
}
