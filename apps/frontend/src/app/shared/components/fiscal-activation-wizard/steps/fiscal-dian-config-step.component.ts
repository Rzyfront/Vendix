import {
  Component,
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
        [disabled]="submitting()"
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

  private readonly form = viewChild.required<DianConfigFormComponent>('form');
  private loaded = false;

  constructor() {
    effect(() => {
      const scope = this.service.userScope();
      if (scope && !this.loaded) {
        this.loaded = true;
        void this.loadInitial();
      }
    });
  }

  private baseUrl(): string {
    // userScope (logged-in user) routes the request, not org-level fiscal_scope.
    // TODO: surface read-only banner if STORE_ADMIN hits an org-owned config.
    return `${environment.apiUrl}/${this.service.userScope()}/invoicing/dian-config`;
  }

  private async loadInitial(): Promise<void> {
    try {
      // For ORG_ADMIN + fiscal_scope=STORE, narrow the GET to the selected
      // store. For fiscal_scope=ORGANIZATION the DIAN config is org-wide
      // (store_id IS NULL on the row), so we omit ?store_id and let the
      // backend return the org-scoped record.
      const fiscalScope = this.service.lastStatus()?.fiscal_scope;
      const query =
        this.service.userScope() === 'organization' &&
        fiscalScope === 'STORE' &&
        this.service.targetStoreId() !== null
          ? `?store_id=${this.service.targetStoreId()}`
          : '';
      const res: any = await firstValueFrom(
        this.http.get(`${this.baseUrl()}${query}`),
      );
      const payload = res?.data ?? res;
      const arr = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : null;
      const current = arr?.find((c: any) => c?.is_default) ?? arr?.[0] ?? null;
      if (current && typeof current === 'object') {
        this.existingConfigId.set(
          typeof current.id === 'number' ? current.id : null,
        );
        this.initial.set({
          name: current.name ?? '',
          nit: current.nit ?? '',
          nit_dv: current.nit_dv ?? '',
          nit_type: current.nit_type ?? 'NIT',
          environment: current.environment ?? 'test',
          software_id: current.software_id ?? '',
          software_pin: current.software_pin ?? '',
          test_set_id: current.test_set_id ?? '',
        } as Partial<DianConfigValue>);
      }
    } catch {
      // Silent: empty form is fine
    }
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
    const fiscalScope = this.service.lastStatus()?.fiscal_scope;
    // ORG_ADMIN + fiscal_scope=STORE writes need a target store. The org
    // service rejects with "store_id is required when fiscal_scope=STORE".
    // For fiscal_scope=ORGANIZATION the row is anchored to the organization
    // only (store_id IS NULL), so no store selection is required.
    if (
      this.service.userScope() === 'organization' &&
      fiscalScope === 'STORE' &&
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
        ...(this.service.userScope() === 'organization' &&
        fiscalScope === 'STORE'
          ? this.service.storeContext()
          : {}),
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
