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
  fiscalAreaHasPendingSignal,
} from '../models/fiscal-status.model';
import { WizardPrefill } from '../models/wizard-prefill.model';
import { parseApiError } from '../utils/parse-api-error';

/**
 * Server-side confirmation, per area, of which wizard steps the backend
 * considers still missing when `finalize()` rejects with
 * `FISCAL_STATUS_INCOMPLETE`. Mirrors `details.missing_steps`
 * (`Record<FiscalArea, FiscalWizardStepId[]>`).
 */
export type FinalizeMissingSteps = Partial<
  Record<FiscalArea, FiscalWizardStepId[]>
>;

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
   * Aggregated read-only snapshot of every existing tenant source the wizard
   * would otherwise ask the user to re-enter. Populated by {@link loadPrefill}
   * (single GET to `/wizard-prefill`) and consumed by step components to seed
   * their initial form values without re-hitting the canonical endpoints.
   *
   * `null` until the first call — components must guard reads with
   * `?.<field>`. Step components no longer fire their own N+1 GETs; they
   * subscribe to this signal and to {@link effectiveSatisfiedSteps} instead.
   */
  readonly prefill = signal<WizardPrefill | null>(null);
  readonly prefillLoading = signal(false);

  /**
   * Populated only when the last `finalize()` failed with
   * `FISCAL_STATUS_INCOMPLETE`. Lets the validation step highlight the exact
   * rows the backend still rejects (server-side confirmation, layered on top
   * of the prefill/satisfied-driven rows). Reset to `{}` on every finalize
   * attempt so stale highlights never linger.
   */
  readonly finalizeMissingSteps = signal<FinalizeMissingSteps>({});

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

  /**
   * Union of three sources of "this step is already covered":
   *
   * 1. `prefill.satisfied_steps` — backend preflight detected existing data
   *    (legal_data row, dian_config, puc accounts, fiscal_period, taxes,
   *    mappings, initial inventory transactions, payroll config flag).
   * 2. `completedSteps()` — steps the user already marked completed inside an
   *    in-progress wizard (fiscal_status wizard.completed_steps).
   * 3. `fiscalAreaHasPendingSignal()` — detector signals for the current area
   *    set, so a step that the detector already validates is treated as
   *    satisfied even before the user touches it.
   *
   * Consumed by `restoreWizardFromCurrentStatus()` to position the cursor on
   * the first unsatisfied step instead of always starting at the beginning.
   */
  readonly effectiveSatisfiedSteps = computed<FiscalWizardStepId[]>(() => {
    const acc = new Set<FiscalWizardStepId>();
    this.prefill()?.satisfied_steps?.forEach((step) => acc.add(step));
    this.completedSteps().forEach((step) => acc.add(step));

    const status = this.effectiveFiscalStatus();
    if (status) {
      const areas =
        this.selectedAreas().length > 0
          ? this.selectedAreas()
          : (Object.keys(status) as FiscalArea[]);
      for (const area of areas) {
        if (fiscalAreaHasPendingSignal(area, status[area])) {
          // Area-pending signals are coarse ("the org hits the threshold");
          // treat the lightweight legal/identity anchors as satisfied so the
          // wizard doesn't ask the user to retype what the detector already
          // validated.
          acc.add('legal_data');
          if (area !== 'payroll') {
            acc.add('dian_config');
            acc.add('default_taxes');
          }
        }
      }
    }
    return Array.from(acc);
  });

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

  /**
   * Single GET to `wizard-prefill` replaces the previous N+1 pattern (one
   * per step component). Idempotent: if a prefill is already loaded for the
   * current `targetStoreId` the cached value is returned without an HTTP
   * roundtrip, so multiple consumers (step components reacting to the same
   * effect) never duplicate the call.
   */
  async loadPrefill(force = false): Promise<WizardPrefill> {
    const current = this.prefill();
    if (current && !force) {
      // Already loaded for the current store context — short-circuit.
      return current;
    }
    this.prefillLoading.set(true);
    try {
      const query = this.storeQuery();
      const result = await firstValueFrom(
        this.http.get(`${this.baseUrl()}/wizard-prefill${query}`),
      );
      const data = this.unwrap<WizardPrefill>(result);
      this.prefill.set(data);
      return data;
    } catch (error: any) {
      this.error.set(this.messageFromError(error));
      // Surface the error but keep the wizard usable (empty prefill is
      // non-fatal — steps just fall back to their default empty forms).
      throw error;
    } finally {
      this.prefillLoading.set(false);
    }
  }

  /**
   * Reposition the wizard cursor on the first step of the current
   * `stepSequence()` that is NOT covered by `effectiveSatisfiedSteps()`.
   *
   * Falls back to the WIP wizard's `current_step` if no prefill is
   * available yet, so legacy callers (e.g. fiscal-management-panel
   * store switcher) keep working without a prefill call.
   */
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

    const sequence = this.stepSequence();
    if (sequence.length === 0) return;

    const satisfied = new Set(this.effectiveSatisfiedSteps());
    const firstUnsatisfied = sequence.find((step) => !satisfied.has(step));

    if (firstUnsatisfied) {
      const targetIndex = sequence.indexOf(firstUnsatisfied);
      this.currentStepIndex.set(
        targetIndex >= 0
          ? targetIndex
          : sequence.length - 1,
      );
      return;
    }

    // Every step is already satisfied: park the cursor on the last step so
    // the user lands on the "Finalizar activación" CTA instead of a
    // confusing blank form. If we don't have a prefill yet (legacy flow),
    // fall back to the wizard's recorded current_step.
    const prefill = this.prefill();
    if (!prefill) {
      const currentStep = wizard.current_step || wizard.step_sequence[0];
      const index = sequence.indexOf(currentStep);
      this.currentStepIndex.set(index >= 0 ? index : 0);
      return;
    }
    this.currentStepIndex.set(sequence.length - 1);
  }

  /**
   * Public cursor setter used by the validation step's "Volver a {paso}" CTA.
   * Resolves the step's position inside the current `stepSequence()` and only
   * moves the cursor when the step actually belongs to the sequence, so an
   * out-of-scope step id is a safe no-op.
   */
  goToStep(step: FiscalWizardStepId): void {
    const index = this.stepSequence().indexOf(step);
    if (index >= 0) {
      this.currentStepIndex.set(index);
    }
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
    this.finalizeMissingSteps.set({});
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
      // FISCAL_STATUS_INCOMPLETE carries `details.missing_steps` — capture it
      // so the validation step can surface server-side confirmation of the
      // exact pending steps, then set a clear, non-generic banner message.
      const parsed = parseApiError(error);
      if (parsed.errorCode === 'FISCAL_STATUS_INCOMPLETE') {
        const missing = parsed.details?.missing_steps;
        this.finalizeMissingSteps.set(
          missing && typeof missing === 'object'
            ? (missing as FinalizeMissingSteps)
            : {},
        );
        this.error.set(
          'No se puede activar: faltan pasos por completar.',
        );
      } else {
        this.error.set(this.messageFromError(error));
      }
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
