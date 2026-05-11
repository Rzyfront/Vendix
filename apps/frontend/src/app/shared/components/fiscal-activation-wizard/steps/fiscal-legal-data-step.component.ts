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
import { FiscalWizardStepHost } from '../wizard-step.contract';
import {
  LegalDataFormComponent,
  LegalDataValue,
} from '../../forms/legal-data-form/legal-data-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-legal-data-step',
  standalone: true,
  imports: [CommonModule, LegalDataFormComponent],
  template: `
    <div class="step-body">
      @if (readOnlyForStore()) {
        <p class="step-banner" role="status">
          La configuración fiscal de tu organización está centralizada. Pídele
          a un ORG_ADMIN que complete este paso.
        </p>
      }

      <app-legal-data-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting() || readOnlyForStore()"
        (validityChange)="onValidity($event)"
      ></app-legal-data-form>

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
      .step-banner {
        margin: 0;
        font-size: 0.85rem;
        color: var(--text-secondary, #475569);
        background: var(--surface-muted, #f8fafc);
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
      }
      .step-error {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-destructive, #b91c1c);
      }
    `,
  ],
})
export class FiscalLegalDataStepComponent implements FiscalWizardStepHost {
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);

  readonly stepId: FiscalWizardStepId = 'legal_data';
  readonly valid = signal(false);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<LegalDataValue> | null>(null);

  /**
   * True when the logged-in user is a STORE_ADMIN but the organization's
   * fiscal data lives at ORGANIZATION scope — in that case this step is
   * owned by an ORG_ADMIN and must be read-only here. Banner explains it.
   */
  readonly readOnlyForStore = computed(
    () =>
      this.service.userScope() === 'store' &&
      this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION',
  );

  private readonly form = viewChild.required<LegalDataFormComponent>('form');

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
    // userScope (logged-in user) routes the request, not org-level
    // fiscal_scope. See FiscalActivationWizardService.userScope.
    return `${environment.apiUrl}/${this.service.userScope()}/settings`;
  }

  private fiscalDataUrl(): string {
    // Canonical dedicated endpoint for `fiscal_data` (PATCH-merge, both scopes).
    return `${this.baseUrl()}/fiscal-data`;
  }

  private async loadInitial(): Promise<void> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.fiscalDataUrl()}${this.service.storeQuery()}`),
      );
      const payload = res?.data ?? res;
      const fiscalData =
        payload?.fiscal_data ?? payload?.settings?.fiscal_data ?? payload;
      if (fiscalData && typeof fiscalData === 'object') {
        this.initial.set(fiscalData as Partial<LegalDataValue>);
      }
    } catch {
      // Silent: empty form is fine
    }
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    if (this.readOnlyForStore()) {
      if (!this.valid()) {
        this.localError.set(
          'La configuración fiscal heredada todavía no tiene datos legales completos.',
        );
        return null;
      }
      const ref = {
        scope: 'ORGANIZATION',
        inherited: true,
        completed_at: new Date().toISOString(),
      };
      await this.service.commitStep(this.stepId, ref);
      return { ref };
    }

    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) return null;

    this.submitting.set(true);
    this.localError.set(null);
    try {
      const value = form.getValue();
      const scope = this.service.userScope();
      // Both scopes expose a dedicated PATCH endpoint for fiscal_data that
      // deep-merges over `settings.fiscal_data` without touching the rest of
      // the settings JSON. Payload is the flat form value — no `settings`
      // wrapper, no `fiscal_data` wrapper.
      await firstValueFrom(
        this.http.patch(this.fiscalDataUrl(), {
          ...value,
          ...this.service.storeContext(),
        }),
      );
      const ref = {
        scope: scope === 'organization' ? 'ORGANIZATION' : 'STORE',
        nit: value.nit,
        legal_name: value.legal_name,
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
