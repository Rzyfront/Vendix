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
  CostingMethod,
  InitialInventoryFormComponent,
  InitialInventoryValue,
} from '../../forms/initial-inventory-form/initial-inventory-form.component';
import { parseApiError } from '../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-fiscal-initial-inventory-step',
  standalone: true,
  imports: [CommonModule, InitialInventoryFormComponent],
  template: `
    <div class="step-body">
      <app-initial-inventory-form
        #form
        [initialValue]="initial()"
        [disabled]="submitting()"
        (validityChange)="onValidity($event)"
      ></app-initial-inventory-form>

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
export class FiscalInitialInventoryStepComponent
  implements FiscalWizardStepHost
{
  private readonly service = inject(FiscalActivationWizardService);
  private readonly http = inject(HttpClient);

  readonly stepId: FiscalWizardStepId = 'initial_inventory';
  readonly valid = signal(true);
  readonly submitting = signal(false);
  readonly localError = signal<string | null>(null);
  readonly initial = signal<Partial<InitialInventoryValue> | null>({
    costing_method: 'WEIGHTED_AVERAGE',
    capture_initial_balance_later: true,
  });
  /**
   * True when the prefill snapshot reports existing initial inventory
   * transactions. Surfaced in the template as a UX hint — the form itself
   * still needs the costing_method, which is loaded from settings (see
   * loadInitial comment) because the prefill does not carry it.
   */
  readonly inventoryAlreadyConfigured = signal(false);
  readonly initialTransactions = signal(0);

  private readonly form =
    viewChild.required<InitialInventoryFormComponent>('form');
  private loaded = false;

  constructor() {
    effect(() => {
      const scope = this.service.userScope();
      if (scope && !this.loaded) {
        this.loaded = true;
        this.loadInitial();
      }
    });
  }

  private loadInitial(): void {
    // userScope (logged-in user) routes the write request, not org-level
    // fiscal_scope.
    // TODO: surface read-only banner if STORE_ADMIN hits an org-owned config.
    //
    // The unified prefill snapshot now carries both the "is initial inventory
    // already configured?" hint AND the configured costing_method (read
    // scope-aware on the backend). No step-owned GETs are needed anymore.
    const prefillInventory = this.service.prefill()?.initial_inventory;
    this.inventoryAlreadyConfigured.set(
      prefillInventory?.configured ?? false,
    );
    this.initialTransactions.set(prefillInventory?.initial_transactions ?? 0);

    const method = this.mapPrefillCostingMethod(
      prefillInventory?.costing_method ?? null,
    );
    this.initial.set({
      costing_method: method,
      capture_initial_balance_later: true,
    });
  }

  /**
   * Maps the raw `settings.inventory.costing_method` value carried by the
   * prefill to the form's CostingMethod enum. Store settings use `cpp`, org
   * settings use `weighted_average`; both map to WEIGHTED_AVERAGE. Unknown or
   * absent values fall back to the form default (WEIGHTED_AVERAGE).
   */
  private mapPrefillCostingMethod(raw: string | null): CostingMethod {
    if (raw === 'fifo') return 'FIFO';
    if (raw === 'weighted_average' || raw === 'cpp') return 'WEIGHTED_AVERAGE';
    return 'WEIGHTED_AVERAGE';
  }

  onValidity(v: boolean): void {
    this.valid.set(v);
  }

  private mapToStore(method: CostingMethod): 'cpp' | 'fifo' | null {
    if (method === 'FIFO') return 'fifo';
    if (method === 'WEIGHTED_AVERAGE') return 'cpp';
    return null; // STANDARD not supported by store schema
  }

  private mapToOrg(method: CostingMethod): 'weighted_average' | 'fifo' | null {
    if (method === 'FIFO') return 'fifo';
    if (method === 'WEIGHTED_AVERAGE') return 'weighted_average';
    return null; // STANDARD not supported by org schema
  }

  async submit(): Promise<{ ref: Record<string, unknown> } | null> {
    const form = this.form();
    form.markAllTouched();
    if (!this.valid()) return null;

    this.submitting.set(true);
    this.localError.set(null);
    try {
      const value = form.getValue();
      const scope = this.service.userScope();

      if (scope === 'organization') {
        const mapped = this.mapToOrg(value.costing_method);
        if (!mapped) {
          this.localError.set(
            'Método STANDARD no soportado a nivel organización. Usa Promedio ponderado o FIFO.',
          );
          return null;
        }
        await firstValueFrom(
          this.http.put(
            `${environment.apiUrl}/organization/settings/inventory`,
            { costing_method: mapped },
          ),
        );
      } else {
        const mapped = this.mapToStore(value.costing_method);
        if (!mapped) {
          this.localError.set(
            'Método STANDARD no soportado a nivel tienda. Usa Promedio ponderado o FIFO.',
          );
          return null;
        }
        await firstValueFrom(
          this.http.patch(`${environment.apiUrl}/store/settings`, {
            inventory: { costing_method: mapped },
          }),
        );
      }

      const ref = {
        costing_method: value.costing_method,
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
