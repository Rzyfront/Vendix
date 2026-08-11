import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import type { StoreFiscalData } from '../../../../store/settings/general/services/store-settings.service';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  IconComponent,
  StoreFiscalIdentityFormComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  TENANT_CAPABILITY,
  fiscalOwnerNotice,
  tenantApiUrl,
} from '../../services/superadmin-dian-context.factory';
import { TenantContextStore } from '../../state/tenant-context.store';

interface TenantFiscalDataEnvelope {
  readonly level: 'store' | 'organization';
  readonly organization_id: number | null;
  readonly store_id: number | null;
  readonly fiscal_scope: 'STORE' | 'ORGANIZATION';
  readonly fiscal_data: StoreFiscalData | null;
}

interface TenantFiscalDataResponse {
  readonly data?: TenantFiscalDataEnvelope;
}

/**
 * Identidad legal/tributaria del tenant (`settings.fiscal_data`).
 *
 * REUTILIZA `app-store-fiscal-identity-form`, el mismo formulario que el panel
 * del comerciante: es presentacional puro (`initialValue` / `save`), no hace
 * HTTP, y sus validadores —NIT de 6 a 10 dígitos, DV de un dígito— son los que
 * ya gobiernan la identidad fiscal en producción.
 *
 * El `PATCH` es una FUSIÓN PARCIAL sobre `settings.fiscal_data`: el resto de
 * secciones no se toca y, en una organización de NIT único, escribe en
 * `organization_settings`, que es donde el comerciante lo lee.
 */
@Component({
  selector: 'app-tenant-fiscal',
  standalone: true,
  imports: [
    RouterLink,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    IconComponent,
    StoreFiscalIdentityFormComponent,
  ],
  template: `
    <div class="space-y-3 md:space-y-4">
      @if (ownerNotice(); as notice) {
        <app-alert-banner variant="warning" icon="alert-triangle">
          {{ notice.message }}
          <a
            [routerLink]="notice.route"
            class="ml-1 font-semibold underline underline-offset-2"
          >
            Abrir {{ notice.organizationName }}
          </a>
        </app-alert-banner>
      }

      @if (loading()) {
        <app-card [responsive]="true">
          <div class="flex items-center justify-center gap-3 py-10">
            <div
              class="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"
            ></div>
            <p class="text-sm text-text-secondary">Cargando identidad fiscal…</p>
          </div>
        </app-card>
      } @else if (loadError()) {
        <app-card [responsive]="true">
          <div class="flex flex-col items-center gap-3 py-8 text-center">
            <app-icon
              name="alert-triangle"
              [size]="22"
              class="text-red-600"
            ></app-icon>
            <p class="max-w-md text-sm text-text-secondary">{{ loadError() }}</p>
            <app-button variant="outline" size="sm" (clicked)="load()">
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Reintentar
            </app-button>
          </div>
        </app-card>
      } @else {
        <app-card [responsive]="true">
          <div class="space-y-4">
            <header
              class="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3"
            >
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-text-primary">
                  Identidad fiscal del tenant
                </h2>
                <p class="mt-0.5 text-xs text-text-secondary">
                  El NIT gobierna el CUFE de cada documento electrónico:
                  cambiarlo con documentos ya emitidos rompe la trazabilidad
                  ante la DIAN.
                </p>
              </div>
              <app-badge variant="neutral" size="sm">
                {{ levelLabel() }}
              </app-badge>
            </header>

            <app-store-fiscal-identity-form
              [initialValue]="fiscalData()"
              [disabled]="!canWrite() || saving()"
              (save)="askSave($event)"
            ></app-store-fiscal-identity-form>

            @if (!canWrite()) {
              <p class="text-right text-[11px] text-text-secondary">
                El perfil no declara <code>{{ writeCapability }}</code>: solo
                lectura.
              </p>
            }
          </div>
        </app-card>
      }

      @if (pendingSave(); as payload) {
        <app-confirmation-modal
          [isOpen]="true"
          title="Actualizar la identidad fiscal"
          [message]="saveMessage(payload)"
          confirmText="Actualizar identidad"
          cancelText="Cancelar"
          confirmVariant="danger"
          (confirm)="confirmSave(payload)"
          (cancel)="pendingSave.set(null)"
        ></app-confirmation-modal>
      }
    </div>
  `,
})
export class TenantFiscalComponent {
  private readonly http = inject(HttpClient);
  private readonly store = inject(TenantContextStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly writeCapability = TENANT_CAPABILITY.settingsWrite;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly envelope = signal<TenantFiscalDataEnvelope | null>(null);
  protected readonly pendingSave = signal<Partial<StoreFiscalData> | null>(null);

  protected readonly ownerNotice = computed(() => fiscalOwnerNotice(this.store));

  protected readonly canWrite = computed(() =>
    this.store.can(TENANT_CAPABILITY.settingsWrite),
  );

  protected readonly fiscalData = computed<StoreFiscalData | null>(
    () => this.envelope()?.fiscal_data ?? null,
  );

  protected readonly levelLabel = computed(() =>
    this.envelope()?.level === 'organization'
      ? 'Guardado en la organización'
      : 'Guardado en la tienda',
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.http
      .get<TenantFiscalDataResponse>(
        tenantApiUrl(this.store, 'settings/fiscal-data'),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.envelope.set(response?.data ?? null);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.envelope.set(null);
          this.loadError.set(
            extractApiErrorMessage(err) ||
              'No se pudo cargar la identidad fiscal del tenant.',
          );
        },
      });
  }

  protected askSave(payload: Partial<StoreFiscalData>): void {
    if (!this.canWrite() || this.saving()) return;
    this.pendingSave.set(payload);
  }

  protected saveMessage(payload: Partial<StoreFiscalData>): string {
    const nit = [payload.tax_id ?? payload.nit, payload.tax_id_dv ?? payload.nit_dv]
      .filter(Boolean)
      .join('-');
    const target =
      this.envelope()?.level === 'organization'
        ? `la organización ${this.store.profile()?.header.organization_name ?? ''}`.trim()
        : this.store.tenantName();

    return (
      `Se escribirá la identidad fiscal de ${target} con NIT ${nit || '(sin NIT)'} ` +
      `y razón social «${payload.legal_name || '(sin razón social)'}». ` +
      'Si el tenant ya emitió documentos electrónicos, el NIT nuevo no reescribe los CUFE ' +
      'existentes: quedarían firmados con la identidad anterior.'
    );
  }

  protected confirmSave(payload: Partial<StoreFiscalData>): void {
    this.pendingSave.set(null);
    this.saving.set(true);

    this.http
      .patch<TenantFiscalDataResponse>(
        tenantApiUrl(this.store, 'settings/fiscal-data'),
        payload,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          // Se repinta desde lo devuelto: la fusión parcial la resuelve el
          // backend y el formulario debe reflejar la fila real, no el payload.
          if (response?.data) this.envelope.set(response.data);
          this.toast.success('Identidad fiscal del tenant actualizada');
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.toast.error(
            extractApiErrorMessage(err) ||
              'No se pudo actualizar la identidad fiscal',
          );
        },
      });
  }
}
