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
      // GET /{scope}/settings still returns the full settings object; read
      // `fiscal_data` from there (supports both `settings.fiscal_data` for the
      // org wrapper response and flat `fiscal_data` for the store response).
      const res: any = await firstValueFrom(this.http.get(this.baseUrl()));
      const payload = res?.data ?? res;
      const fiscalData = payload?.settings?.fiscal_data ?? payload?.fiscal_data;
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
      this.localError.set(
        'Este paso debe completarlo un ORG_ADMIN. La configuración fiscal está centralizada en la organización.',
      );
      return null;
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
        this.http.patch(this.fiscalDataUrl(), value),
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
