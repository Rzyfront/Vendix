import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import {
  PlatformAcquirer,
  PlatformFiscalInvoicingActions,
  selectPlatformAcquirerResults,
  selectPlatformAcquirerSearchLoading,
} from '../../state';

import {
  ButtonComponent,
  CardComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../../shared/components';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase C.2
 *
 * TenantPicker: selector del destinatario para el form de crear
 * plataforma invoice. ADR-7: el cliente son stores u organizations,
 * NO `users`.
 *
 * Shape:
 *   [qr] -> <input-search> -> dispatch SearchAcquirers
 *   [tabs kind=store | organization | both]
 *   [results list] -> preview card on click -> emit tenantPicked
 *
 * El picker es smart: cuando el tenant no trae `fiscal_data_complete`
 * (campo derivado en `PlatformTenantsService.checkStoreFiscalComplete`
 * / `checkOrganizationFiscalComplete`), el form lo sabe y bloquea
 * submit hasta que el operador complete los campos faltantes inline.
 *
 * Las sombras de error: las emite el create service — el picker solo
 * muestra readonly y avisa al operador.
 */
@Component({
  selector: 'app-platform-tenant-picker',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-3">
      <header class="flex items-center gap-3">
        <h3 class="text-sm font-semibold text-gray-900">Destinatario (tenant cliente)</h3>
        <span class="text-xs text-gray-500">ADR-7: el cliente del rail super-admin son tiendas u organizaciones, NO usuarios finales.</span>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-2">
        <app-input
          placeholder="Buscar por NIT, razón social, slug..."
          (inputChange)="onQueryChange($event)"
          aria-label="Buscar destinatario"
        ></app-input>
        <app-selector
          [options]="kindOptions"
          (valueChange)="onKindChange($event ?? null)"
        ></app-selector>
      </div>

      @if (loading()) {
        <p class="text-sm text-gray-500">Buscando tenants...</p>
      } @else if (results().length === 0 && q().trim().length > 0) {
        <p class="text-sm text-gray-500">Sin coincidencias para "{{ q() }}".</p>
      } @else if (lockedTenant()) {
        <div class="bg-success-light border border-success rounded p-3 space-y-1 text-sm">
          <p class="font-mono text-success">
            {{ lockedTenant()!.kind }} :{{ lockedTenant()!.tenant_id }} · {{ lockedTenant()!.legal_name }}
            · {{ lockedTenant()!.tax_id }}{{ lockedTenant()!.tax_id_dv ? '-' + lockedTenant()!.tax_id_dv : '' }}
          </p>
          @if (!lockedTenant()!.fiscal_data_complete) {
            <p class="text-warning">
              Datos fiscales incompletos. El operador debe completar regimen + responsabilidades en el form.
            </p>
          }
        </div>
        <button app-button variant="secondary" type="button" (click)="onClear()">Cambiar destinatario</button>
      } @else {
        <ul class="divide-y">
          @for (tenant of results(); track tenant.id) {
            <li class="py-2">
              <button
                type="button"
                class="text-left w-full hover:bg-gray-50 px-2 py-1 rounded"
                (click)="onPick(tenant)"
              >
                <p class="font-mono text-sm">{{ tenant.kind }} :{{ tenant.tenant_id }}</p>
                <p class="text-sm text-gray-900">{{ tenant.legal_name }}</p>
                <p class="text-xs text-gray-500">
                  {{ tenant.tax_id }}{{ tenant.tax_id_dv ? '-' + tenant.tax_id_dv : '' }}
                  ·
                  @if (tenant.tax_regime_code) {
                    regimen {{ tenant.tax_regime_code }} ·
                  }
                  {{ tenant.fiscal_responsibilities.length }} responsabilidades
                </p>
                @if (!tenant.fiscal_data_complete) {
                  <p class="text-xs text-warning mt-1">Datos fiscales incompletos</p>
                }
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class TenantPickerComponent implements OnInit {
  private readonly store = inject(Store);

  /** Disabled auto-search while user is typing. */
  readonly q = signal('');
  readonly kind = signal<'store' | 'organization' | null>(null);
  readonly lockedTenant = signal<PlatformAcquirer | null>(null);

  readonly results$: Observable<PlatformAcquirer[]> = this.store.select(selectPlatformAcquirerResults);
  readonly loading$: Observable<boolean> = this.store.select(selectPlatformAcquirerSearchLoading);

  /** Local mirror for zoneless. *Local* signals — no NgRx subscription here. */
  readonly results = signal<PlatformAcquirer[]>([]);
  readonly loading = signal<boolean>(false);

  @Output() tenantPicked = new EventEmitter<PlatformAcquirer | null>();

  readonly kindOptions = [
    { value: '', label: 'Todos' },
    { value: 'store', label: 'Tiendas' },
    { value: 'organization', label: 'Organizaciones' },
  ];

  ngOnInit(): void {
    // Suscripcion local a signals (NgRx -> signals, requerido por OnPush).
    this.results$.subscribe((rows) => this.results.set(rows));
    this.loading$.subscribe((v) => this.loading.set(v));

    // Carga inicial: listar tiendas al abrir el form (sin q).
    this.store.dispatch(
      PlatformFiscalInvoicingActions.searchAcquirers({ q: '', kind: null }),
    );
  }

  onQueryChange(value: string): void {
    this.q.set(value ?? '');
    this.store.dispatch(
      PlatformFiscalInvoicingActions.searchAcquirers({
        q: this.q(),
        kind: this.kind(),
      }),
    );
  }

  onKindChange(value: string | number | null): void {
    const v = (value ?? '').toString();
    const next = !v ? null : ((v as 'store' | 'organization') ?? null);
    this.kind.set(next);
    this.store.dispatch(
      PlatformFiscalInvoicingActions.searchAcquirers({
        q: this.q(),
        kind: next,
      }),
    );
  }

  onPick(tenant: PlatformAcquirer): void {
    this.lockedTenant.set(tenant);
    this.store.dispatch(PlatformFiscalInvoicingActions.lockAcquirer({ acquirer: tenant }));
    this.tenantPicked.emit(tenant);
  }

  onClear(): void {
    this.lockedTenant.set(null);
    this.store.dispatch(PlatformFiscalInvoicingActions.lockAcquirer({ acquirer: null }));
    this.tenantPicked.emit(null);
  }
}
