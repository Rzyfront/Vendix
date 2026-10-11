import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ContractsService, ContractApiError } from '../../services/contracts.service';
import {
  Contract,
  ContractStatus,
  ContractTransitionTarget,
  ContractInvoiceRef,
  CONTRACT_STATUS_LABELS,
  CONTRACT_TRANSITIONS,
  CONTRACT_STATUS_ERROR_CODE,
  CONTRACT_INVOICE_ERROR_CODE,
  canGenerateContractInvoice,
} from '../../interfaces/contract.interface';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { TimelineComponent } from '../../../../../../shared/components/timeline/timeline.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import type { StickyHeaderActionButton, StickyHeaderBadgeColor } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import type { TimelineStep } from '../../../../../../shared/components/timeline/timeline.interfaces';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

const STATUS_BADGE_COLORS: Record<ContractStatus, StickyHeaderBadgeColor> = {
  draft: 'gray',
  active: 'green',
  invoiced: 'blue',
  cancelled: 'gray',
};

/** Accionabilidad por transicion: que hace cada boton antes de pulsarlo. */
const TRANSITION_META: Record<ContractTransitionTarget, { label: string; icon: string; hint: string }> = {
  active: { label: 'Activar contrato', icon: 'check-circle', hint: 'Cambia el estado administrativo del contrato.' },
  cancelled: { label: 'Cancelar contrato', icon: 'x-circle', hint: 'Solo está disponible si no hay una factura activa.' },
};

