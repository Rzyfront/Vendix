import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthFacade } from '../store/auth/auth.facade';
import {
  buildFiscalWizardSequence,
  FiscalArea,
  FiscalStatusBlock,
  FiscalStatusReadResult,
  FiscalWizardStepId,
} from '../models/fiscal-status.model';

@Injectable({
  providedIn: 'root',
})
export class FiscalActivationWizardService {
  private readonly http = inject(HttpClient);
  private readonly authFacade = inject(AuthFacade);

  readonly selectedAreas = signal<FiscalArea[]>([]);
  readonly currentStepIndex = signal(0);
  readonly lastStatus = signal<FiscalStatusReadResult | null>(null);
  readonly targetStoreId = signal<number | null>(null);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Scope of the **logged-in user**, used to decide which API surface to hit
   * (`/store/*` vs `/organization/*`). This is intentionally distinct from
   * `lastStatus()?.fiscal_scope`, which describes where the *organization*
   * keeps its fiscal data (STORE vs ORGANIZATION) — that value must NOT be
   * used to route HTTP calls, otherwise a STORE_ADMIN can end up hitting
   * `/organization/*` and being rejected by the DomainScopeGuard with 403.
   *
   * Lowercase to plug directly into URL segments.
   */
  readonly userScope = computed<'store' | 'organization'>(() =>
    this.authFacade.selectedAppType() === 'ORG_ADMIN' ? 'organization' : 'store',
  );

  readonly stepSequence = computed(() =>
    buildFiscalWizardSequence(this.selectedAreas()),
  );
  readonly currentStep = computed<FiscalWizardStepId | null>(
    () => this.stepSequence()[this.currentStepIndex()] ?? null,
  );
  readonly fiscalDataOwner = computed<'organization' | 'store'>(() =>
    this.lastStatus()?.fiscal_scope === 'ORGANIZATION'
      ? 'organization'
      : 'store',
  );
  readonly isInheritedOrganizationConfig = computed(
    () => this.userScope() === 'store' && this.fiscalDataOwner() === 'organization',
  );
  readonly requiresTargetStore = computed(
    () => this.userScope() === 'organization' && this.fiscalDataOwner() === 'store',
  );
  readonly effectiveFiscalStatus = computed<FiscalStatusBlock | null>(() => {
    const last = this.lastStatus();
    const storeStatuses = last?.store_statuses || [];
    if (storeStatuses.length > 0) {
      const targetId =
        this.targetStoreId() ?? storeStatuses[0]?.store_id ?? null;
      return (
        storeStatuses.find((store) => store.store_id === targetId)
          ?.fiscal_status || null
      );
    }
    return this.authFacade.fiscalStatus();
  });
  readonly activeWizard = computed(() => {
    const status = this.effectiveFiscalStatus();
    if (!status) return null;

    const selected = this.selectedAreas();
    const activeArea =
      selected.find((area) => status[area]?.state === 'WIP') ??
      selected[0] ??
      (Object.keys(status) as FiscalArea[]).find(
        (area) => status[area]?.state === 'WIP',
      ) ??
      null;

    return activeArea ? (status[activeArea]?.wizard ?? null) : null;
  });
  readonly completedSteps = computed(
    () => this.activeWizard()?.completed_steps ?? [],
  );
  readonly stepRefs = computed<Record<string, unknown>>(
    () => this.activeWizard()?.step_refs ?? {},
  );
  readonly fiscalContextKey = computed(
    () =>
      `${this.userScope()}:${this.lastStatus()?.fiscal_scope ?? 'STORE'}:${this.targetStoreId() ?? 'none'}`,
  );
  readonly progressLabel = computed(
    () =>
      `${Math.min(this.currentStepIndex() + 1, this.stepSequence().length)}/${this.stepSequence().length}`,
  );

