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
  readonly stepData = signal<Record<string, Record<string, unknown>>>({});
  readonly lastStatus = signal<FiscalStatusReadResult | null>(null);
  readonly targetStoreId = signal<number | null>(null);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly stepSequence = computed(() =>
    buildFiscalWizardSequence(this.selectedAreas()),
  );
  readonly currentStep = computed<FiscalWizardStepId | null>(
    () => this.stepSequence()[this.currentStepIndex()] ?? null,
  );
  readonly effectiveFiscalStatus = computed<FiscalStatusBlock | null>(() => {
    const last = this.lastStatus();
    const storeStatuses = last?.store_statuses || [];
    if (storeStatuses.length > 0) {
      const targetId = this.targetStoreId() ?? storeStatuses[0]?.store_id ?? null;
      return (
        storeStatuses.find((store) => store.store_id === targetId)
          ?.fiscal_status || null
      );
    }
    return this.authFacade.fiscalStatus();
  });
  readonly progressLabel = computed(
    () => `${Math.min(this.currentStepIndex() + 1, this.stepSequence().length)}/${this.stepSequence().length}`,
  );

  async loadStatus(): Promise<FiscalStatusReadResult> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.http.get(`${this.baseUrl()}`),
      );
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

  async startWizard(areas: FiscalArea[]): Promise<FiscalStatusReadResult> {
    const selected = Array.from(new Set(areas));
    this.selectedAreas.set(selected);
    this.currentStepIndex.set(1);
    this.stepData.set({});
    this.submitting.set(true);
    this.error.set(null);
    try {
      const area = selected[0] ?? 'invoicing';
      const result = await firstValueFrom(
        this.http.post(`${this.baseUrl()}/${area}/start-wizard`, {
          selected_areas: selected,
          ...this.storeContextBody(),
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

  async advanceStep(data: Record<string, unknown> = {}): Promise<void> {
    const step = this.currentStep();
    if (!step) return;

    this.submitting.set(true);
    this.error.set(null);
    try {
      const area = this.selectedAreas()[0] ?? 'invoicing';
      const result = await firstValueFrom(
        this.http.post(`${this.baseUrl()}/${area}/advance-step`, {
          step,
          data,
          ...this.storeContextBody(),
        }),
      );
      const response = this.unwrap<FiscalStatusReadResult>(result);
      this.lastStatus.set(response);
      this.authFacade.patchFiscalStatus(response.fiscal_status);
      this.stepData.update((current) => ({ ...current, [step]: data }));
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
          ...this.storeContextBody(),
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
        ...this.storeContextBody(),
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
    const query =
      this.authFacade.selectedAppType() === 'ORG_ADMIN' &&
      this.targetStoreId() !== null
        ? `?store_id=${this.targetStoreId()}`
        : '';
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

  private storeContextBody(): { store_id?: number } {
    return this.authFacade.selectedAppType() === 'ORG_ADMIN' &&
      this.targetStoreId() !== null
      ? { store_id: this.targetStoreId()! }
      : {};
  }

  private unwrap<T>(response: unknown): T {
    const payload = response as any;
    return (payload?.data ?? payload) as T;
  }

  private messageFromError(error: any): string {
    return (
      error?.error?.message ||
      error?.error?.error?.message ||
      error?.message ||
      'No fue posible actualizar el manejo fiscal.'
    );
  }
}
