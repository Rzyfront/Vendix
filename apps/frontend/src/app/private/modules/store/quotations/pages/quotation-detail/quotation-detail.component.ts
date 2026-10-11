import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { QuotationsService } from '../../services/quotations.service';
import { QuotationPrintService } from '../../services/quotation-print.service';
import { Quotation, QuotationStatus } from '../../interfaces/quotation.interface';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import type { StickyHeaderActionButton, StickyHeaderBadgeColor } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { TimelineComponent } from '../../../../../../shared/components/timeline/timeline.component';
import type { TimelineStep } from '../../../../../../shared/components/timeline/timeline.interfaces';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ContractsService } from '../../../contracts/services/contracts.service';

const STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Expirada',
  converted: 'Convertida',
  contracted: 'Contratada',
  cancelled: 'Cancelada',
};

const STATUS_BADGE_COLORS: Record<QuotationStatus, StickyHeaderBadgeColor> = {
  draft: 'gray',
  sent: 'blue',
  accepted: 'green',
  rejected: 'red',
  expired: 'yellow',
  converted: 'green',
  contracted: 'green',
  cancelled: 'gray',
};

interface ContractEconomicLineDisplay {
  frozen: NonNullable<Quotation['contract_economic_snapshot']>['invoice_lines'][number];
  calculation: Record<string, unknown> | null;
}