  async loadStatus(): Promise<FiscalStatusReadResult> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(this.http.get(`${this.baseUrl()}`));
      const data = this.unwrap<FiscalStatusReadResult>(result);
      this.lastStatus.set(data);
      if (data.store_statuses?.length && this.targetStoreId() === null) {
        this.targetStoreId.set(data.store_statuses[0].store_id);
      }
      this.authFacade.patchFiscalStatus(data.fiscal_status);
      return data;
    } catch (error: any) {
      this.error.set(this.messageFromError(error));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  restoreWizardFromCurrentStatus(): void {
    const status = this.effectiveFiscalStatus();
    if (!status) return;

    const wipArea = (Object.keys(status) as FiscalArea[]).find(
      (area) => status[area]?.state === 'WIP',
    );
    if (!wipArea) return;

    const wizard = status[wipArea].wizard;
    this.selectedAreas.set(
      wizard.selected_areas?.length ? wizard.selected_areas : [wipArea],
    );
    const currentStep = wizard.current_step || wizard.step_sequence[0];
    const index = this.stepSequence().indexOf(currentStep);
    this.currentStepIndex.set(index >= 0 ? index : 0);
  }

  async startWizard(areas: FiscalArea[]): Promise<FiscalStatusReadResult> {
    const selected = Array.from(new Set(areas));
    this.selectedAreas.set(selected);
    this.currentStepIndex.set(1);
    this.submitting.set(true);
    this.error.set(null);
    try {
      const area = selected[0] ?? 'invoicing';
      const result = await firstValueFrom(
        this.http.post(`${this.baseUrl()}/${area}/start-wizard`, {
          selected_areas: selected,
          ...this.storeContext(),
        }),
      );
      const data = this.unwrap<FiscalStatusReadResult>(result);
      this.lastStatus.set(data);
      this.authFacade.patchFiscalStatus(data.fiscal_status);
      return data;
    } catch (error: any) {
      this.error.set(this.messageFromError(error));
      throw error;
    } finally {
      this.submitting.set(false);
    }
  }

  async commitStep(
    step: FiscalWizardStepId,
    ref: Record<string, unknown> = {},
  ): Promise<void> {
    this.submitting.set(true);
    this.error.set(null);
    try {
      const area = this.selectedAreas()[0] ?? 'invoicing';
      const result = await firstValueFrom(
        this.http.post(`${this.baseUrl()}/${area}/mark-step-completed`, {
          step,
          ref,
          ...this.storeContext(),
        }),
      );
      const response = this.unwrap<FiscalStatusReadResult>(result);
      this.lastStatus.set(response);
      this.authFacade.patchFiscalStatus(response.fiscal_status);
      this.currentStepIndex.update((index) =>
        Math.min(index + 1, this.stepSequence().length - 1),
      );
    } catch (error: any) {
      this.error.set(this.messageFromError(error));
      throw error;
    } finally {
      this.submitting.set(false);
    }
  }

  async finalize(): Promise<FiscalStatusReadResult> {
    this.submitting.set(true);
    this.error.set(null);
    try {
      const area = this.selectedAreas()[0] ?? 'invoicing';
      const result = await firstValueFrom(
        this.http.post(`${this.baseUrl()}/${area}/finalize`, {
          selected_areas: this.selectedAreas(),
          ...this.storeContext(),
        }),
      );
      const data = this.unwrap<FiscalStatusReadResult>(result);
      this.lastStatus.set(data);
      this.authFacade.patchFiscalStatus(data.fiscal_status);
      return data;
    } catch (error: any) {
      this.error.set(this.messageFromError(error));
      throw error;
    } finally {
      this.submitting.set(false);
    }
  }

  async deactivate(area: FiscalArea): Promise<FiscalStatusReadResult> {
    const result = await firstValueFrom(
      this.http.post(`${this.baseUrl()}/${area}/deactivate`, {
        ...this.storeContext(),
      }),
    );
    const data = this.unwrap<FiscalStatusReadResult>(result);
    this.lastStatus.set(data);
    this.authFacade.patchFiscalStatus(data.fiscal_status);
    return data;
  }

  async checkIrreversibility(area: FiscalArea): Promise<{
    locked: boolean;
    reasons: string[];
  }> {
    const query = this.storeQuery();
    const result = await firstValueFrom(
      this.http.get(`${this.baseUrl()}/${area}/irreversibility-check${query}`),
    );
    return this.unwrap(result);
  }

  private baseUrl(): string {
    const scope =
      this.authFacade.selectedAppType() === 'ORG_ADMIN'
        ? 'organization'
        : 'store';
    return `${environment.apiUrl}/${scope}/settings/fiscal-status`;
  }

  /**
   * Returns `{ store_id }` when the logged-in user is ORG_ADMIN and a target
   * store has been selected. Generic name (no "Body" suffix) because step
   * components also spread this into POST/PATCH bodies for canonical
   * endpoints (e.g. dian-config, account-mappings) where the backend
   * requires `store_id` to resolve a concrete row on tables anchored to a
   * store.
   */
  storeContext(): { store_id?: number } {
    return this.requiresTargetStore() && this.targetStoreId() !== null
      ? { store_id: this.targetStoreId()! }
      : {};
  }

  storeQuery(prefix: '?' | '&' = '?'): string {
    const context = this.storeContext();
    return context.store_id ? `${prefix}store_id=${context.store_id}` : '';
  }

  private unwrap<T>(response: unknown): T {
    const payload = response as any;
    return (payload?.data ?? payload) as T;
  }

  private messageFromError(error: any): string {
    const fallback = 'No fue posible actualizar el manejo fiscal.';
    const candidates = [
      error?.error?.error?.message,
      error?.error?.message,
      error?.message,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate;
      }
      if (
        candidate &&
        typeof candidate === 'object' &&
        typeof (candidate as any).message === 'string'
      ) {
        return (candidate as any).message;
      }
    }
    return fallback;
  }
}