@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    StickyHeaderComponent,
    IconComponent,
    SpinnerComponent,
    TimelineComponent,
    CardComponent,
    ButtonComponent,
    AlertBannerComponent,
    CurrencyPipe,
  ],
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-20">
        <app-spinner size="lg"></app-spinner>
      </div>
    } @else if (loadError()) {
      <div class="max-w-[1600px] mx-auto px-3 py-3 sm:px-4 sm:py-4">
        <app-alert-banner variant="danger" heading="No se pudo cargar el contrato">
          {{ loadError() }}
          <div bannerActions class="mt-2 flex gap-2">
            <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
            <app-button variant="ghost" size="sm" (clicked)="goToList()">Volver al listado</app-button>
          </div>
        </app-alert-banner>
      </div>
    } @else if (contract()) {
      <app-sticky-header
        [title]="contract()!.contract_number"
        subtitle="Ficha administrativa de contrato"
        icon="file-text"
        [showBackButton]="true"
        backRoute="/admin/orders/contracts"
        [badgeText]="statusLabel()"
        [badgeColor]="statusBadgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onTransition($event)">
      </app-sticky-header>

      <div class="max-w-[1600px] mx-auto px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
        @if (transitionError()) {
          <app-alert-banner variant="danger" heading="No se pudo cambiar el estado">
            {{ transitionError() }}
            <div bannerActions class="mt-2">
              <app-button variant="outline" size="sm" (clicked)="clearTransitionError()">Entendido</app-button>
            </div>
          </app-alert-banner>
        }

        <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 lg:gap-5">
          <div class="flex flex-col gap-3">
            <app-card title="Objeto del contrato" shadow="sm" [responsivePadding]="true">
              @if (contract()!.contract_object) {
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ contract()!.contract_object }}</p>
              } @else {
                <p class="text-sm text-text-secondary">No configurado en los datos contractuales disponibles.</p>
              }
            </app-card>

            <app-card title="Líneas de costo directo de la cotización congelada" shadow="sm" [responsivePadding]="true">
              @if (contract()!.items?.length) {
                <div class="space-y-3">
                  @for (item of contract()!.items; track $index) {
                    <div class="rounded-lg border border-border p-3">
                      <div class="flex justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-semibold text-gray-900">{{ item.product_name }}</p>
                          @if (item.notes) { <p class="mt-1 text-xs text-text-secondary">{{ item.notes }}</p> }
                        </div>
                        @if (item.total_price !== null) {
                          <span class="shrink-0 font-semibold">{{ item.total_price | currency:2 }}</span>
                        }
                      </div>
                      <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-secondary sm:grid-cols-4">
                        <div><dt>Cantidad</dt><dd>{{ item.quantity ?? 'No configurado' }}</dd></div>
                        <div><dt>Precio unitario</dt><dd>{{ item.unit_price !== null ? (item.unit_price | currency:2) : 'No configurado' }}</dd></div>
                        <div><dt>Descuento</dt><dd>{{ item.discount_amount !== null ? (item.discount_amount | currency:2) : 'No configurado' }}</dd></div>
                        <div><dt>Impuesto</dt><dd>{{ item.tax_amount_item !== null ? (item.tax_amount_item | currency:2) : 'No configurado' }}@if (item.tax_rate !== null) { ({{ formatTaxRate(item.tax_rate) }}) }</dd></div>
                      </dl>
                    </div>
                  }
                </div>
              } @else {
                <p class="text-sm text-text-secondary">No hay líneas congeladas disponibles para este contrato.</p>
              }
            </app-card>

            <app-card title="Economía AIU congelada" shadow="sm" [responsivePadding]="true">
              @if (contract()!.economic; as economic) {
                <div class="space-y-3">
                  @if (economic.invoice_profile) {
                    <div class="rounded-lg border border-border p-3">
                      <p class="font-semibold text-gray-900">Perfil de facturación congelado</p>
                      <p class="text-sm text-text-secondary">
                        {{ economic.invoice_profile.name || ('Perfil #' + (economic.invoice_profile.profile_id ?? 'No configurado')) }}
                        · versión {{ economic.invoice_profile.version ?? 'No configurada · revisar' }}
                      </p>
                      <dl class="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                        <div><dt class="text-text-secondary">Base gravable</dt><dd>{{ taxableBasisLabel(economic.invoice_profile.taxable_basis) }}</dd></div>
                        <div><dt class="text-text-secondary">Base de componentes</dt><dd>{{ componentsBasisLabel(economic.invoice_profile.components_basis) }}</dd></div>
                        <div><dt class="text-text-secondary">Modelo de contabilización</dt><dd>{{ accountingModelLabel(economic.invoice_profile.accounting_model) }}</dd></div>
                      </dl>
                      @if (economic.invoice_profile.components) {
                        <dl class="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                          <div><dt class="text-text-secondary">Administración</dt><dd>{{ formatPct(economic.invoice_profile.components['administracion']) }}</dd></div>
                          <div><dt class="text-text-secondary">Imprevistos</dt><dd>{{ formatPct(economic.invoice_profile.components['imprevistos']) }}</dd></div>
                          <div><dt class="text-text-secondary">Utilidad</dt><dd>{{ formatPct(economic.invoice_profile.components['utilidad']) }}</dd></div>
                        </dl>
                      }
                    </div>
                  } @else {
                    <app-alert-banner variant="warning" heading="Perfil de facturación no configurado">
                      El snapshot económico no conserva el perfil de facturación. Revisa o crea una cotización de contrato nueva con una configuración explícita; no se usa el perfil vigente ni se calculan valores por defecto.
                    </app-alert-banner>
                  }

                  <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                    <div><dt class="text-text-secondary">Costo directo congelado</dt><dd class="font-semibold">{{ economic.direct_cost !== null ? (economic.direct_cost | currency:2) : 'No configurado · revisar' }}</dd></div>
                    <div><dt class="text-text-secondary">AIU congelado</dt><dd class="font-semibold">{{ economic.aiu_value !== null ? (economic.aiu_value | currency:2) : 'No configurado · revisar' }}</dd></div>
                    <div><dt class="text-text-secondary">Valor del contrato</dt><dd class="font-semibold">{{ economic.contract_value !== null ? (economic.contract_value | currency:2) : 'No configurado · revisar' }}</dd></div>
                  </dl>
                  @if (economic.aiu?.components?.length) {
                    <dl class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      @for (component of economic.aiu!.components; track component.component) {
                        <div><dt class="text-text-secondary">{{ economicBucketLabel(component.component) }}</dt><dd class="font-semibold">{{ component.amount !== null ? (component.amount | currency:2) : 'No configurado · revisar' }}</dd></div>
                      }
                    </dl>
                  }

                  @if (economic.invoice_lines.length > 0) {
                    <div class="space-y-2">
                      <h3 class="text-sm font-semibold text-gray-900">Desglose económico fiscal congelado</h3>
                      @for (line of economic.invoice_lines; track $index) {
                        <div class="rounded-lg border border-border p-3">
                          <div class="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p class="font-semibold text-gray-900">{{ line.description }}</p>
                              <p class="text-xs text-text-secondary">{{ economicBucketLabel(line.bucket) }}</p>
                            </div>
                            <span class="font-semibold">{{ line.total_amount !== null ? (line.total_amount | currency:2) : 'No configurado · revisar' }}</span>
                          </div>
                          <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-secondary sm:grid-cols-4">
                            <div><dt>Cantidad</dt><dd>{{ line.quantity ?? 'No configurado · revisar' }}</dd></div>
                            <div><dt>Precio unitario</dt><dd>{{ line.unit_price !== null ? (line.unit_price | currency:2) : 'No configurado · revisar' }}</dd></div>
                            <div><dt>Descuento</dt><dd>{{ line.discount_amount !== null ? (line.discount_amount | currency:2) : 'No configurado · revisar' }}</dd></div>
                            <div><dt>Base de línea</dt><dd>{{ line.base_amount !== null ? (line.base_amount | currency:2) : 'No configurado · revisar' }}</dd></div>
                          </dl>
                          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                            <span>Impuestos de línea: {{ line.tax_amount !== null ? (line.tax_amount | currency:2) : 'No configurado · revisar' }}</span>
                            @for (tax of line.taxes; track $index) {
                            <span>{{ tax.tax_name }}{{ economicTaxRate(tax.tax_rate, tax.rate_basis) !== null ? ' ' + economicTaxRate(tax.tax_rate, tax.rate_basis) : '' }}: {{ tax.tax_amount !== null ? (tax.tax_amount | currency:2) : 'No configurado · revisar' }}</span>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="text-sm text-text-secondary">No hay líneas económicas fiscales congeladas. Revisa el snapshot antes de usarlo para facturación.</p>
                  }

                  @if (economic.totals) {
                    <dl class="grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm sm:grid-cols-4">
                      <div><dt class="text-text-secondary">Base total</dt><dd class="font-semibold">{{ economic.totals.total_before_tax !== null ? (economic.totals.total_before_tax | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">Impuestos totales</dt><dd class="font-semibold">{{ economic.totals.tax_amount !== null ? (economic.totals.tax_amount | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">Descuentos</dt><dd class="font-semibold">{{ economic.totals.discount_amount !== null ? (economic.totals.discount_amount | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">Total congelado</dt><dd class="font-bold">{{ economic.totals.total_amount !== null ? (economic.totals.total_amount | currency:2) : 'No configurado · revisar' }}</dd></div>
                    </dl>
                  } @else {
                    <p class="text-sm text-text-secondary">Totales del cálculo: No configurado · revisar.</p>
                  }
                </div>
              } @else {
                <app-alert-banner variant="warning" heading="Snapshot económico no disponible">
                  Este contrato histórico no conserva perfil ni desglose económico congelado. No se puede generar una factura AIU desde configuración vigente o importes inferidos; crea una cotización de contrato nueva o revisada con su perfil de facturación.
                </app-alert-banner>
              }
            </app-card>

            <app-card title="Administración, Imprevistos y Utilidad (AIU)" shadow="sm" [responsivePadding]="true">
              <dl class="space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Administración (A)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatPct(contract()!.administration_percentage) }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Imprevistos (I)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatPct(contract()!.contingency_percentage) }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Utilidad (U)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatPct(contract()!.profit_percentage) }}</dd>
                </div>
              </dl>
              @if (contract()!.profile) {
                <p class="mt-3 text-xs text-text-secondary">
                  Perfil de facturación congelado {{ contract()!.profile!.name || ('#' + (contract()!.profile!.profile_id ?? 'No configurado')) }} · versión {{ contract()!.profile!.version ?? 'No configurada · revisar' }}.
                </p>
              } @else {
                <p class="mt-3 text-xs text-text-secondary">El snapshot no incluye un perfil de facturación congelado.</p>
              }
              <p class="mt-2 text-xs text-text-secondary">
                Las participaciones A/I/U provienen únicamente del perfil de facturación congelado. Un perfil de cotización no se usa como fuente fiscal.
              </p>
            </app-card>

            <app-card title="Vigencia y condiciones" shadow="sm" [responsivePadding]="true">
              <dl class="space-y-3 text-sm">
                <div>
                  <dt class="text-text-secondary">Válida hasta</dt>
                  <dd class="font-medium">{{ formatValidityDate(contract()!.valid_until) }}</dd>
                </div>
                <div>
                  <dt class="text-text-secondary">Términos y condiciones</dt>
                  <dd class="mt-1 whitespace-pre-wrap">{{ contract()!.terms_and_conditions || 'No configurado' }}</dd>
                </div>
                <div>
                  <dt class="text-text-secondary">Notas de la cotización</dt>
                  <dd class="mt-1 whitespace-pre-wrap">{{ contract()!.notes || 'No configurado' }}</dd>
                </div>
                @if (contract()!.snapshot?.frozen_at) {
                  <div><dt class="text-text-secondary">Snapshot congelado</dt><dd>{{ contract()!.snapshot!.frozen_at | date:'dd/MM/yyyy HH:mm' }}</dd></div>
                }
              </dl>
            </app-card>

            <app-card title="Documentos" shadow="sm" [responsivePadding]="true">
              <dl class="space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Cotización origen</dt>
                  <dd>
                    @if (contract()!.quotation) {
                      <a
                        [routerLink]="['/admin/orders/quotations', contract()!.quotation!.id]"
                        class="hover:underline font-medium"
                        style="color: var(--color-primary);"
                        [attr.aria-label]="'Ver cotización ' + contract()!.quotation!.quotation_number"
                      >
                        {{ contract()!.quotation!.quotation_number }}
                        <app-icon name="arrow-right" [size]="14" class="inline-block ml-1"></app-icon>
                      </a>
                    } @else {
                      <span class="font-medium">Cotización #{{ contract()!.quotation_id }}</span>
                    }
                  </dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Factura AIU</dt>
                  <dd>
                    @if (contract()!.invoice) {
                      <a
                        routerLink="/admin/invoicing/invoices"
                        [queryParams]="{ invoiceId: contract()!.invoice!.id }"
                        class="hover:underline font-medium"
                        style="color: var(--color-primary);"
                        [attr.aria-label]="'Ver factura AIU del contrato ' + contract()!.contract_number"
                      >
                        {{ contract()!.invoice!.invoice_number || ('Factura #' + contract()!.invoice!.id) }}
                        <span class="block text-xs text-text-secondary">Estado fiscal: {{ contract()!.invoice!.dian_status || 'No disponible' }}</span>
                        <app-icon name="arrow-right" [size]="14" class="inline-block ml-1"></app-icon>
                      </a>
                    } @else if (contract()!.status === 'active') {
                      <span class="text-text-secondary">Pendiente: se genera desde el contrato vigente.</span>
                    } @else {
                      <span class="text-text-secondary">Sin factura.</span>
                    }
                  </dd>
                </div>
              </dl>
            </app-card>

            @if (contract()!.notes) {
              <app-card title="Notas" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ contract()!.notes }}</p>
              </app-card>
            }

            <app-card title="Línea de Tiempo" shadow="sm" [responsivePadding]="true">
              <app-timeline class="block pt-1" [steps]="timelineSteps()" [collapsible]="true"></app-timeline>
            </app-card>
          </div>

          <div class="flex flex-col gap-3 lg:pt-0 pt-1">
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Factura AIU</h2>
              @if (invoiceError()) {
                <app-alert-banner variant="danger" heading="No se pudo generar la factura">
                  {{ invoiceError() }}
                  <div bannerActions class="mt-2 flex gap-2">
                    <app-button variant="outline" size="sm" (clicked)="goToInvoices()">Ver facturas</app-button>
                    <app-button variant="ghost" size="sm" (clicked)="clearInvoiceError()">Entendido</app-button>
                  </div>
                </app-alert-banner>
              } @else if (contract()!.invoice) {
                <p class="text-sm text-text-secondary">
                  {{ contract()!.invoice!.invoice_number || ('Factura #' + contract()!.invoice!.id) }} · estado administrativo: {{ contract()!.invoice!.status || 'No disponible' }} · estado fiscal: {{ contract()!.invoice!.dian_status || 'No disponible' }}.
                </p>
                <div class="mt-3">
                  <app-button variant="outline" [fullWidth]="true" (clicked)="goToInvoices(contract()!.invoice!.id)">
                    <app-icon slot="icon" name="receipt" size="16"></app-icon>
                    Ver factura AIU #{{ contract()!.invoice!.id }}
                  </app-button>
                </div>
              } @else if (canGenerateInvoice()) {
                <div>
                  <app-button
                    variant="primary"
                    [fullWidth]="true"
                    [disabled]="generatingInvoice()"
                    [loading]="generatingInvoice()"
                    (clicked)="generateInvoice()"
                  >
                    <app-icon slot="icon" name="file-text" size="16"></app-icon>
                    Generar factura AIU
                  </app-button>
                </div>
                <p class="mt-3 text-xs text-text-secondary">
                  Crea un borrador administrativo. No confirma emisión ni aceptación fiscal, y los datos económicos/fiscales del contrato requieren validación antes de uso.
                </p>
              } @else {
                <p class="text-sm text-text-secondary">
                  @if (contract()!.status === 'active' && (!contract()!.economic || !contract()!.economic!.invoice_profile?.config)) {
                    No se puede facturar: falta el perfil y el snapshot económico congelado. Revisa o crea una cotización de contrato nueva con un perfil de facturación explícito.
                  } @else if (contract()!.status === 'active' && contract()!.invoice) {
                    Hay una factura activa; resuélvela antes de generar otra.
                  } @else {
                    Disponible cuando el contrato esté vigente y conserve una factura AIU.
                  }
                </p>
              }
            </app-card>

            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Estado y transiciones</h2>
              @if (validTransitions().length > 0) {
                <div class="space-y-2">
                  @for (target of validTransitions(); track target) {
                    <app-button
                      [variant]="target === 'cancelled' ? 'outline-danger' : 'primary'"
                      [fullWidth]="true"
                      [disabled]="transitionLoading() !== null"
                      [loading]="transitionLoading() === target"
                      (clicked)="onTransition(target)"
                    >
                      <app-icon slot="icon" [name]="transitionMeta(target).icon" size="16"></app-icon>
                      {{ transitionMeta(target).label }}
                    </app-button>
                  }
                </div>
                @if (transitionHint()) {
                  <p class="mt-3 text-xs text-text-secondary">{{ transitionHint() }}</p>
                }
              } @else {
                <div class="text-[10px] text-center text-text-secondary font-bold uppercase tracking-widest bg-[var(--color-surface)] py-3 rounded-xl border border-dashed border-border">
                  {{ contract()!.status === 'active' && contract()!.invoice ? 'Factura activa: resuélvela antes de cancelar el contrato.' : 'Estado terminal: sin transiciones disponibles' }}
                </div>
              }
            </app-card>

            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Resumen</h2>
              <div class="space-y-2.5">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Subtotal</span>
                  <span class="font-semibold text-gray-900">{{ contract()!.subtotal_amount !== null && contract()!.subtotal_amount !== undefined ? (contract()!.subtotal_amount | currency:2) : 'No configurado' }}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Descuentos</span>
                  <span class="font-semibold text-gray-900">{{ contract()!.discount_amount !== null && contract()!.discount_amount !== undefined ? (contract()!.discount_amount | currency:2) : 'No configurado' }}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Impuestos</span>
                  <span class="font-semibold text-gray-900">{{ contract()!.tax_amount !== null && contract()!.tax_amount !== undefined ? (contract()!.tax_amount | currency:2) : 'No configurado' }}</span>
                </div>
                <div class="pt-3 mt-1 border-t border-border flex justify-between items-center">
                  <span class="text-base font-bold text-gray-900">Total de cotización congelado</span>
                  <span class="text-xl sm:text-2xl font-black text-primary-600 font-mono tracking-tighter">
                    {{ contract()!.grand_total !== null && contract()!.grand_total !== undefined ? (contract()!.grand_total | currency:2) : 'No configurado' }}
                  </span>
                </div>
              </div>
              <dl class="mt-4 pt-4 border-t border-border space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Creado</dt>
                  <dd class="font-semibold text-gray-900">{{ contract()!.created_at ? (contract()!.created_at | date:'dd/MM/yyyy HH:mm') : 'No configurado' }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Actualizado</dt>
                  <dd class="font-semibold text-gray-900">{{ contract()!.updated_at ? (contract()!.updated_at | date:'dd/MM/yyyy HH:mm') : 'No configurado' }}</dd>
                </div>
              </dl>
            </app-card>
          </div>
        </div>
      </div>
    }
  `,
  styles: [],
})
export class ContractDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly contractsService = inject(ContractsService);
  private readonly toastService = inject(ToastService);

  readonly contract = signal<Contract | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly transitionLoading = signal<ContractTransitionTarget | null>(null);
  readonly transitionError = signal<string | null>(null);
  readonly generatingInvoice = signal(false);
  readonly invoiceError = signal<string | null>(null);

  readonly statusLabel = computed(() => {
    const c = this.contract();
    return c ? CONTRACT_STATUS_LABELS[c.status] || c.status : '';
  });

  readonly statusBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const c = this.contract();
    return c ? STATUS_BADGE_COLORS[c.status] || 'gray' : 'gray';
  });

  /** C.2: solo las transiciones validas para el estado actual se habilitan. */
  readonly validTransitions = computed<ContractTransitionTarget[]>(() => {
    const c = this.contract();
    return c
      ? [...(CONTRACT_TRANSITIONS[c.status] ?? [])].filter(
          (target) => !(target === 'cancelled' && c.invoice),
        )
      : [];
  });

  /** D.2 (FB-08/FB-09): el boton solo vive en contrato vigente sin factura. */
  readonly canGenerateInvoice = computed(() => {
    const c = this.contract();
    return c
      ? canGenerateContractInvoice(
          c.status,
          c.invoice,
          c.economic?.schema_version === 1 && c.economic.invoice_profile?.config !== null && c.economic.invoice_profile?.config !== undefined,
        )
      : false;
  });

  readonly transitionHint = computed(() => {
    const c = this.contract();
    if (!c || this.validTransitions().length === 0) return '';
    if (c.status === 'draft') return 'Al activar, el contrato pasa a estado administrativo vigente.';
    if (c.status === 'active') return 'La facturación no cambia este estado; “Facturado” solo se muestra tras la aceptación fiscal de la DIAN.';
    return '';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const current = this.transitionLoading();
    return this.validTransitions().map((target) => ({
      id: target,
      label: TRANSITION_META[target].label,
      variant: (target === 'cancelled' ? 'outline-danger' : 'primary') as StickyHeaderActionButton['variant'],
      icon: TRANSITION_META[target].icon,
      visible: true,
      loading: current === target,
      disabled: current !== null,
    }));
  });

  readonly timelineSteps = computed<TimelineStep[]>(() => {
    const c = this.contract();
    if (!c) return [];
    const steps: TimelineStep[] = [
      {
        key: 'created',
        label: 'Creado',
        status: 'completed',
        variant: 'default',
        date: c.created_at ?? undefined,
        description: `Desde cotización #${c.quotation_id}`,
      },
    ];
    const order: ContractStatus[] = ['draft', 'active', 'invoiced'];
    const labels: Record<string, string> = {
      draft: 'Borrador',
      active: 'Vigente',
      invoiced: 'Facturado',
    };
    for (const s of order) {
      if (s === 'draft') continue;
      const reached = order.indexOf(c.status) >= order.indexOf(s);
      if (c.status === 'cancelled') continue;
      steps.push({
        key: s,
        label: reached ? labels[s] : `${labels[s]} pendiente`,
        status: reached ? 'completed' : 'upcoming',
        variant: 'default',
        date: reached && s === c.status ? c.updated_at ?? undefined : undefined,
      });
    }
    if (c.status === 'cancelled') {
      steps.push({
        key: 'cancelled',
        label: 'Cancelado',
        status: 'completed',
        variant: 'default',
        date: c.updated_at ?? undefined,
      });
    }
    return steps;
  });

  constructor() {
    this.reload();
  }

  transitionMeta(target: ContractTransitionTarget): { label: string; icon: string } {
    return TRANSITION_META[target];
  }

  formatPct(value: number | null | undefined): string {
    return value === null || value === undefined ? 'No configurado · revisar' : `${value}%`;
  }

  taxableBasisLabel(value: string | null): string {
    switch (value) {
      case 'aiu': return 'AIU';
      case 'utilidad': return 'Utilidad';
      case 'subtotal': return 'Subtotal';
      default: return 'No configurado · revisar';
    }
  }

  componentsBasisLabel(value: string | null): string {
    if (value === 'contract') return 'Porcentaje del contrato';
    if (value === 'aiu') return 'Porcentaje del AIU';
    return 'No configurado · revisar';
  }

  accountingModelLabel(value: string | null): string {
    if (value === 'sumada') return 'Sumada';
    if (value === 'no_sumada') return 'No sumada';
    return 'No configurado · revisar';
  }

  economicBucketLabel(value: string | null): string {
    const labels: Record<string, string> = {
      administracion: 'Administración',
      imprevistos: 'Imprevistos',
      utilidad: 'Utilidad',
      costo: 'Costo directo',
      contrato: 'Contrato',
    };
    return value ? labels[value] ?? value : 'Componente no configurado · revisar';
  }

  economicTaxRate(value: number | null, rateBasis: string | null): string | null {
    if (value === null) return null;
    const percent = rateBasis === 'fraction' ? value * 100 : value;
    return Number.isFinite(percent) ? `${percent}%` : null;
  }

  /** Quotation item tax_rate is canonicalized as a fraction (0.19 = 19%). */
  formatTaxRate(value: number | null | undefined): string {
    if (value === null || value === undefined) return 'No configurado';
    if (!Number.isFinite(value) || value < 0 || value > 1) return 'Tarifa no normalizada';
    return `${Number((value * 100).toFixed(5))}%`;
  }

  formatValidityDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : 'No configurado';
  }

  clearTransitionError(): void {
    this.transitionError.set(null);
  }

  clearInvoiceError(): void {
    this.invoiceError.set(null);
  }

  goToList(): void {
    void this.router.navigate(['/admin/orders/contracts']);
  }

  /** D.2: apertura del borrador AIU en el modulo de facturacion. */
  goToInvoices(invoiceId?: number): void {
    void this.router.navigate(
      ['/admin/invoicing/invoices'],
      invoiceId ? { queryParams: { invoiceId } } : undefined,
    );
  }

  reload(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Contrato no válido (sin identificador).');
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    this.contractsService
      .getContractById(id)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (c) => {
          this.contract.set(c);
        },
        error: (err: ContractApiError | Error) => this.loadError.set(err?.message ?? 'Error al cargar el contrato'),
      });
  }

  /** Refresco silencioso (sin spinner de pagina) tras generar o chocar con 409. */
  private quietReload(): void {
    const current = this.contract();
    if (!current) return;
    this.contractsService
      .getContractById(current.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => this.contract.set(c),
        error: () => undefined,
      });
  }

  /**
   * D.2 (FB-08): genera el borrador AIU precargado desde el contrato vigente
   * y abre el modulo de facturacion para revisarlo y emitirlo. El boton se
   * bloquea mientras responde el backend (doble clic = una sola factura) y
   * el 409 se muestra como "ya facturado" con enlace, nunca como error crudo.
   */
  generateInvoice(): void {
    const current = this.contract();
    if (!current || this.generatingInvoice()) return;
    if (!current.economic || current.economic.schema_version !== 1 || !current.economic.invoice_profile?.config) {
      const message = 'No se puede generar una factura: falta el snapshot económico y el perfil de facturación congelados. Revisa o crea una cotización de contrato nueva con una configuración explícita.';
      this.invoiceError.set(message);
      this.toastService.error(message);
      return;
    }
    if (!canGenerateContractInvoice(current.status, current.invoice, true)) return;
    this.generatingInvoice.set(true);
    this.invoiceError.set(null);
    this.contractsService
      .generateContractInvoice(current.id)
      .pipe(
        finalize(() => this.generatingInvoice.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          const payload = result !== null && typeof result === 'object' ? result as Record<string, unknown> : null;
          const created = payload?.['invoice'] && typeof payload['invoice'] === 'object'
            ? payload['invoice'] as Record<string, unknown>
            : payload;
          const createdId = typeof created?.['id'] === 'number' && Number.isSafeInteger(created['id'])
            ? created['id'] as number
            : null;
          const createdStatus = typeof created?.['status'] === 'string' ? created['status'] : null;
          const createdInvoice: ContractInvoiceRef | null = createdId !== null
            ? {
                id: createdId,
                invoice_number: typeof created?.['invoice_number'] === 'string' ? created['invoice_number'] : undefined,
                status: createdStatus ?? undefined,
                total_amount: typeof created?.['total_amount'] === 'number'
                  ? created['total_amount']
                  : typeof created?.['total_amount'] === 'string' && created['total_amount'].trim() !== '' && Number.isFinite(Number(created['total_amount']))
                    ? Number(created['total_amount'])
                    : null,
                dian_status: typeof created?.['dian_status'] === 'string' ? created['dian_status'] : null,
              }
            : null;
          if (createdInvoice) {
            // Keep the backend's status effective; creating a draft never marks
            // the contract invoiced. The follow-up read is the source of truth.
            this.contract.set({ ...current, invoice: createdInvoice });
          }
          this.quietReload();
          const label = createdInvoice?.invoice_number ?? createdInvoice?.id ?? null;
          this.toastService.success(
            label
              ? createdStatus === 'draft'
                ? `Borrador ${label} listo para revisar y emitir`
                : `Factura ${label} creada (estado: ${createdStatus})`
              : 'Solicitud de factura procesada; consulta el estado actualizado del contrato.',
          );
          this.goToInvoices(createdInvoice?.id);
        },
        error: (err: ContractApiError | Error) => {
          const status = err instanceof ContractApiError ? err.status : null;
          const code = err instanceof ContractApiError ? err.code : null;
          if (status === 409 || code === CONTRACT_INVOICE_ERROR_CODE) {
            const message = `Este contrato ya tiene factura AIU (${CONTRACT_INVOICE_ERROR_CODE})`;
            this.invoiceError.set(message);
            this.toastService.error(message);
            this.quietReload();
            return;
          }
          const message = err?.message ?? 'No se pudo generar la factura AIU';
          this.invoiceError.set(message);
          this.toastService.error(message);
        },
      });
  }

  /**
   * ERR-06: la transicion invalida (422 CONTRACT_STATUS_001) se muestra como
   * mensaje accionable con su codigo — jamas pantalla en blanco — y la ficha
   * conserva el ultimo estado consistente.
   */
  onTransition(targetId: string): void {
    const target = targetId as ContractTransitionTarget;
    const current = this.contract();
    if (!current || this.transitionLoading() !== null) return;
    if (!this.validTransitions().includes(target)) {
      const message = `Transición no permitida de ${CONTRACT_STATUS_LABELS[current.status]} a ${CONTRACT_STATUS_LABELS[target] ?? target} (${CONTRACT_STATUS_ERROR_CODE})`;
      this.transitionError.set(message);
      this.toastService.error(message);
      return;
    }
    this.transitionLoading.set(target);
    this.transitionError.set(null);
    this.contractsService
      .transitionContractStatus(current.id, target)
      .pipe(
        finalize(() => this.transitionLoading.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => {
          this.contract.set(updated);
          this.toastService.success(`Contrato ${CONTRACT_STATUS_LABELS[updated.status].toLowerCase()} correctamente`);
        },
        error: (err: ContractApiError | Error) => {
          // ContractApiError ya trae el codigo entre parentesis; el fallback lo
          // anade para que el operador siempre vea el codigo accionable.
          const raw = err?.message ?? 'No se pudo cambiar el estado';
          const message =
            err instanceof ContractApiError && err.code
              ? raw
              : `${raw} (${CONTRACT_STATUS_ERROR_CODE})`;
          this.transitionError.set(message);
          this.toastService.error(message);
        },
      });
  }
}