@Component({
  selector: 'app-quotation-detail',
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
    CurrencyPipe,
  ],
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-20">
        <app-spinner size="lg"></app-spinner>
      </div>
    } @else if (quotation()) {
      <app-sticky-header
        [title]="quotation()!.quotation_number"
        subtitle="Detalle de cotización"
        icon="file-text"
        [showBackButton]="true"
        backRoute="/admin/orders/quotations"
        [badgeText]="statusLabel()"
        [badgeColor]="statusBadgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)">
      </app-sticky-header>

      <div class="max-w-[1600px] mx-auto px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 lg:gap-5">

          <!-- LEFT COLUMN -->
          <div class="flex flex-col gap-3">

            <!-- Customer Info -->
            <app-card title="Cliente" shadow="sm" [responsivePadding]="true">
              @if (quotation()!.customer) {
                <div class="flex items-start gap-3 sm:gap-4">
                  <div class="w-10 h-10 sm:w-14 sm:h-14 bg-primary/10 text-primary rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-xl font-bold border border-primary/5 flex-shrink-0">
                    {{ quotation()!.customer!.first_name.charAt(0) || 'C' }}
                  </div>
                  <div class="space-y-0.5 sm:space-y-1 min-w-0">
                    <p class="text-base sm:text-lg font-bold text-gray-900 truncate">
                      {{ quotation()!.customer!.first_name }} {{ quotation()!.customer!.last_name }}
                    </p>
                    <div class="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600">
                      <app-icon name="mail" size="14" class="text-gray-400 flex-shrink-0 sm:[--icon-size:16px]"></app-icon>
                      <span class="truncate">{{ quotation()!.customer!.email || 'Sin correo registrado' }}</span>
                    </div>
                    <div class="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600">
                      <app-icon name="phone" size="14" class="text-gray-400 flex-shrink-0 sm:[--icon-size:16px]"></app-icon>
                      <span class="truncate">{{ quotation()!.customer!.phone || 'Sin teléfono registrado' }}</span>
                    </div>
                  </div>
                </div>
              } @else {
                <div class="flex items-center gap-3 text-gray-400">
                  <div class="w-10 h-10 sm:w-14 sm:h-14 bg-gray-100 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                    <app-icon name="user" size="20" class="text-gray-300"></app-icon>
                  </div>
                  <p class="text-sm text-text-secondary">Sin cliente asignado</p>
                </div>
              }
            </app-card>

            @if (quotation()!.destination === 'contract') {
              @if (quotation()!.contract_economic_snapshot; as economic) {
                <app-card title="Economía contractual congelada" shadow="sm" [responsivePadding]="true">
                  <div class="space-y-3">
                    <section class="rounded-lg border border-border p-3">
                      <h3 class="text-sm font-semibold text-gray-900">Perfil AIU congelado</h3>
                      <p class="text-sm text-text-secondary">
                        {{ economic.invoice_profile.name || ('Perfil #' + economic.invoice_profile.profile_id) }} · versión {{ economic.invoice_profile.version }}
                      </p>
                      <dl class="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                        <div><dt class="text-text-secondary">Base gravable</dt><dd>{{ taxableBasisLabel(economic.invoice_profile.config.aiu?.taxable_basis ?? economic.invoice_profile.config.aiu?.regime) }}</dd></div>
                        <div><dt class="text-text-secondary">Base de componentes</dt><dd>{{ componentsBasisLabel(economic.invoice_profile.config.aiu?.components_basis) }}</dd></div>
                        <div><dt class="text-text-secondary">Modelo</dt><dd>{{ accountingModelLabel(economic.invoice_profile.config.aiu?.accounting_model) }}</dd></div>
                      </dl>
                      <dl class="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                        <div><dt class="text-text-secondary">Administración</dt><dd>{{ formatPercent(economic.invoice_profile.config.aiu?.components?.['administracion']) }}</dd></div>
                        <div><dt class="text-text-secondary">Imprevistos</dt><dd>{{ formatPercent(economic.invoice_profile.config.aiu?.components?.['imprevistos']) }}</dd></div>
                        <div><dt class="text-text-secondary">Utilidad</dt><dd>{{ formatPercent(economic.invoice_profile.config.aiu?.components?.['utilidad']) }}</dd></div>
                      </dl>
                    </section>

                    <section>
                      <h3 class="text-sm font-semibold text-gray-900">Objeto contractual</h3>
                      <p class="mt-1 text-sm whitespace-pre-wrap text-gray-700">{{ economic.contract_object || 'No configurado en el snapshot económico.' }}</p>
                    </section>

                    <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                      <div><dt class="text-text-secondary">Costo directo</dt><dd class="font-semibold">{{ displayMoney(economic.direct_cost) !== null ? (displayMoney(economic.direct_cost)! | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">AIU</dt><dd class="font-semibold">{{ displayMoney(economic.aiu_value) !== null ? (displayMoney(economic.aiu_value)! | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">Valor del contrato</dt><dd class="font-semibold">{{ displayMoney(economic.contract_value) !== null ? (displayMoney(economic.contract_value)! | currency:2) : 'No configurado · revisar' }}</dd></div>
                    </dl>

                    @if (economic.due_date) {
                      <p class="text-sm"><span class="text-text-secondary">Fecha de pago acordada:</span> {{ formatFrozenDate(economic.due_date) }}</p>
                    }

                    @if (economic.invoice_lines.length > 0) {
                      <section class="space-y-2">
                        <h3 class="text-sm font-semibold text-gray-900">Desglose económico fiscal congelado</h3>
                        @for (entry of contractEconomicLines(); track $index) {
                          <div class="rounded-lg border border-border p-3">
                            <div class="flex flex-wrap justify-between gap-2">
                              <div>
                                <p class="font-semibold text-gray-900">{{ entry.frozen.description || economicBucketLabel(entry.frozen.bucket) }}</p>
                                <p class="text-xs text-text-secondary">{{ economicBucketLabel(entry.frozen.bucket) }}</p>
                              </div>
                              <span class="font-semibold">{{ displayMoney(lineAmount(entry.calculation, 'total_amount')) !== null ? (displayMoney(lineAmount(entry.calculation, 'total_amount'))! | currency:2) : 'No configurado · revisar' }}</span>
                            </div>
                            <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-secondary sm:grid-cols-4">
                              <div><dt>Cantidad</dt><dd>{{ entry.frozen.quantity }}</dd></div>
                              <div><dt>Precio unitario</dt><dd>{{ displayMoney(entry.frozen.unit_price) !== null ? (displayMoney(entry.frozen.unit_price)! | currency:2) : 'No configurado · revisar' }}</dd></div>
                              <div><dt>Descuento</dt><dd>{{ displayMoney(entry.frozen.discount_amount) !== null ? (displayMoney(entry.frozen.discount_amount)! | currency:2) : 'No configurado · revisar' }}</dd></div>
                              <div><dt>Base calculada</dt><dd>{{ displayMoney(lineAmount(entry.calculation, 'line_extension_amount')) !== null ? (displayMoney(lineAmount(entry.calculation, 'line_extension_amount'))! | currency:2) : 'No configurado · revisar' }}</dd></div>
                            </dl>
                            <p class="mt-1 text-xs text-text-secondary">Impuestos de línea: {{ displayMoney(lineAmount(entry.calculation, 'tax_amount')) !== null ? (displayMoney(lineAmount(entry.calculation, 'tax_amount'))! | currency:2) : 'No configurado · revisar' }}</p>
                            @for (tax of lineTaxes(entry.calculation); track $index) {
                              <p class="text-xs text-text-secondary">{{ taxName(tax) }}{{ displayTaxRate(tax) !== null ? ' ' + displayTaxRate(tax) : '' }}: {{ displayMoney(tax['tax_amount']) !== null ? (displayMoney(tax['tax_amount'])! | currency:2) : 'No configurado · revisar' }}</p>
                            }
                          </div>
                        }
                      </section>
                    }

                    <dl class="grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm sm:grid-cols-4">
                      <div><dt class="text-text-secondary">Subtotal bruto</dt><dd class="font-semibold">{{ snapshotTotal(economic, 'gross_subtotal') !== null ? (snapshotTotal(economic, 'gross_subtotal')! | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">Descuento</dt><dd class="font-semibold">{{ snapshotTotal(economic, 'discount_amount') !== null ? (snapshotTotal(economic, 'discount_amount')! | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">Impuestos</dt><dd class="font-semibold">{{ snapshotTotal(economic, 'tax_amount') !== null ? (snapshotTotal(economic, 'tax_amount')! | currency:2) : 'No configurado · revisar' }}</dd></div>
                      <div><dt class="text-text-secondary">Total calculado</dt><dd class="font-bold">{{ snapshotTotal(economic, 'total_amount') !== null ? (snapshotTotal(economic, 'total_amount')! | currency:2) : 'No configurado · revisar' }}</dd></div>
                    </dl>
                  </div>
                </app-card>
              } @else {
                <app-card title="Economía contractual" shadow="sm" [responsivePadding]="true">
                  <p class="text-sm text-amber-800">Esta cotización histórica no conserva un snapshot económico ni perfil AIU congelado. No se puede reconstruir el objeto ni la economía desde notas o configuración vigente.</p>
                </app-card>
              }
            }

            <!-- Items -->
            <app-card [title]="quotation()!.destination === 'contract' ? 'Costo directo cotizado' : 'Items'" shadow="sm" [responsivePadding]="true">
              <p class="mb-2 text-right text-[11px] sm:text-xs font-medium text-gray-500">
                {{ quotation()!.quotation_items.length }} productos
              </p>

              <div class="space-y-2">
                @for (item of quotation()!.quotation_items; track item.id) {
                  <div class="p-3 sm:p-4 bg-[var(--color-surface)] rounded-xl border border-border hover:border-gray-300 transition-colors">
                    <div class="flex items-center gap-3 sm:gap-4">
                      <!-- Product Image -->
                      <div class="w-11 h-11 sm:w-14 sm:h-14 bg-surface rounded-lg flex-shrink-0 flex items-center justify-center border border-border overflow-hidden">
                        @if (item.product?.image_url) {
                          <img [src]="item.product.image_url" class="w-full h-full object-cover" />
                        } @else {
                          <app-icon name="image" size="20" class="text-gray-300 sm:[--icon-size:24px]"></app-icon>
                        }
                      </div>
                      <!-- Product Info -->
                      <div class="flex-1 min-w-0">
	                        <h3 class="text-sm sm:text-base font-semibold text-gray-900 truncate">{{ item.product_name }}</h3>
	                        <p class="text-[11px] font-mono text-gray-400 mt-0.5">SKU: {{ item.variant_sku || 'N/A' }}</p>
	                        @if (item.applied_price_tier_name_snapshot) {
	                          <span
	                            class="mt-2 inline-flex w-fit rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
	                            title="Snapshot inmutable de la tarifa aplicada"
	                          >
	                            Tarifa: {{ item.applied_price_tier_name_snapshot }}
	                          </span>
	                        }
	                      </div>
                      <!-- Price -->
                      <div class="text-right flex-shrink-0">
                        <p class="font-bold text-gray-900 text-sm sm:text-lg">{{ item.total_price || 0 | currency:(quotation()!.destination === 'contract' ? 2 : undefined) }}</p>
                        <p class="text-xs text-gray-500">{{ item.quantity }} x {{ item.unit_price || 0 | currency:(quotation()!.destination === 'contract' ? 2 : undefined) }}</p>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </app-card>

            <!-- Converted Order -->
            @if (quotation()!.converted_order) {
              <app-card shadow="sm" [responsivePadding]="true">
                <div class="rounded-xl p-3 sm:p-4" style="background: var(--color-accent-light); border: 1px solid rgba(var(--color-primary-rgb), 0.2);">
                  <h3 class="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style="color: var(--color-secondary);">
                    <app-icon name="check-circle" size="14" style="color: var(--color-primary);"></app-icon>
                    Orden Generada
                  </h3>
                  <dl class="space-y-2 text-sm">
                    <div class="flex justify-between items-center">
                      <dt class="text-[var(--color-text-secondary)]">Número</dt>
                      <dd>
                        <a
                          [routerLink]="['/admin/orders', quotation()!.converted_order!.id]"
                          class="hover:underline font-medium"
                          style="color: var(--color-primary);"
                          aria-label="Ver orden {{ quotation()!.converted_order!.order_number }}">
                          {{ quotation()!.converted_order!.order_number }}
                          <app-icon name="arrow-right" [size]="14" class="inline-block ml-1"></app-icon>
                        </a>
                      </dd>
                    </div>
                    <div class="flex justify-between">
                      <dt class="text-[var(--color-text-secondary)]">Estado</dt>
                      <dd class="font-medium">{{ quotation()!.converted_order!.state }}</dd>
                    </div>
                    <div class="flex justify-between">
                      <dt class="text-[var(--color-text-secondary)]">Total</dt>
                      <dd class="font-bold font-mono">{{ quotation()!.converted_order!.grand_total || 0 | currency }}</dd>
                    </div>
                  </dl>
                </div>
              </app-card>
            }

            <!-- Notes -->
            @if (quotation()!.notes) {
              <app-card title="Notas" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ quotation()!.notes }}</p>
              </app-card>
            }

            @if (quotation()!.internal_notes) {
              <app-card title="Notas Internas" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ quotation()!.internal_notes }}</p>
              </app-card>
            }

            @if (quotation()!.terms_and_conditions) {
              <app-card title="Términos y Condiciones" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ quotation()!.terms_and_conditions }}</p>
              </app-card>
            }

            <!-- Timeline / History -->
            <app-card title="Línea de Tiempo" shadow="sm" [responsivePadding]="true">
              <app-timeline class="block pt-1" [steps]="timelineSteps()" [collapsible]="true"></app-timeline>
              @if (quotation()!.status === 'contracted' && quotation()!.contract) {
                <a [routerLink]="['/admin/orders/contracts', quotation()!.contract!.id]" class="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary-700 underline">
                  Ver contrato {{ quotation()!.contract!.contract_number }}
                </a>
              }
            </app-card>

          </div>

          <!-- RIGHT COLUMN (SIDEBAR) -->
          <div class="flex flex-col gap-3 lg:pt-0 pt-1">

            <!-- Quotation Progress -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">
                Progreso de Cotización
              </h2>
              <app-timeline [steps]="timelineSteps()" [collapsible]="true"
                expand_label="Ver progreso completo" collapse_label="Ocultar progreso" />
            </app-card>

            <!-- General Info -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Información General</h2>
              <dl class="space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Canal</dt>
                  <dd class="font-semibold text-gray-900">{{ quotation()!.channel }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Válida hasta</dt>
                  <dd class="font-semibold text-gray-900">{{ quotation()!.valid_until ? (quotation()!.valid_until | date:'dd/MM/yyyy') : 'Sin fecha' }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Creada</dt>
                  <dd class="font-semibold text-gray-900">{{ quotation()!.created_at | date:'dd/MM/yyyy HH:mm' }}</dd>
                </div>
                @if (quotation()!.created_by_user) {
                  <div class="flex justify-between items-center">
                    <dt class="text-text-secondary">Creada por</dt>
                    <dd class="font-semibold text-gray-900">{{ quotation()!.created_by_user!.first_name }} {{ quotation()!.created_by_user!.last_name }}</dd>
                  </div>
                }
              </dl>
            </app-card>

            <!-- Actions -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Acciones</h2>
              @if (visibleActions().length > 0) {
                <div class="space-y-2">
                  @for (action of visibleActions(); track action.id) {
                    <app-button
                      [variant]="action.variant"
                      [fullWidth]="true"
                      [disabled]="actionLoading() !== null"
                      [loading]="actionLoading() === action.id"
                      (clicked)="onHeaderAction(action.id)"
                    >
                      @if (action.icon) {
                        <app-icon slot="icon" [name]="action.icon" size="16"></app-icon>
                      }
                      {{ action.label }}
                    </app-button>
                  }
                </div>
              } @else {
                <div class="text-[10px] text-center text-text-secondary font-bold uppercase tracking-widest bg-[var(--color-surface)] py-3 rounded-xl border border-dashed border-border">
                  No hay acciones disponibles
                </div>
              }

              @if (canProcessAll()) {
                <div class="mt-4 pt-4 border-t border-border">
                  <label class="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      [checked]="processAllEnabled()"
                      (change)="processAllEnabled.set($any($event.target).checked)"
                      class="mt-0.5"
                    />
                    <div>
                      <p class="text-sm font-bold text-amber-800">Procesar cotización completa</p>
                      <p class="text-xs text-text-secondary mt-0.5">
                        Ejecuta en cadena los pasos pendientes: enviar al correo del cliente, aceptar y convertir en orden.
                        Si algún paso falla, podrás reintentar desde el último estado completado.
                      </p>
                    </div>
                  </label>

                  @if (processAllEnabled()) {
                    <app-button
                      variant="outline-warning"
                      [fullWidth]="true"
                      customClasses="mt-2"
                      [disabled]="actionLoading() !== null"
                      [loading]="actionLoading() === 'process-all'"
                      (clicked)="onProcessAll()"
                    >
                      <app-icon slot="icon" name="zap" size="16"></app-icon>
                      Confirmar y procesar todo
                    </app-button>
                  }
                </div>
              }
            </app-card>

            <!-- Payment Summary -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Resumen</h2>
              <div class="space-y-2.5">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Subtotal</span>
                  <span class="font-semibold text-gray-900">{{ summaryAmount('gross_subtotal', quotation()!.subtotal_amount) !== null ? (summaryAmount('gross_subtotal', quotation()!.subtotal_amount)! | currency:(quotation()!.destination === 'contract' ? 2 : undefined)) : 'No configurado · revisar' }}</span>
                </div>
                @if (summaryAmount('discount_amount', quotation()!.discount_amount) !== null && summaryAmount('discount_amount', quotation()!.discount_amount)! > 0) {
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-text-secondary">Descuento</span>
                    <span class="font-semibold text-green-600">-{{ summaryAmount('discount_amount', quotation()!.discount_amount)! | currency:(quotation()!.destination === 'contract' ? 2 : undefined) }}</span>
                  </div>
                }
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Impuestos</span>
                  <span class="font-semibold text-gray-900">{{ summaryAmount('tax_amount', quotation()!.tax_amount) !== null ? (summaryAmount('tax_amount', quotation()!.tax_amount)! | currency:(quotation()!.destination === 'contract' ? 2 : undefined)) : 'No configurado · revisar' }}</span>
                </div>
                @if (quotation()!.shipping_cost > 0) {
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-text-secondary">Envío</span>
                    <span class="font-semibold text-gray-900">{{ quotation()!.shipping_cost || 0 | currency:(quotation()!.destination === 'contract' ? 2 : undefined) }}</span>
                  </div>
                }
                <div class="pt-3 mt-1 border-t border-border flex justify-between items-center">
                  <span class="text-base font-bold text-gray-900">Total</span>
                  <span class="text-xl sm:text-2xl font-black text-primary-600 font-mono tracking-tighter">
                    {{ summaryAmount('total_amount', quotation()!.grand_total) !== null ? (summaryAmount('total_amount', quotation()!.grand_total)! | currency:(quotation()!.destination === 'contract' ? 2 : undefined)) : 'No configurado · revisar' }}
                  </span>
                </div>
              </div>
              <!-- Print button -->
              <div class="pt-4 space-y-2">
                <app-button variant="secondary" [fullWidth]="true" (clicked)="printQuotation()" customClasses="!bg-gray-900 hover:!bg-[var(--color-neutral-800)] !text-[var(--color-neutral-50)] !shadow-md">
                  <app-icon slot="icon" name="printer" size="16"></app-icon>
                  Imprimir Cotización
                </app-button>
              </div>
            </app-card>

          </div>
        </div>
      </div>
    }
  `,
  styles: [],
})
export class QuotationDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly quotationsService = inject(QuotationsService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly printService = inject(QuotationPrintService);
  private readonly authFacade = inject(AuthFacade);
  private readonly contractsService = inject(ContractsService);

  readonly quotation = signal<Quotation | null>(null);
  readonly loading = signal(true);
  readonly actionLoading = signal<string | null>(null);
  readonly processAllEnabled = signal(false);
  private readonly contractCreationInProgress = signal(false);
  readonly canCreateContract = computed(() =>
    this.authFacade.storeIndustries().includes('construction') &&
    (this.authFacade.userPermissions().includes('store:contracts:create') ||
      this.authFacade.userRoles().includes('super_admin') || this.authFacade.userRoles().includes('SUPER_ADMIN')),
  );
  readonly canConvertToOrder = computed(() =>
    this.authFacade.userPermissions().includes('store:quotations:convert') ||
      this.authFacade.userRoles().includes('super_admin') || this.authFacade.userRoles().includes('SUPER_ADMIN'),
  );
  readonly canMutateQuotation = computed(() =>
    this.authFacade.userPermissions().includes('store:quotations:update') ||
      this.authFacade.userRoles().includes('super_admin') || this.authFacade.userRoles().includes('SUPER_ADMIN'),
  );

  readonly contractEconomicLines = computed<ContractEconomicLineDisplay[]>(() => {
    const snapshot = this.quotation()?.contract_economic_snapshot;
    if (!snapshot) return [];
    return snapshot.invoice_lines.map((frozen, index) => ({
      frozen,
      calculation: snapshot.calculation.lines?.[index] ?? null,
    }));
  });

  /** Decimal parsing is for presentation only; all monetary values are frozen server outputs. */
  displayMoney(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const amount = Number(value);
      return Number.isFinite(amount) ? amount : null;
    }
    return null;
  }

  summaryAmount(key: 'gross_subtotal' | 'discount_amount' | 'tax_amount' | 'total_amount', saleValue: number): number | null {
    const quotation = this.quotation();
    if (quotation?.destination !== 'contract') return this.displayMoney(saleValue);
    return this.displayMoney(quotation.contract_economic_snapshot?.calculation.totals[key]);
  }

  snapshotTotal(
    snapshot: NonNullable<Quotation['contract_economic_snapshot']>,
    key: 'gross_subtotal' | 'discount_amount' | 'tax_amount' | 'total_amount',
  ): number | null {
    return this.displayMoney(snapshot.calculation.totals[key]);
  }

  lineAmount(line: Record<string, unknown> | null, key: string): unknown {
    return line?.[key];
  }

  lineTaxes(line: Record<string, unknown> | null): Record<string, unknown>[] {
    const taxes = line?.['taxes'];
    return Array.isArray(taxes)
      ? taxes.filter((tax): tax is Record<string, unknown> => !!tax && typeof tax === 'object' && !Array.isArray(tax))
      : [];
  }

  taxName(tax: Record<string, unknown>): string {
    return typeof tax['tax_name'] === 'string' ? tax['tax_name'] : 'Impuesto';
  }

  displayTaxRate(tax: Record<string, unknown>): string | null {
    const rate = this.displayMoney(tax['tax_rate']);
    if (rate === null) return null;
    const percent = tax['rate_basis'] === 'fraction' ? rate * 100 : rate;
    return Number.isFinite(percent) ? `${percent}%` : null;
  }

  economicBucketLabel(bucket: string): string {
    const labels: Record<string, string> = {
      administracion: 'Administración',
      imprevistos: 'Imprevistos',
      utilidad: 'Utilidad',
      costo: 'Costo directo',
      contrato: 'Contrato',
    };
    return labels[bucket] ?? bucket;
  }

  formatPercent(value: string | number | null | undefined): string {
    return value === null || value === undefined || value === '' ? 'No configurado · revisar' : `${value}%`;
  }

  taxableBasisLabel(value: string | null | undefined): string {
    const labels: Record<string, string> = { aiu: 'AIU', utilidad: 'Utilidad', subtotal: 'Subtotal' };
    if (value === 'et_462_1') return 'AIU';
    if (value === 'decreto_1372_1992') return 'Utilidad';
    return value ? labels[value] ?? value : 'No configurado · revisar';
  }

  componentsBasisLabel(value: string | null | undefined): string {
    if (value === 'contract') return 'Porcentaje del contrato';
    if (value === 'aiu') return 'Porcentaje del AIU';
    return 'No configurado · revisar';
  }

  accountingModelLabel(value: string | null | undefined): string {
    if (value === 'sumada') return 'Sumada';
    if (value === 'no_sumada') return 'No sumada';
    return 'No configurado · revisar';
  }

  formatFrozenDate(value: string): string {
    return formatDateOnlyUTC(value);
  }

  readonly statusLabel = computed(() => {
    const q = this.quotation();
    return q ? STATUS_LABELS[q.status] || q.status : '';
  });

  readonly statusBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const q = this.quotation();
    return q ? STATUS_BADGE_COLORS[q.status] || 'gray' : 'gray';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const q = this.quotation();
    if (!q) return [];
    const currentAction = this.actionLoading();
    return [
      {
        id: 'send',
        label: 'Enviar',
        variant: 'primary' as const,
        icon: 'send',
        visible: this.canMutateQuotation() && q.status === 'draft',
        loading: currentAction === 'send',
        disabled: currentAction !== null,
      },
      {
        id: 'accept',
        label: 'Aceptar',
        variant: 'primary' as const,
        icon: 'check-circle',
        visible: this.canMutateQuotation() && q.status === 'sent',
        loading: currentAction === 'accept',
        disabled: currentAction !== null,
      },
      {
        id: 'reject',
        label: 'Rechazar',
        variant: 'danger' as const,
        icon: 'x-circle',
        visible: this.canMutateQuotation() && q.status === 'sent',
        loading: currentAction === 'reject',
        disabled: currentAction !== null,
      },
      {
        id: 'convert',
        label: 'Convertir a Orden',
        variant: 'primary' as const,
        icon: 'shopping-cart',
        visible: this.canConvertToOrder() && (q.destination === undefined || q.destination === 'sale') && q.status === 'accepted',
        loading: currentAction === 'convert',
        disabled: currentAction !== null,
      },
      {
        id: 'create-contract',
        label: 'Crear contrato',
        variant: 'primary' as const,
        icon: 'file-text',
        visible: this.canCreateContract() && q.destination === 'contract' && q.status === 'accepted',
        loading: currentAction === 'create-contract',
        disabled: currentAction !== null,
      },
      {
        id: 'duplicate',
        label: 'Duplicar',
        variant: 'outline' as const,
        icon: 'copy',
        visible: this.authFacade.userPermissions().includes('store:quotations:create') || this.authFacade.userRoles().includes('super_admin') || this.authFacade.userRoles().includes('SUPER_ADMIN'),
        loading: currentAction === 'duplicate',
        disabled: currentAction !== null,
      },
      {
        id: 'cancel',
        label: 'Cancelar',
        variant: 'outline-danger' as const,
        icon: 'x-circle',
        visible: this.canMutateQuotation() && ['draft', 'sent', 'accepted'].includes(q.status),
        loading: currentAction === 'cancel',
        disabled: currentAction !== null,
      },
    ];
  });

  readonly visibleActions = computed(() => {
    return this.headerActions().filter(a => a.visible);
  });

  readonly canProcessAll = computed(() => {
    const q = this.quotation();
    return !!q && this.canMutateQuotation() && this.canConvertToOrder() && (q.destination === undefined || q.destination === 'sale') && ['draft', 'sent', 'accepted'].includes(q.status);
  });

  readonly timelineSteps = computed<TimelineStep[]>(() => {
    const q = this.quotation();
    if (!q) return [];

    const steps: TimelineStep[] = [
      {
        key: 'created',
        label: 'Creada',
        status: 'completed',
        variant: 'default',
        date: q.created_at,
        description: q.created_by_user
          ? `Por ${q.created_by_user.first_name} ${q.created_by_user.last_name}`
          : undefined,
      },
    ];

    if (q.sent_at) {
      steps.push({
        key: 'sent',
        label: 'Enviada',
        status: 'completed',
        variant: 'default',
        date: q.sent_at,
      });
    } else if (q.status === 'draft') {
      steps.push({
        key: 'sent',
        label: 'Envío pendiente',
        status: 'upcoming',
        variant: 'default',
      });
    }

    if (q.accepted_at) {
      steps.push({
        key: 'accepted',
        label: 'Aceptada',
        status: 'completed',
        variant: 'success',
        date: q.accepted_at,
      });
    } else if (q.rejected_at) {
      steps.push({
        key: 'rejected',
        label: 'Rechazada',
        status: 'terminal',
        variant: 'danger',
        date: q.rejected_at,
      });
    } else if (q.status === 'sent') {
      steps.push({
        key: 'response',
        label: 'Esperando respuesta',
        status: 'current',
        variant: 'default',
      });
    }

    if (q.converted_at) {
      steps.push({
        key: 'converted',
        label: 'Convertida a orden',
        status: 'completed',
        variant: 'success',
        date: q.converted_at,
        description: q.converted_order ? `Orden ${q.converted_order.order_number}` : undefined,
      });
    } else if (q.status === 'accepted') {
      if (q.destination === 'contract') {
        steps.push({ key: 'contract', label: 'Pendiente de contrato', status: 'upcoming', variant: 'default' });
      } else if (q.destination !== 'other') {
        steps.push({ key: 'convert', label: 'Pendiente de conversión', status: 'upcoming', variant: 'default' });
      }
    }

    if (q.status === 'contracted') {
      steps.push({
        key: 'contracted', label: 'Contrato creado', status: 'completed', variant: 'success',
        description: q.contract ? `Contrato ${q.contract.contract_number}` : undefined,
      });
    }

    if (q.status === 'cancelled') {
      steps.push({
        key: 'cancelled',
        label: 'Cancelada',
        status: 'terminal',
        variant: 'danger',
      });
    }

    if (q.status === 'expired') {
      steps.push({
        key: 'expired',
        label: 'Expirada',
        status: 'terminal',
        variant: 'warning',
      });
    }

    return steps;
  });

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadQuotation(id);
    }
  }

  printQuotation(): void {
    const q = this.quotation();
    if (q) {
      this.printService.printQuotation(q);
    }
  }

  onHeaderAction(actionId: string): void {
    switch (actionId) {
      case 'send':
        this.onSend();
        break;
      case 'accept':
        this.onAccept();
        break;
      case 'reject':
        this.onReject();
        break;
      case 'convert':
        this.onConvert();
        break;
      case 'create-contract':
        this.onCreateContract();
        break;
      case 'cancel':
        this.onCancel();
        break;
      case 'duplicate':
        this.onDuplicate();
        break;
    }
  }

  private loadQuotation(id: number): void {
    this.loading.set(true);
    this.quotationsService
      .getQuotationById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (q) => {
          this.quotation.set(q);
          this.loading.set(false);
        },
        error: (err) => {
          this.toastService.error(err.message || 'Error al cargar la cotización');
          this.loading.set(false);
        },
      });
  }

  private onSend(): void {
    this.performAction('send', () =>
      this.quotationsService.sendQuotation(this.quotation()!.id),
    );
  }

  private onAccept(): void {
    this.performAction('accept', () =>
      this.quotationsService.acceptQuotation(this.quotation()!.id),
    );
  }

  private async onReject(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Rechazar cotización',
      message: '¿Estás seguro de que deseas rechazar esta cotización? Esta acción no se puede deshacer.',
      confirmText: 'Rechazar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.performAction('reject', () =>
      this.quotationsService.rejectQuotation(this.quotation()!.id),
    );
  }

  private async onCancel(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar cotización',
      message: '¿Estás seguro de que deseas cancelar esta cotización? Esta acción no se puede deshacer.',
      confirmText: 'Cancelar cotización',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.performAction('cancel', () =>
      this.quotationsService.cancelQuotation(this.quotation()!.id),
    );
  }

  private async onConvert(): Promise<void> {
    if (!this.canConvertToOrder()) return;
    const quotation = this.quotation();
    if (!quotation || (quotation.destination !== undefined && quotation.destination !== 'sale')) {
      this.toastService.error('Solo las cotizaciones de venta pueden convertirse en orden.');
      return;
    }
    const blockedMessage = this.getConvertBlockedMessage();
    if (blockedMessage) {
      this.toastService.error(blockedMessage);
      return;
    }

    const confirmed = await this.dialogService.confirm({
      title: 'Convertir a orden',
      message: '¿Deseas convertir esta cotización directamente en una orden de venta? La cotización quedará marcada como convertida.',
      confirmText: 'Convertir',
      cancelText: 'Cancelar',
      confirmVariant: 'primary',
    });
    if (!confirmed) return;
    this.performAction('convert', () =>
      this.quotationsService.convertToOrder(this.quotation()!.id),
    );
  }

  private async onCreateContract(): Promise<void> {
    const q = this.quotation();
    if (!q || !this.canCreateContract() || q.destination !== 'contract' || q.status !== 'accepted' || this.contractCreationInProgress()) return;
    this.contractCreationInProgress.set(true);
    const confirmed = await this.dialogService.confirm({
      title: 'Crear contrato',
      message: `¿Crear un contrato desde la cotización ${q.quotation_number}?`,
      confirmText: 'Crear contrato',
      cancelText: 'Volver',
    });
    if (!confirmed) {
      this.contractCreationInProgress.set(false);
      return;
    }
    this.actionLoading.set('create-contract');
    this.contractsService.createFromQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.actionLoading.set(null)))
      .subscribe({
        next: (contract) => this.router.navigate(['/admin/orders/contracts', contract.id]),
        error: (error) => {
          this.contractCreationInProgress.set(false);
          const contractId = Number(error?.details?.contract_id);
          if (error?.code === 'QUOTE_CONTRACT_001' && Number.isInteger(contractId) && contractId > 0) {
            this.quotationsService.invalidateCache();
            this.router.navigate(['/admin/orders/contracts', contractId]);
            return;
          }
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }

  private onDuplicate(): void {
    this.actionLoading.set('duplicate');
    this.quotationsService
      .duplicateQuotation(this.quotation()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dup) => {
          this.actionLoading.set(null);
          this.toastService.success('Cotización duplicada exitosamente');
          this.router.navigate(['/admin/orders/quotations', dup.id]);
        },
        error: (err) => {
          this.actionLoading.set(null);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  async onProcessAll(): Promise<void> {
    const q = this.quotation();
    if (!q || !this.canMutateQuotation() || !this.canConvertToOrder() || (q.destination !== undefined && q.destination !== 'sale')) return;

    const blockedMessage = this.getProcessAllBlockedMessage(q);
    if (blockedMessage) {
      this.toastService.error(blockedMessage);
      return;
    }

    const confirmed = await this.dialogService.confirm({
      title: 'Procesar cotización completa',
      message: this.getProcessAllConfirmMessage(q),
      confirmText: 'Procesar todo',
      cancelText: 'Cancelar',
      confirmVariant: 'primary',
    });
    if (!confirmed) return;

    this.actionLoading.set('process-all');
    this.quotationsService
      .processCompleteQuotation(q)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.actionLoading.set(null)),
      )
      .subscribe({
        next: (result) => {
          this.quotation.set(result);
          this.quotationsService.invalidateCache();
          this.processAllEnabled.set(false);
          this.toastService.success('Cotización procesada y convertida a orden exitosamente');
        },
        error: (err) => {
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  private performAction(actionId: string, action: () => Observable<Quotation>): void {
    this.actionLoading.set(actionId);
    action()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: Quotation) => {
          if (result && (result as any).success === false) {
            this.actionLoading.set(null);
            this.toastService.error((result as any).message || 'Error al realizar la acción');
            return;
          }
          this.quotation.set(result);
          this.actionLoading.set(null);
          this.quotationsService.invalidateCache();
          this.toastService.success(`Cotización ${STATUS_LABELS[result.status as QuotationStatus]?.toLowerCase() || 'actualizada'} exitosamente`);
        },
        error: (err: any) => {
          this.actionLoading.set(null);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  private getConvertBlockedMessage(): string | null {
    const q = this.quotation();
    if (!q || ((q.destination === undefined || q.destination === 'sale') && q.status === 'accepted')) {
      return null;
    }

    if (q.status === 'draft') {
      return 'Antes de convertirla en orden, envía la cotización y márcala como aceptada.';
    }

    if (q.status === 'sent') {
      return 'Antes de convertirla en orden, márcala como aceptada cuando el cliente la apruebe.';
    }

    return 'Solo las cotizaciones aceptadas pueden convertirse en orden.';
  }

  private getProcessAllBlockedMessage(q: Quotation): string | null {
    if (q.destination !== undefined && q.destination !== 'sale') return 'El proceso completo solo aplica a cotizaciones de venta.';
    if (!['draft', 'sent', 'accepted'].includes(q.status)) {
      return 'Solo las cotizaciones en borrador, enviadas o aceptadas pueden procesarse en este flujo.';
    }

    if (!q.customer_id) {
      return 'Asigna un cliente a esta cotización antes de procesarla completa.';
    }

    if (q.status === 'draft' && !q.customer?.email) {
      return 'Agrega un correo al cliente antes de enviar y procesar esta cotización.';
    }

    return null;
  }

  private getProcessAllConfirmMessage(q: Quotation): string {
    const steps: string[] = [];
    if (q.status === 'draft') {
      steps.push('enviar la cotización al correo del cliente');
    }
    if (q.status === 'draft' || q.status === 'sent') {
      steps.push('marcarla como aceptada');
    }
    steps.push('convertirla en orden');

    return `Se ejecutará en cadena: ${steps.join(', ')}. Si un paso falla, podrás reintentar desde el último estado completado.`;
  }
}
