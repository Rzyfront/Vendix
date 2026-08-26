import { Component, OnInit, computed, inject, signal, DestroyRef, effect } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
  StickyHeaderComponent,
  AddressFormFieldsComponent,
} from '../../../../../../shared/components/index';
import type { AddressPayload } from '../../../../../../shared/components/index';
import { computeNitDv } from '../../../../../../shared/utils/nit.util';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import {
  BillingAddressSource,
  BillingProfile,
  BillingProfileStatus,
  StoreSubscriptionService,
} from '../../services/store-subscription.service';
import { CheckoutPreviewResponse, SubscriptionPlan } from '../../interfaces/store-subscription.interface';
import {
  WompiCheckoutService,
  WompiWidgetConfig,
} from '../../../../../../core/services/wompi-checkout.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { markdownToHtml } from '../../../../../../shared/utils/markdown.util';

// S2.1 — Map backend coupon validation `reason` codes to user-facing
// Spanish copy. Kept inline (rather than i18n keys) to match the existing
// component pattern; consider extraction if i18n gets standardized.
const COUPON_REASON_COPY: Record<string, string> = {
  not_found: 'Cupón no encontrado',
  expired: 'Cupón expirado o aún no vigente',
  already_used: 'Este cupón ya fue redimido en esta tienda',
  not_eligible: 'Tu tienda no cumple los requisitos del cupón',
  invalid_state: 'El cupón está deshabilitado',
  network_error: 'Error de red al validar el cupón',
};

// Códigos DIAN de tipo de documento del adquiriente. Las claves deben coincidir
// con los `<option value>` del formulario y con BILLING_DOCUMENT_TYPES del DTO.
const BILLING_DOCUMENT_LABELS: Record<string, string> = {
  '31': 'NIT',
  '13': 'Cédula de ciudadanía',
  '22': 'Cédula de extranjería',
  '41': 'Pasaporte',
};

/** Código DIAN del NIT. Es el único documento que lleva dígito de verificación. */
const BILLING_DOCUMENT_TYPE_NIT = '31';

/**
 * Copia que explica de dónde salió la dirección precargada.
 *
 * `fiscal` no se anuncia: es el caso esperado y decirlo sería ruido. Los otros
 * dos SÍ, porque son un respaldo — el cliente tiene que poder ver que la
 * dirección propuesta no es la que declaró como fiscal antes de pagar con ella.
 */
const BILLING_ADDRESS_SOURCE_COPY: Partial<Record<BillingAddressSource, string>> = {
  shipping:
    'Precargamos una dirección que ya tienes registrada, pero no está marcada como tu dirección de facturación. Revísala antes de continuar.',
  store:
    'Precargamos la dirección de tu tienda porque no encontramos una dirección de facturación. Revísala antes de continuar.',
};

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CardComponent,
    ButtonComponent,
    IconComponent,
    DatePipe,
    CurrencyPipe,
    RouterLink,
    ReactiveFormsModule,
    StickyHeaderComponent,
    AddressFormFieldsComponent,
  ],
  template: `
    <div class="w-full space-y-6">
      <!-- Header -->
      <app-sticky-header
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        icon="credit-card"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/subscription/plans"
      ></app-sticky-header>

      <!-- Loading skeleton -->
      @if (loadingPreview()) {
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-6 animate-pulse" aria-busy="true">
          <div class="space-y-4">
            <div class="h-8 w-1/2 bg-gray-200 rounded"></div>
            <div class="h-4 w-2/3 bg-gray-200 rounded"></div>
            <div class="space-y-2 mt-4">
              <div class="h-4 bg-gray-200 rounded"></div>
              <div class="h-4 bg-gray-200 rounded"></div>
              <div class="h-4 bg-gray-200 rounded w-3/4"></div>
            </div>
          </div>
          <div class="space-y-3">
            <div class="h-6 bg-gray-200 rounded"></div>
            <div class="h-4 bg-gray-200 rounded"></div>
            <div class="h-4 bg-gray-200 rounded"></div>
            <div class="h-12 bg-gray-200 rounded mt-6"></div>
          </div>
        </div>
      }

      <!-- Free plan variant -->
      @if (!loadingPreview() && freePlan(); as fp) {
        <app-card customClasses="border border-primary/30 bg-gradient-to-br from-primary-50 to-white shadow-md">
          <div class="p-6 md:p-8 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg">
              <app-icon name="sparkles" [size]="32" class="text-white"></app-icon>
            </div>
            <h2 class="text-2xl font-extrabold text-text-primary">{{ fp.plan.name }}</h2>
            <p class="text-3xl font-extrabold text-primary">Gratis</p>
            <p class="text-sm text-text-secondary max-w-md mx-auto">
              Este plan no genera ningún cargo. Tu próxima facturación será gratuita.
            </p>

            <div class="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <app-button variant="ghost" (clicked)="goBack()">Cancelar</app-button>
              <app-button
                variant="primary"
                [loading]="committing()"
                [disabled]="committing()"
                (clicked)="confirmCheckout()"
              >
                <app-icon name="check" [size]="16" slot="icon" ></app-icon>
                Activar plan gratuito
              </app-button>
            </div>
          </div>
        </app-card>
      }

      <!-- S3.4 — Trial plan-swap variant. Free deferred change: keeps the
           remaining trial and starts billing at trial_ends_at. No no-refund
           checkbox; copy is softer; CTA is "Confirmar cambio". -->
      @if (!loadingPreview() && trialSwapInfo(); as ts) {
        <app-card customClasses="border border-blue-200 bg-gradient-to-br from-blue-50 to-white shadow-md">
          <div class="p-6 md:p-8 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg">
              <app-icon name="arrow-right-left" [size]="32" class="text-white"></app-icon>
            </div>
            <h2 class="text-2xl font-extrabold text-text-primary">Cambio de plan durante prueba</h2>
            <p class="text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
              Cambiarás de <strong>{{ ts.old_plan.name }}</strong> a <strong>{{ ts.new_plan.name }}</strong>.
              Tu prueba sigue activa hasta
              <strong>{{ ts.trial_ends_at | date:'mediumDate':'-0500':'es-CO' }}</strong>,
              sin cobros.
            </p>

            <div class="grid grid-cols-2 gap-3 max-w-md mx-auto">
              <div class="p-4 bg-gray-50 rounded-xl text-left">
                <p class="text-xs text-text-secondary mb-1">Plan actual</p>
                <p class="text-sm font-bold text-text-primary truncate">{{ ts.old_plan.name }}</p>
              </div>
              <div class="p-4 bg-blue-100/50 rounded-xl border border-blue-200 text-left">
                <p class="text-xs text-text-secondary mb-1">Nuevo plan</p>
                <p class="text-sm font-bold text-blue-900 truncate">{{ ts.new_plan.name }}</p>
              </div>
            </div>

            <div class="flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-lg max-w-xl mx-auto text-left">
              <app-icon name="info" [size]="18" class="text-blue-600 mt-0.5 shrink-0"></app-icon>
              <div class="space-y-1">
                <p class="text-xs text-blue-900">
                  <strong>Próximo cargo:</strong>
                  {{ ts.trial_ends_at | date:'mediumDate':'-0500':'es-CO' }}
                  por
                  {{ asNumber(ts.new_effective_price) | currency:'COP':'symbol-narrow':'1.0-0' }}/mes
                </p>
                <p class="text-xs text-blue-900/80">
                  Puedes cancelar la renovación automática en cualquier momento desde tu panel.
                </p>
              </div>
            </div>

            <div class="pt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <app-button variant="ghost" (clicked)="goBack()">Cancelar</app-button>
              <app-button
                variant="primary"
                [loading]="committing()"
                [disabled]="committing()"
                (clicked)="confirmCheckout()"
              >
                <app-icon name="check" [size]="16" slot="icon" ></app-icon>
                Confirmar cambio
              </app-button>
            </div>
          </div>
        </app-card>
      }

      <!-- Paid plan variant -->
      @if (!loadingPreview() && !trialSwapInfo() && proration(); as p) {
        <!-- S3.5 — Scheduled-cancel revert notice. Surfaced when the source
             sub has scheduled_cancel_at; the commit clears it and restores
             auto_renew so the user must understand the implicit revert. -->
        @if (p.voids_scheduled_cancel?.active) {
          <div class="flex items-start gap-3 p-4 bg-amber-50 border-l-4 border-amber-400 rounded-r-xl mb-6">
            <app-icon name="info" [size]="20" class="text-amber-700 mt-0.5 shrink-0"></app-icon>
            <div class="space-y-1 min-w-0">
              <p class="text-sm font-semibold text-amber-900">
                Esta compra revertirá tu cancelación programada
              </p>
              <p class="text-xs text-amber-900/90 leading-relaxed">
                Tienes una cancelación programada para el
                <strong>{{ p.voids_scheduled_cancel?.scheduled_at | date:'mediumDate':'-0500':'es-CO' }}</strong>.
                Al confirmar este cambio, la cancelación queda sin efecto y se
                reanuda la auto-renovación de tu suscripción.
              </p>
            </div>
          </div>
        }

        <div class="grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-6">
          <!-- Left: Plan detail + proration kind -->
          <app-card>
            <div class="p-5 md:p-6 space-y-5">
              <!-- Plan detail header -->
              @if (selectedPlan(); as sp) {
                <div class="flex flex-col sm:flex-row gap-4">
                  <div class="flex-1 min-w-0 space-y-2">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h2 class="text-lg md:text-xl font-extrabold text-text-primary truncate">{{ sp.name }}</h2>
                      @if (sp.is_popular) {
                        <span class="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">
                          Recomendado
                        </span>
                      }
                    </div>
                    @if (sp.description) {
                      <p class="text-xs md:text-sm text-text-secondary leading-relaxed">{{ sp.description }}</p>
                    }
                    @if (sp.features.length > 0) {
                      <ul class="flex flex-wrap gap-x-4 gap-y-1">
                        @for (f of sp.features; track f.key) {
                          <li class="flex items-center gap-1.5 text-xs text-text-primary">
                            <app-icon
                              [name]="f.enabled ? 'check-circle-2' : 'minus'"
                              [size]="14"
                              [class.text-primary-600]="f.enabled"
                              [class.opacity-40]="!f.enabled"
                              class="shrink-0"
                            ></app-icon>
                            <span [class.text-text-secondary]="!f.enabled">{{ f.label }}</span>
                            @if (f.limit !== null && f.limit !== undefined) {
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                                {{ f.limit }}{{ f.unit ? ' ' + f.unit : '' }}
                              </span>
                            }
                          </li>
                        }
                      </ul>
                    }
                  </div>
                  <div class="sm:border-l sm:border-border sm:pl-4 flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0">
                    <div class="text-right">
                      <span class="text-2xl md:text-3xl font-extrabold text-primary leading-none">
                        {{ sp.base_price | currency:sp.currency:'symbol':'1.0-0' }}
                      </span>
                      <p class="text-xs text-text-secondary mt-1">/{{ cycleLabel(sp.billing_cycle) }}</p>
                    </div>
                    @if (sp.is_free) {
                      <span class="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                        Sin costo
                      </span>
                    }
                  </div>
                </div>

                <!-- Detalles enriquecidos del plan (Markdown del super-admin).
                     Se renderiza el STRING HTML directamente con [innerHTML];
                     Angular lo sanitiza automáticamente. No usar
                     bypassSecurityTrustHtml. -->
                @if (detailsHtml(); as html) {
                  <div
                    class="prose prose-sm max-w-none markdown-preview text-sm text-text-primary"
                    [innerHTML]="html"
                  ></div>
                }

                <div class="border-t border-border"></div>
              }

              <!-- Change type — compact inline -->
              <div class="flex items-center gap-2">
                <app-icon
                  [name]="p.kind === 'upgrade' ? 'trending-up' : p.kind === 'downgrade' ? 'trending-down' : p.kind === 're_subscribe' ? 'refresh-cw' : 'arrow-right-left'"
                  [size]="14"
                  [class.text-green-600]="p.kind === 'upgrade'"
                  [class.text-blue-600]="p.kind === 'same-tier'"
                  [class.text-amber-600]="p.kind === 'downgrade'"
                  [class.text-blue-600]="p.kind === 're_subscribe'"
                ></app-icon>
                <span
                  class="text-xs font-semibold"
                  [class.text-green-700]="p.kind === 'upgrade'"
                  [class.text-blue-700]="p.kind === 'same-tier'"
                  [class.text-amber-700]="p.kind === 'downgrade'"
                  [class.text-blue-700]="p.kind === 're_subscribe'"
                >
                  {{ kindLabel(p.kind) }}
                </span>
              </div>

              @if (isResubscribe()) {
                <div class="p-3 bg-primary/10 rounded-xl border border-primary/20">
                  <p class="text-xs text-text-secondary mb-1">Plan a contratar</p>
                  <p class="text-lg font-bold text-primary">{{ asNumber(p.new_effective_price) | currency }}</p>
                  <p class="text-xs text-primary mt-1">por ciclo</p>
                </div>
                <div class="flex items-start gap-3 p-3 rounded-lg" style="background: var(--color-info-light); border: 1px solid color-mix(in srgb, var(--color-info) 20%, transparent);">
                  <app-icon name="info" [size]="18" style="color: var(--color-info);"></app-icon>
                  <p class="text-xs" style="color: var(--color-info);">
                    Iniciarás un <strong>ciclo nuevo</strong>. El cobro corresponde al
                    plan completo desde hoy hasta la próxima renovación.
                  </p>
                </div>
              } @else {
                <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div class="flex-1 min-w-0">
                    <p class="text-[10px] uppercase tracking-wide text-text-secondary">Actual</p>
                    <p class="text-sm font-bold text-text-primary truncate">{{ asNumber(p.old_effective_price) | currency }}<span class="font-normal text-text-secondary">/ciclo</span></p>
                  </div>
                  <app-icon name="arrow-right" [size]="16" class="text-text-secondary shrink-0"></app-icon>
                  <div class="flex-1 min-w-0">
                    <p class="text-[10px] uppercase tracking-wide text-text-secondary">Nuevo</p>
                    <p class="text-sm font-bold text-primary truncate">{{ asNumber(p.new_effective_price) | currency }}<span class="font-normal text-primary/70">/ciclo</span></p>
                  </div>
                </div>

                @if (daysRemainingInCycle() < currentCycleDays()) {
                  <div class="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                    <app-icon name="info" [size]="14" class="text-blue-600 mt-0.5 shrink-0"></app-icon>
                    <p class="text-xs text-blue-900">
                      Quedan <strong>{{ daysRemainingInCycle() }}</strong>/{{ currentCycleDays() }} días del ciclo — cobro prorrateado.
                    </p>
                  </div>
                }
              }

              <!-- G8 — Política de cobro y suscripción (paid plan).
                   Cubre: cobro recurrente automatizado, fecha del próximo
                   cobro (data-driven cuando hay invoice), no-reembolso,
                   posibilidad de cancelar la auto-renovación desde el panel.
                   S3.5 — Always visible: the commit either charges now or
                   voids a scheduled cancel (which restores future charges),
                   so the recurring-billing terms apply in both cases. The
                   no-refund checkbox is skipped at the CTA level when
                   chargeNow=0. -->
              <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 md:p-4 space-y-3">
                <div class="flex items-start gap-2">
                  <app-icon name="info" [size]="16" class="text-amber-700 mt-0.5 shrink-0"></app-icon>
                  <div class="space-y-2 min-w-0">
                    <h3 class="text-xs font-semibold text-amber-900">Política de cobro y suscripción</h3>
                    <ul class="text-xs text-amber-900 leading-relaxed space-y-1.5 list-disc pl-4">
                      <li>
                        <strong>Cobro recurrente:</strong>
                        se cobra automáticamente al final de cada ciclo mediante Wompi.
                      </li>
                      <li>
                        <strong>Método de pago:</strong>
                        la renovación automática solo funciona con tarjeta: al pagar
                        con tarjeta, Wompi la habilita para los cobros siguientes.
                        Con PSE, transferencia o efectivo el autopago queda pausado
                        hasta que registres una tarjeta.
                        Vendix no almacena el número completo de tu tarjeta ni el CVV.
                      </li>
                      <li>
                        <strong>No reembolsable:</strong>
                        los pagos no admiten devolución.
                      </li>
                      <li>
                        <strong>Cancelación:</strong>
                        puedes cancelar la auto-renovación cuando quieras desde tu panel.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </app-card>
          <app-card customClasses="lg:sticky lg:top-24 lg:self-start">
            <div class="p-5 md:p-6 space-y-4">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Resumen</h3>

              <div class="space-y-3" role="list">
                @if (asNumber(p.credit_to_apply_next_cycle) > 0) {
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">Crédito por tiempo restante</span>
                    <span class="text-sm font-medium text-green-600">
                      -{{ asNumber(p.credit_to_apply_next_cycle) | currency }}
                    </span>
                  </div>
                }
                @if (prorationDiscount() > 0) {
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">
                      Plan {{ targetCycleDays() }} días
                    </span>
                    <span class="text-sm font-medium text-text-primary">
                      {{ asNumber(p.new_effective_price) | currency }}
                    </span>
                  </div>
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">
                      Descuento prorrateado ({{ daysRemainingInCycle() }} de {{ currentCycleDays() }} días no usados)
                    </span>
                    <span class="text-sm font-medium text-green-600">
                      -{{ prorationDiscount() | currency }}
                    </span>
                  </div>
                }
                @if (chargeNow() > 0) {
                  <div class="flex justify-between items-center" role="listitem">
                    <span class="text-sm text-text-secondary">Cargo prorrateado</span>
                    <span class="text-sm font-medium text-text-primary">
                      {{ chargeNow() | currency }}
                    </span>
                  </div>
                }
              </div>

              <div class="border-t border-border pt-4">
                <div class="flex justify-between items-baseline">
                  <span class="text-sm font-semibold text-text-primary">Total a cobrar hoy</span>
                  <span
                    class="text-2xl font-extrabold"
                    [class.text-primary]="chargeNow() > 0"
                    [class.text-green-600]="chargeNow() === 0"
                  >
                    {{ chargeNow() > 0 ? (chargeNow() | currency) : 'Sin cargo' }}
                  </span>
                </div>
              </div>

              @if (invoice(); as inv) {
                <p class="text-xs text-text-secondary pt-2 border-t border-border/50">
                  Próxima facturación: {{ inv.period_end | date:'mediumDate' }} —
                  {{ asNumber(inv.total) | currency }}
                </p>
              }

              <!-- Datos fiscales del adquiriente. Aparece siempre que el commit
                   vaya a cobrar: si faltan datos se piden en formulario, y si ya
                   están en archivo se muestran en tarjeta compacta para que el
                   cliente confirme a nombre de quién sale la factura antes de
                   pagar. El DV no se pide — el backend lo deriva del NIT. -->
              @if (billingSectionVisible()) {
                <div class="pt-3 border-t border-border/50 space-y-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="space-y-1 min-w-0">
                      <h4 class="text-sm font-semibold text-text-primary">
                        Datos de facturación
                      </h4>
                      <p class="text-xs text-text-secondary leading-tight">
                        @if (billingFormVisible()) {
                          Emitimos factura electrónica ante la DIAN por este
                          cobro. Necesitamos los datos fiscales de tu empresa.
                        } @else {
                          Emitimos la factura electrónica de este cobro a nombre
                          de esta empresa.
                        }
                      </p>
                    </div>

                    <!-- Editar solo cuando el checkout es dueño del dato. Con el
                         módulo fiscal activo la identidad la administra ese
                         módulo y aquí sería una fuente de verdad paralela. -->
                    @if (billingSummaryVisible() && !billingProfileLocked()) {
                      <button
                        type="button"
                        (click)="startBillingEdit()"
                        class="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-primary hover:bg-primary/10 transition-colors"
                      >
                        <app-icon name="pencil" [size]="12"></app-icon>
                        Editar
                      </button>
                    }
                  </div>

                  <!-- Tarjeta compacta: confirma sin volver a pedir nada. -->
                  @if (billingSummaryVisible()) {
                    <div class="rounded-lg border border-border bg-background/60 p-3 space-y-2">
                      <div class="flex items-center gap-2 min-w-0">
                        <app-icon
                          name="building"
                          [size]="14"
                          class="text-text-secondary shrink-0"
                        ></app-icon>
                        <p class="text-sm font-medium text-text-primary truncate">
                          {{ billingLegalName() || '—' }}
                        </p>
                      </div>

                      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        <div class="min-w-0">
                          <dt class="text-text-secondary">{{ billingDocumentLabel() }}</dt>
                          <dd class="text-text-primary font-medium truncate">
                            {{ billingTaxIdDisplay() }}
                          </dd>
                        </div>
                        <div class="min-w-0">
                          <dt class="text-text-secondary">Ciudad</dt>
                          <dd class="text-text-primary font-medium truncate">
                            {{ billingCityDisplay() }}
                          </dd>
                        </div>
                        <div class="min-w-0 sm:col-span-2">
                          <dt class="text-text-secondary">Dirección</dt>
                          <dd class="text-text-primary font-medium truncate">
                            {{ billingAddressLine() || '—' }}
                          </dd>
                        </div>
                        @if (billingEmail()) {
                          <div class="min-w-0 sm:col-span-2">
                            <dt class="text-text-secondary">Correo de facturación</dt>
                            <dd class="text-text-primary font-medium truncate">
                              {{ billingEmail() }}
                            </dd>
                          </div>
                        }
                      </dl>

                      @if (billingProfileLocked()) {
                        <p class="flex items-start gap-1.5 pt-1 border-t border-border/50 text-xs text-text-secondary leading-tight">
                          <app-icon name="lock" [size]="12" class="shrink-0 mt-0.5"></app-icon>
                          <span>
                            Tu módulo fiscal administra esta identidad. Para
                            cambiarla, edítala en
                            <a
                              [routerLink]="'/admin/fiscal'"
                              class="font-medium text-primary hover:underline"
                              >Fiscal</a
                            >.
                          </span>
                        </p>
                      }
                    </div>
                  }

                  @if (billingFormVisible()) {
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label class="flex flex-col gap-1 sm:col-span-2">
                      <span class="text-xs font-medium text-text-secondary">Razón social</span>
                      <input
                        type="text"
                        [value]="billingLegalName()"
                        (input)="setBillingField(billingLegalName, $event)"
                        placeholder="Nombre legal registrado ante la DIAN"
                        class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                      />
                    </label>

                    <label class="flex flex-col gap-1">
                      <span class="text-xs font-medium text-text-secondary">Tipo de documento</span>
                      <select
                        [value]="billingDocumentType()"
                        (change)="setBillingField(billingDocumentType, $event)"
                        class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                      >
                        <option value="31">NIT</option>
                        <option value="13">Cédula de ciudadanía</option>
                        <option value="22">Cédula de extranjería</option>
                        <option value="41">Pasaporte</option>
                      </select>
                    </label>

                    <label class="flex flex-col gap-1">
                      <span class="text-xs font-medium text-text-secondary">Régimen de IVA</span>
                      <select
                        [value]="billingTaxRegime()"
                        (change)="setBillingField(billingTaxRegime, $event)"
                        class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                      >
                        <option value="49">No responsable de IVA</option>
                        <option value="48">Responsable de IVA</option>
                      </select>
                    </label>

                    <label class="flex flex-col gap-1" [class.sm:col-span-2]="!billingDocumentIsNit()">
                      <span class="text-xs font-medium text-text-secondary">Número</span>
                      <input
                        type="text"
                        inputmode="numeric"
                        [value]="billingTaxId()"
                        (input)="setBillingField(billingTaxId, $event)"
                        placeholder="900123456"
                        class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                      />
                    </label>

                    <!-- DV: se CALCULA del número, solo para NIT.
                         Para documentos que no son NIT (Cédula, Pasaporte, etc.)
                         el campo NO se muestra. -->
                    @if (billingDocumentIsNit()) {
                      <label class="flex flex-col gap-1">
                        <span class="text-xs font-medium text-text-secondary">
                          Dígito de verificación
                        </span>
                        <input
                          type="text"
                          [value]="billingDvDisplay()"
                          disabled
                          aria-readonly="true"
                          class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-gray-50 text-text-secondary cursor-not-allowed"
                        />
                      </label>
                    }

                    <label class="flex flex-col gap-1 sm:col-span-2">
                      <span class="text-xs font-medium text-text-secondary">
                        Correo de facturación
                      </span>
                      <input
                        type="email"
                        [value]="billingEmail()"
                        (input)="setBillingField(billingEmail, $event)"
                        placeholder="facturacion@empresa.com"
                        class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text-primary focus:ring-1 focus:ring-primary focus:border-primary"
                      />
                    </label>
                  </div>

                  <!-- Dirección fiscal. La captura entera la hace el componente
                       compartido: el cliente elige departamento y municipio del
                       catálogo DANE y el código se resuelve por detrás, así que
                       no puede quedar «Riohacha / 44000» (código de La Guajira,
                       el departamento) ni «Medellín / Cundinamarca». -->
                  <div class="pt-1 space-y-2">
                    <p class="text-xs font-medium text-text-secondary">
                      Dirección fiscal
                    </p>

                    @if (billingAddressSourceNotice(); as notice) {
                      <div class="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                        <app-icon
                          name="info"
                          [size]="14"
                          class="text-amber-700 mt-0.5 shrink-0"
                        ></app-icon>
                        <p class="text-xs text-amber-900 leading-tight">{{ notice }}</p>
                      </div>
                    }

                    <!-- Sin teléfono: BillingAddressDto no tiene columna para
                         él, así que un campo visible descartaría en silencio lo
                         que el cliente escriba. -->
                    <app-address-form-fields
                      [initialAddress]="billingInitialAddress()"
                      [showPhone]="false"
                      (addressChange)="onBillingAddressChange($event)"
                    ></app-address-form-fields>
                  </div>

                  @if (!billingProfileValid()) {
                    <p class="text-xs text-text-secondary">
                      Completa razón social, número de documento, dirección y el
                      municipio de la lista DANE.
                    </p>
                  }

                  <!-- Cancelar solo existe sobre un perfil que ya estaba
                       completo; si faltan datos el formulario no se puede
                       cerrar sin llenarlo. -->
                  @if (billingEditing()) {
                    <button
                      type="button"
                      (click)="cancelBillingEdit()"
                      class="text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                    >
                      Cancelar edición
                    </button>
                  }
                  }
                </div>
              }

              <!-- Aviso de medio de pago. Va JUNTO al botón que abre la
                   pasarela, que es el momento en que el cliente elige con qué
                   paga: la selección real (tarjeta / PSE / efectivo) ocurre ya
                   dentro del widget de Wompi, así que si el aviso no está aquí
                   no está en ninguna parte. Un cliente compró creyendo que
                   quedaba con autopago y su renovación falló en silencio. -->
              @if (autoRenewCardWarningVisible()) {
                <div class="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <app-icon
                    name="credit-card"
                    [size]="16"
                    class="text-amber-700 mt-0.5 shrink-0"
                  ></app-icon>
                  <div class="space-y-1 min-w-0">
                    <p class="text-xs font-semibold text-amber-900">
                      La renovación automática solo funciona con tarjeta
                    </p>
                    <p class="text-xs text-amber-900/90 leading-relaxed">
                      Solo con <strong>tarjeta</strong> se renueva sola. Con PSE,
                      efectivo o transferencia tendrás que pagar cada mes a mano.
                    </p>
                  </div>
                </div>
              }

              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="noRefundAcknowledged()"
                  (change)="toggleAck($event)"
                  class="w-4 h-4 rounded border-border text-primary focus:ring-primary shrink-0"
                />
                <span class="text-xs text-text-secondary leading-tight">
                  Acepto la
                  <a
                    [routerLink]="'/legal/terminos'"
                    fragment="pagos-y-reembolsos"
                    target="_blank"
                    class="font-medium text-primary hover:underline"
                  >política de cobro y términos de servicio</a>.
                </span>
              </label>

              <div class="pt-2 space-y-2">
                <app-button
                  variant="primary"
                  [loading]="committing()"
                  [disabled]="
                    (chargeNow() > 0 && !noRefundAcknowledged()) ||
                    (billingFormVisible() && !billingProfileValid()) ||
                    committing()
                  "
                  [fullWidth]="true"
                  (clicked)="confirmCheckout()"
                >
                  <app-icon name="check" [size]="16" slot="icon" ></app-icon>
                  {{ confirmCtaLabel() }}
                </app-button>
                <app-button variant="ghost" [fullWidth]="true" (clicked)="goBack()">Cancelar</app-button>
              </div>
            </div>
          </app-card>
        </div>
      }

      <!-- S2.1 — Coupon redemption block. Placed at the bottom, after the
           plan variants, so the user first sees what they're contracting and
           the coupon stays as an optional discount tool. Hidden during
           loading and on error to avoid noise. -->
      @if (!loadingPreview() && (freePlan() || trialSwapInfo() || proration())) {
        <div class="border-t border-border/50 pt-8">
        <app-card>
          <div class="p-4 md:p-5 space-y-3">
            <div class="flex items-center gap-2">
              <app-icon name="tag" [size]="18" class="text-primary"></app-icon>
              <h3 class="text-sm font-semibold text-text-primary">Código de cupón</h3>
            </div>

            @if (appliedCoupon(); as ac) {
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div class="space-y-1 min-w-0">
                  <p class="text-sm font-semibold text-emerald-900 truncate">
                    Cupón aplicado: {{ ac.plan.name }}
                  </p>
                  <p class="text-xs text-emerald-800">
                    Código <span class="font-mono">{{ ac.code }}</span>
                    @if (ac.duration_days) {
                      · {{ ac.duration_days }} días
                    }
                    @if (ac.expires_at) {
                      · vence {{ ac.expires_at | date:'mediumDate' }}
                    }
                  </p>
                </div>
                <button
                  type="button"
                  (click)="removeCoupon()"
                  class="text-xs font-medium text-emerald-900 underline-offset-2 hover:underline shrink-0"
                >
                  Quitar cupón
                </button>
              </div>
            } @else {
              <div class="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  [formControl]="couponControl"
                  placeholder="Ingresa tu código"
                  class="flex-1 px-3 py-2 border border-border rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary"
                  autocomplete="off"
                  spellcheck="false"
                  maxlength="64"
                />
                <app-button
                  variant="primary"
                  [loading]="couponValidating()"
                  [disabled]="couponValidating() || couponControl.invalid"
                  (clicked)="applyCoupon()"
                >
                  Aplicar
                </app-button>
              </div>
              @if (couponErrorCopy(); as err) {
                <p class="text-xs text-red-700 flex items-center gap-1">
                  <app-icon name="alert-circle" [size]="14"></app-icon>
                  {{ err }}
                </p>
              }
            }
          </div>
        </app-card>
        </div>
      }

      <!-- Error state -->
      @if (!loadingPreview() && !freePlan() && !proration() && hasError()) {
        <app-card>
          <div class="p-8 text-center space-y-4">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50">
              <app-icon name="alert-triangle" [size]="32" class="text-red-600"></app-icon>
            </div>
            <h2 class="text-lg font-bold text-text-primary">No se pudo cargar la vista previa</h2>
            <p class="text-sm text-text-secondary max-w-md mx-auto">
              Ocurrió un problema al calcular el detalle de tu cambio de plan. Intenta nuevamente o vuelve al catálogo.
            </p>
            <div class="flex flex-col sm:flex-row gap-3 justify-center">
              <app-button variant="ghost" (clicked)="goBack()">Volver</app-button>
              <app-button variant="primary" (clicked)="retry()">
                <app-icon name="refresh-cw" [size]="16" slot="icon" ></app-icon>
                Reintentar
              </app-button>
            </div>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class CheckoutComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private facade = inject(SubscriptionFacade);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);
  private wompiCheckoutService = inject(WompiCheckoutService);

  readonly preview = signal<CheckoutPreviewResponse | null>(null);
  readonly loadingPreview = signal(false);
  readonly committing = signal(false);
  readonly hasError = signal(false);
  readonly selectedPlan = signal<SubscriptionPlan | null>(null);
  // G8 — checkbox obligatorio de aceptación de política de no-reembolso.
  readonly noRefundAcknowledged = signal(false);

  // ── Datos fiscales del adquiriente ──────────────────────────────────────
  // Vendix emite factura electrónica por cada cobro, así que la organización
  // que paga es el adquiriente ante la DIAN. Si estos datos faltan, el
  // documento se rechaza DESPUÉS de haber consumido un consecutivo fiscal —
  // por eso se piden aquí, mientras el cliente está presente, y no después.
  //
  // Señales sueltas en vez de ReactiveForms: un `computed` sobre un
  // FormControl no es reactivo en zoneless (el control no notifica al grafo
  // de señales), así que la validación en vivo se rompería en silencio.
  readonly billingProfileComplete = signal(false);
  readonly billingProfileLoaded = signal(false);
  /**
   * La plataforma emite factura electrónica real. Mientras esté en falso el
   * checkout no muestra nada fiscal: no hay documento que llevaría el NIT.
   */
  readonly billingProfileEnabled = signal(false);
  /** El módulo fiscal del cliente es dueño de estos datos: aquí solo se leen. */
  readonly billingProfileLocked = signal(false);
  /** El usuario abrió el formulario sobre un perfil que ya estaba completo. */
  readonly billingEditing = signal(false);
  readonly billingLegalName = signal('');
  readonly billingTaxId = signal('');
  readonly billingDocumentType = signal('31');
  readonly billingTaxRegime = signal('49');
  readonly billingEmail = signal('');
  readonly billingAddressLine = signal('');
  readonly billingAddressLine2 = signal('');
  readonly billingCity = signal('');
  readonly billingStateProvince = signal('');
  readonly billingMunicipalityCode = signal('');
  readonly billingPostalCode = signal('');
  readonly billingCountryCode = signal('CO');
  /** Derivado por el backend; solo se muestra, nunca se edita. */
  readonly billingVerificationDigit = signal('');
  /**
   * Escalón de la cascada del que salió la dirección precargada. Sirve para
   * decirle al cliente que la dirección propuesta NO es la que declaró como
   * fiscal, en vez de dejarlo pagar sobre un respaldo silencioso.
   */
  readonly billingAddressSource = signal<BillingAddressSource | null>(null);
  /**
   * Dirección con la que se precarga `app-address-form-fields`.
   *
   * Es una señal PROPIA y no un `computed` de las señales de dirección a
   * propósito: el componente compartido reacciona a este input con un `effect`
   * que hace `patchValue`, y su `addressChange` vuelve a escribir esas mismas
   * señales. Derivarla de ellas cerraría el ciclo emisión → patch → emisión.
   * Solo se escribe al cargar el perfil o al descartar una edición.
   */
  readonly billingInitialAddress = signal<AddressPayload | null>(null);

  /** Últimos valores en archivo, para poder descartar una edición. */
  private billingProfileSnapshot: BillingProfileStatus['profile'] = null;

  /**
   * La sección fiscal solo tiene sentido cuando la plataforma emite factura
   * electrónica real Y el commit va a cobrar: en un plan gratis o en un cambio
   * dentro del trial no se emite documento, así que pedir un NIT sería ruido.
   */
  readonly billingSectionVisible = computed(
    () =>
      this.billingProfileLoaded() &&
      this.billingProfileEnabled() &&
      !this.freePlan() &&
      !this.trialSwapInfo() &&
      this.chargeNow() > 0,
  );

  /** Faltan datos: el formulario es obligatorio y no se puede cerrar. */
  readonly needsBillingProfile = computed(
    () => this.billingSectionVisible() && !this.billingProfileComplete(),
  );

  /** Perfil ya en archivo: se muestra en tarjeta compacta, no en formulario. */
  readonly billingSummaryVisible = computed(
    () =>
      this.billingSectionVisible() &&
      this.billingProfileComplete() &&
      !this.billingEditing(),
  );

  /** El formulario está abierto por falta de datos o porque el usuario editó. */
  readonly billingFormVisible = computed(
    () =>
      this.billingSectionVisible() &&
      (this.needsBillingProfile() || this.billingEditing()),
  );

  /**
   * Número de documento sin el DV. Muchas organizaciones tienen el NIT
   * guardado con el DV pegado (`800987654-3`); quitar todo lo no-numérico
   * daría `8009876543`, un NIT de diez dígitos que no es de nadie. El DV es
   * checksum: el backend lo deriva, aquí solo se descarta.
   */
  private documentNumber(): string {
    const raw = this.billingTaxId().trim();
    const head = raw.includes('-') ? raw.split('-')[0] : raw;
    return head.replace(/\D/g, '');
  }

  /** Campos mínimos que la DIAN exige del adquiriente. */
  readonly billingProfileValid = computed(() => {
    // Reads `billingTaxId()` inside the computed, so the dependency is tracked.
    const nit = this.documentNumber();
    return (
      this.billingLegalName().trim().length >= 3 &&
      nit.length >= 5 &&
      this.billingAddressLine().trim().length >= 3 &&
      this.billingCity().trim().length >= 2 &&
      /^\d{5}$/.test(this.billingMunicipalityCode().trim())
    );
  });

  /** Etiqueta legible del tipo de documento para la tarjeta compacta. */
  readonly billingDocumentLabel = computed(
    () =>
      BILLING_DOCUMENT_LABELS[this.billingDocumentType()] ?? 'Documento',
  );

  /** Solo el NIT lleva DV; una cédula no tiene checksum que mostrar. */
  readonly billingDocumentIsNit = computed(
    () => this.billingDocumentType() === BILLING_DOCUMENT_TYPE_NIT,
  );

  /**
   * DV que se pinta en el formulario, deshabilitado.
   *
   * Se DERIVA del número tecleado con el mismo módulo 11 que usa el backend
   * (`computeNitDv`), no se lee del perfil en archivo: mientras el cliente
   * corrige su NIT, el DV guardado corresponde al número viejo y mostrarlo
   * sería mostrar un checksum que no cuadra con lo que tiene delante. El valor
   * en archivo solo se usa como respaldo cuando todavía no hay número escrito.
   */
  readonly billingDvDisplay = computed(() => {
    if (!this.billingDocumentIsNit()) return 'No aplica';
    const number = this.documentNumber();
    if (!number) return this.billingVerificationDigit() || '—';
    return computeNitDv(number) ?? '—';
  });

  /**
   * Aviso cuando la dirección precargada NO salió de una dirección de
   * facturación. Silencio en el caso normal: anunciar lo esperado es ruido.
   */
  readonly billingAddressSourceNotice = computed<string | null>(() => {
    const source = this.billingAddressSource();
    if (!source) return null;
    return BILLING_ADDRESS_SOURCE_COPY[source] ?? null;
  });

  /**
   * El aviso de «el autopago solo funciona con tarjeta» solo aplica cuando este
   * checkout va a abrir la pasarela. Sin cobro no hay medio de pago que elegir
   * y el aviso sería ruido.
   */
  readonly autoRenewCardWarningVisible = computed(
    () => this.chargeNow() > 0 && !this.freePlan() && !this.trialSwapInfo(),
  );

  /**
   * Documento con su DV cuando el backend ya lo derivó. Se muestra solo en
   * lectura: el DV nunca se pide, es un checksum del número.
   */
  readonly billingTaxIdDisplay = computed(() => {
    const number = this.documentNumber();
    if (!number) return '—';
    const dv = this.billingDocumentIsNit() ? this.billingVerificationDigit() : null;
    return dv ? `${number}-${dv}` : number;
  });

  /**
   * Municipio y departamento, por NOMBRE.
   *
   * El código DANE queda fuera de la interfaz a propósito: es un identificador
   * de catálogo que no le dice nada al cliente, y exponerlo es exactamente cómo
   * un tenant terminó guardando `44000` —el código de La Guajira, el
   * departamento— como municipio de Riohacha (`44001`). Quien lo pone ahora es
   * el selector del catálogo, y lo que el cliente confirma es el nombre.
   */
  readonly billingCityDisplay = computed(() => {
    const city = this.billingCity().trim();
    const department = this.billingStateProvince().trim();
    if (!city) return department || '—';
    return department ? `${city}, ${department}` : city;
  });

  /** Abre el formulario sobre un perfil ya completo. */
  startBillingEdit(): void {
    if (this.billingProfileLocked()) return;
    this.billingEditing.set(true);
  }

  /** Descarta la edición y vuelve a los valores en archivo. */
  cancelBillingEdit(): void {
    this.applyBillingProfile(this.billingProfileSnapshot);
    this.billingEditing.set(false);
  }

  // RNC-PaidPlan — Tracks whether the Wompi widget produced a terminal payment
  // outcome (APPROVED or PENDING). When the user closes the widget without
  // either, the `onClosed` handler invokes `cancelPendingChange()` so the
  // backend doesn't keep the subscription stuck in `pending_payment` with
  // `pending_plan_id` set indefinitely.
  private readonly paymentSucceeded = signal(false);

  // S2.1 — Coupon redemption form + facade signals.
  readonly couponControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(64)],
  });
  readonly appliedCoupon = this.facade.appliedCoupon;
  readonly couponValidating = this.facade.couponValidating;
  readonly couponError = this.facade.couponError;
  readonly couponErrorCopy = computed(() => {
    const err = this.couponError();
    if (!err) return null;
    return COUPON_REASON_COPY[err as string] ?? `No se pudo aplicar el cupón (${err})`;
  });

  // S2.1 — Track the previously applied code so we only refresh the preview
  // on actual transitions (skip the initial null → null read). ngOnInit
  // performs the first load explicitly.
  private lastCouponCode: string | null = null;
  private couponEffect = effect(() => {
    const ac = this.appliedCoupon();
    const code = ac?.code ?? null;
    if (code === this.lastCouponCode) return;
    this.lastCouponCode = code;
    const planId = this.route.snapshot.paramMap.get('planId');
    if (planId) {
      // Skip the very first run (planId not yet read in ngOnInit). The init
      // loadPreview call in ngOnInit will fire once after this effect.
      if (code === null && !this.preview()) return;
      this.loadPreview(planId, code ?? undefined);
    }
  });

  // Rich plan details (Markdown → HTML string). We return a plain string and
  // bind it with [innerHTML]; Angular's default sanitizer strips unsafe
  // markup. Do NOT wrap this in DomSanitizer.bypassSecurityTrustHtml — that
  // would disable sanitization and open an XSS vector on admin-authored copy.
  readonly detailsHtml = computed<string>(() => {
    const md = this.selectedPlan()?.details_md ?? '';
    return md.trim() ? markdownToHtml(md) : '';
  });

  readonly freePlan = computed(() => this.preview()?.free_plan ?? null);
  readonly proration = computed(() => this.preview()?.proration ?? null);
  readonly invoice = computed(() => this.preview()?.invoice ?? null);
  // S3.4 — Trial plan-swap variant detection. Backend marks the preview
  // with `kind === 'trial_plan_swap'` and embeds plan metadata in
  // `trial_swap`. The view branches on this signal to render the
  // deferred-change card instead of the regular breakdown.
  //
  // Bundle both `trial_swap` and `new_effective_price` in a single
  // computed snapshot so the template reads them atomically. Reading
  // `proration()?.new_effective_price` separately inside the @if block
  // caused NG0100 (ExpressionChangedAfterItHasBeenChecked) when the
  // preview signal flipped during the verify-changes pass.
  readonly trialSwapInfo = computed(() => {
    const p = this.proration();
    if (!p || p.kind !== 'trial_plan_swap' || !p.trial_swap) return null;
    return {
      ...p.trial_swap,
      new_effective_price: p.new_effective_price,
    };
  });

  readonly chargeNow = computed(() => {
    const inv = this.preview()?.proration?.invoice_to_issue ?? this.preview()?.invoice ?? null;
    return inv ? this.asNumber(inv.total) : 0;
  });

  // Difference between the plan's full cycle price and what is actually
  // charged today. Surfaces the prorated savings in the summary so the user
  // sees both the "list price" and the discount applied for the unused days.
  // Returns 0 when there is no discount (downgrade / re_subscribe / first
  // charge of a fresh cycle).
  readonly prorationDiscount = computed(() => {
    const p = this.proration();
    if (!p) return 0;
    const fullPrice = this.asNumber(p.new_effective_price);
    const charge = this.chargeNow();
    if (fullPrice <= 0 || charge <= 0) return 0;
    return Math.max(0, Math.round(fullPrice - charge));
  });

  // Single source of truth: cycle_days and days_remaining come from the
  // backend's ProrationPreview. The same numbers used to compute the
  // discount $ are exposed on the wire so the UI can label the breakdown
  // without reproducing the math (which previously drifted because the FE
  // was deriving cycleDays from billing_cycle while BE derived it from
  // (period_end - period_start)).
  readonly currentCycleDays = computed(
    () => this.proration()?.cycle_days ?? 0,
  );

  readonly daysRemainingInCycle = computed(
    () => this.proration()?.days_remaining ?? 0,
  );

  readonly daysConsumedInCycle = computed(
    () => Math.max(0, this.currentCycleDays() - this.daysRemainingInCycle()),
  );

  // Target-plan cycle length is the only piece backend doesn't echo because
  // it's not part of the proration: it's a property of the plan the user is
  // buying. Read it from `selectedPlan().billing_cycle` (same map the BE
  // uses internally via `billingCycleDays`).
  readonly targetCycleDays = computed(() => {
    const cycle = this.selectedPlan()?.billing_cycle as string | undefined;
    if (cycle === 'yearly' || cycle === 'annual') return 365;
    if (cycle === 'monthly') return 30;
    if (cycle === 'quarterly') return 90;
    if (cycle === 'semiannual') return 180;
    return this.currentCycleDays();
  });

  // RNC-15 — Trial → paid plan path. The backend returns kind='re_subscribe'
  // for trial → paid (anti-arrastre). We detect it on the frontend by reading
  // the current subscription status from the facade so we can show accurate
  // copy ("Suscríbete al plan…" instead of "Reactivar suscripción").
  readonly isTrialUpgrade = computed(
    () => this.isResubscribe() && this.facade.status() === 'trialing',
  );

  readonly headerTitle = computed(() => {
    if (this.trialSwapInfo()) return 'Cambiar plan durante prueba';
    if (this.freePlan()) return 'Activar Plan';
    if (this.isTrialUpgrade()) return 'Suscríbete al plan';
    if (this.isResubscribe()) return 'Reactivar suscripción';
    if (this.voidsScheduledCancelOnly()) return 'Reanudar suscripción';
    return 'Confirmar Cambio de Plan';
  });

  /**
   * S3.5 — True when the only effect of confirming is voiding a scheduled
   * cancellation: same plan + no charge today. Drives header copy and CTA
   * label so the user understands they're not buying a different plan.
   */
  readonly voidsScheduledCancelOnly = computed(() => {
    const p = this.proration();
    return (
      !!p?.voids_scheduled_cancel?.active &&
      this.chargeNow() === 0 &&
      p.kind === 'same-tier'
    );
  });

  readonly confirmCtaLabel = computed(() => {
    if (this.voidsScheduledCancelOnly()) return 'Reanudar suscripción';
    if (this.chargeNow() === 0) return 'Confirmar cambio';
    return 'Confirmar y pagar';
  });
  readonly headerSubtitle = computed(() => {
    if (this.trialSwapInfo())
      return 'Mantienes tu prueba activa, sin cobros inmediatos';
    if (this.freePlan()) return 'Activa tu plan sin costo en un solo paso';
    if (this.isTrialUpgrade())
      return 'Tu prueba termina al confirmar el pago. Comienzas un ciclo completo desde hoy.';
    if (this.isResubscribe())
      return 'Inicia un ciclo nuevo eligiendo el plan que prefieras';
    return 'Revisa los detalles antes de confirmar';
  });

  ngOnInit(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) {
      this.router.navigate(['/admin/subscription/plans']);
      return;
    }
    // S2.1 — If a coupon arrived via query param (from PlanCatalog) and the
    // facade doesn't already hold it (e.g. hard reload), auto-trigger
    // validation so the preview can lift the overlay on first load.
    const queryCoupon = this.route.snapshot.queryParamMap.get('coupon');
    const existing = this.facade.appliedCoupon();
    if (queryCoupon && !existing) {
      this.couponControl.setValue(queryCoupon);
      this.facade.validateCoupon(queryCoupon);
    }
    this.loadPreview(planId, existing?.code ?? queryCoupon ?? undefined);
    this.loadSelectedPlan(planId);
    this.loadBillingProfile();
  }

  /**
   * Reads the fiscal identity already on file. Prefills whatever exists so a
   * returning customer only fills the gaps, and marks the profile complete so
   * the block stays hidden when there is nothing to ask.
   *
   * A failure here does NOT block checkout: the form simply shows empty and the
   * backend remains the authority on completeness.
   */
  private loadBillingProfile(): void {
    this.subscriptionService
      .getBillingProfile()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.billingProfileSnapshot = status.profile;
          this.applyBillingProfile(status.profile);
          this.billingProfileEnabled.set(status.enabled);
          this.billingProfileComplete.set(status.complete);
          this.billingProfileLocked.set(status.locked);
          this.billingProfileLoaded.set(true);
        },
        error: () => {
          // Sin respuesta no se asume que haya que pedir datos fiscales: el
          // backend es la autoridad y bloquearía el commit si hicieran falta.
          this.billingProfileEnabled.set(false);
          this.billingProfileComplete.set(false);
          this.billingProfileLocked.set(false);
          this.billingProfileLoaded.set(true);
        },
      });
  }

  /** Vuelca un perfil en las señales del formulario. `null` las deja vacías. */
  private applyBillingProfile(p: BillingProfileStatus['profile']): void {
    this.billingLegalName.set(p?.legal_name ?? '');
    this.billingTaxId.set(p?.tax_id ?? '');
    this.billingDocumentType.set(p?.document_type ?? BILLING_DOCUMENT_TYPE_NIT);
    this.billingTaxRegime.set(p?.tax_regime ?? '49');
    this.billingEmail.set(p?.email ?? '');
    this.billingVerificationDigit.set(p?.verification_digit ?? '');

    const addr = p?.address ?? null;
    this.billingAddressLine.set(addr?.address_line1 ?? '');
    this.billingAddressLine2.set(addr?.address_line2 ?? '');
    this.billingCity.set(addr?.city ?? '');
    this.billingStateProvince.set(addr?.state_province ?? '');
    this.billingMunicipalityCode.set(addr?.municipality_code ?? '');
    this.billingPostalCode.set(addr?.postal_code ?? '');
    this.billingCountryCode.set(addr?.country_code ?? 'CO');
    this.billingAddressSource.set(addr ? (p?.address_source ?? null) : null);

    // Precarga del componente compartido. `null` cuando no hay dirección: así
    // el widget arranca vacío en vez de patchear una fila de campos en blanco.
    this.billingInitialAddress.set(
      addr
        ? {
            address_line1: addr.address_line1 ?? null,
            address_line2: addr.address_line2 ?? null,
            city: addr.city ?? null,
            state_province: addr.state_province ?? null,
            country_code: addr.country_code ?? 'CO',
            postal_code: addr.postal_code ?? null,
            municipality_code: addr.municipality_code ?? null,
            // La dirección fiscal no captura teléfono ni coordenadas: el DTO de
            // facturación no las acepta y el municipio DANE ya fija la
            // ubicación que la DIAN valida.
            phone_number: null,
            latitude: null,
            longitude: null,
          }
        : null,
    );
  }

  /**
   * El componente compartido emitió la dirección completa.
   *
   * Se vuelca en las señales que ya gobernaban la validación y el payload, así
   * que `billingProfileValid()` y `buildBillingProfile()` siguen siendo la
   * única definición de «dirección suficiente» — el widget aporta la CAPTURA
   * coherente (municipio del catálogo, ciudad y departamento escritos por él),
   * no una segunda regla de validez.
   */
  onBillingAddressChange(address: AddressPayload): void {
    this.billingAddressLine.set(address.address_line1 ?? '');
    this.billingAddressLine2.set(address.address_line2 ?? '');
    this.billingCity.set(address.city ?? '');
    this.billingStateProvince.set(address.state_province ?? '');
    this.billingMunicipalityCode.set(address.municipality_code ?? '');
    this.billingPostalCode.set(address.postal_code ?? '');
    this.billingCountryCode.set(address.country_code ?? 'CO');

    // El aviso de procedencia solo se retira cuando la calle deja de ser la
    // precargada. El widget re-emite la dirección al hidratarse —así confirma
    // lo que patcheó—, y limpiar el aviso en toda emisión lo borraría antes de
    // que el cliente alcanzara a leerlo.
    const prefilled = this.billingInitialAddress();
    if (
      prefilled &&
      (address.address_line1 ?? '') !== (prefilled.address_line1 ?? '')
    ) {
      this.billingAddressSource.set(null);
    }
  }

  /** Reads a text input into the given signal. */
  setBillingField(target: ReturnType<typeof signal<string>>, event: Event): void {
    target.set((event.target as HTMLInputElement | HTMLSelectElement).value);
  }

  /**
   * Payload for the commit, or undefined when there is nothing new to send.
   * Un perfil bloqueado nunca viaja: lo edita el módulo fiscal, no el checkout.
   */
  private buildBillingProfile(): BillingProfile | undefined {
    if (this.billingProfileLocked()) return undefined;
    if (!this.billingFormVisible()) return undefined;
    return {
      legal_name: this.billingLegalName().trim(),
      tax_id: this.documentNumber(),
      document_type: this.billingDocumentType(),
      tax_regime: this.billingTaxRegime(),
      email: this.billingEmail().trim() || undefined,
      // La dirección viaja ENTERA. `postal_code` y `address_line2` los captura
      // el componente compartido y el DTO los acepta; dejarlos fuera hacía que
      // un dato que el cliente sí escribió no llegara nunca a la factura.
      address: {
        address_line1: this.billingAddressLine().trim(),
        address_line2: this.billingAddressLine2().trim() || undefined,
        city: this.billingCity().trim(),
        state_province: this.billingStateProvince().trim() || undefined,
        municipality_code: this.billingMunicipalityCode().trim(),
        country_code: this.billingCountryCode().trim().toUpperCase() || 'CO',
        postal_code: this.billingPostalCode().trim() || undefined,
      },
    };
  }

  private loadSelectedPlan(planId: string): void {
    this.subscriptionService.getPlans()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            const plan = res.data.find(p => String(p.id) === String(planId)) ?? null;
            this.selectedPlan.set(plan);
          }
        },
      });
  }

  private loadPreview(planId: string, couponCode?: string): void {
    this.loadingPreview.set(true);
    this.hasError.set(false);
    this.subscriptionService.checkoutPreview(planId, couponCode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.preview.set(res.data);
          } else {
            this.hasError.set(true);
          }
          this.loadingPreview.set(false);
        },
        error: (err) => {
          this.hasError.set(true);
          this.loadingPreview.set(false);
          // S3.7 — Use the canonical extractApiErrorMessage helper. It reads
          // the backend `error_code` and looks up the Spanish UX copy from
          // ERROR_MESSAGES, falling back to a generic message when unknown.
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  retry(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (planId) this.loadPreview(planId, this.appliedCoupon()?.code);
  }

  applyCoupon(): void {
    const code = (this.couponControl.value ?? '').trim();
    if (!code) return;
    this.facade.validateCoupon(code);
  }

  removeCoupon(): void {
    this.facade.clearCoupon();
    this.couponControl.reset('');
  }

  toggleAck(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.noRefundAcknowledged.set(!!target?.checked);
  }

  confirmCheckout(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) return;

    // Idempotency probe — Plan separado vs pagado (RNC-PaidPlan):
    // Si el backend ya emitió un invoice para este mismo planId como
    // pending_change, ir directo al retry-payment en lugar de crear otro.
    // Esto evita duplicar invoices cuando el usuario hace clic "Confirmar"
    // por segunda vez tras cerrar el widget de Wompi sin completar el pago.
    const currentSub: any = this.facade.current();
    if (
      currentSub?.pending_plan_id != null &&
      String(currentSub.pending_plan_id) === String(planId) &&
      currentSub?.pending_change_invoice_id != null
    ) {
      // Ya existe un invoice pendiente para este plan — redirigir a la
      // página de suscripción donde el usuario puede completar el pago
      // con el botón "Completar pago" (retryPayment).
      this.toastService.info(
        'Ya tienes un cambio de plan en proceso. Completa el pago pendiente.',
      );
      this.router.navigate(['/admin/subscription']);
      return;
    }

    // S3.4 — Trial plan-swap is free and deferred (no charge today).
    // Free plans likewise emit no charge. The no-refund acknowledgement
    // only applies to flows that actually emit a charge, so we skip the
    // UI guard for both. The backend mirrors this exception.
    // S3.5 — Same-tier voiding a scheduled cancel also has chargeNow=0;
    // skip the ack requirement uniformly when chargeNow is 0.
    const swap = this.trialSwapInfo();
    const free = this.freePlan();
    const noChargeFlow = !!swap || !!free || this.chargeNow() === 0;
    if (!noChargeFlow && !this.noRefundAcknowledged()) {
      this.toastService.error('Debes aceptar la política de no-reembolso');
      return;
    }

    // Datos fiscales del adquiriente: si el cobro va a existir y aún no hay
    // perfil completo, sin esto la factura electrónica se rechaza después de
    // gastar un consecutivo.
    if (this.billingFormVisible() && !this.billingProfileValid()) {
      this.toastService.error(
        'Completa los datos de facturación de tu empresa para continuar',
      );
      return;
    }

    const returnUrl = `${window.location.origin}/admin/subscription`;
    const acknowledgedAt = new Date().toISOString();
    // Flows without a charge (trial swap, free plan) send `false` so the
    // backend records the absence of acknowledgement faithfully — backend
    // bypasses the hard block when sub.state === 'trial' or plan is free.
    const ackFlag = noChargeFlow ? false : true;

    this.committing.set(true);
    const couponCode = this.appliedCoupon()?.code;
    this.subscriptionService
      .checkoutCommit(
        planId,
        undefined,
        returnUrl,
        ackFlag,
        acknowledgedAt,
        couponCode,
        this.buildBillingProfile(),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.facade.loadCurrent();
          // Paid fresh purchase → backend returns Wompi widget config.
          // Free plan / inline-charged upgrade / trial swap → widget is null.
          const widget = res?.data?.widget as WompiWidgetConfig | null;
          // Pull-fallback: backend now returns `invoiceId` on the commit
          // response so the polling loop can reconcile against Wompi
          // directly when the webhook can't reach localhost.
          const invoiceId =
            typeof res?.data?.invoiceId === 'number'
              ? (res.data.invoiceId as number)
              : null;
          if (widget) {
            this.openWompiWidget(widget, invoiceId);
            return;
          }
          // Defense in depth: if there is a charge to collect AND the target
          // plan is NOT free, the backend MUST return a Wompi widget config.
          // Receiving widget=null here means a server-side regression has
          // routed the commit through a free-plan branch without charging.
          // Surface an error rather than navigating to a misleading
          // "success" state. Prefer the explicit `target_plan_is_free` flag
          // (server-authoritative); fall back to chargeNow heuristic only
          // when older backends omit the field.
          const proration = this.proration();
          const targetIsFree =
            proration && typeof proration.target_plan_is_free === 'boolean'
              ? proration.target_plan_is_free
              : !!this.freePlan();
          if (!swap && !targetIsFree && this.chargeNow() > 0) {
            this.committing.set(false);
            this.toastService.error(
              'Error procesando el cobro. Por favor refresca la página y reintenta.',
            );
            return;
          }
          if (swap) {
            const trialEndsAt = new Date(swap.trial_ends_at).toLocaleDateString(
              'es-CO',
              { day: 'numeric', month: 'long', year: 'numeric' },
            );
            this.toastService.success(
              `Cambiaste a ${swap.new_plan.name}. Tu prueba continúa hasta ${trialEndsAt}.`,
            );
          } else {
            this.toastService.success(
              this.freePlan() ? 'Plan activado exitosamente' : 'Plan cambiado exitosamente',
            );
          }
          this.committing.set(false);
          this.router.navigate(['/admin/subscription']);
        },
        error: (err) => {
          this.committing.set(false);
          // S3.7 — Translate backend error_code into precise Spanish copy via
          // the canonical helper. Critical for SUBSCRIPTION_GATEWAY_003,
          // SUBSCRIPTION_CARD_DECLINED, SUBSCRIPTION_PROVIDER_UNAVAILABLE.
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  /**
   * Phase 3 — Delegates to the shared `WompiCheckoutService.openWidget`. Every
   * callback path (approved/declined/pending/closed/error) refreshes the
   * subscription state via `loadCurrent()` so the UI never lags behind the
   * webhook. The APPROVED path also kicks off polling so the banner flips
   * `pending_payment → active` as soon as the backend persists the change.
   */
  private async openWompiWidget(
    config: WompiWidgetConfig,
    invoiceId: number | null = null,
  ): Promise<void> {
    // Defensive reset — the user may re-open the widget after closing it
    // once. Without this, a previous APPROVED/PENDING flag would leak across
    // sessions and skip the cleanup on a true abandonment.
    this.paymentSucceeded.set(false);
    await this.wompiCheckoutService.openWidget(config, {
      onApproved: () => {
        this.paymentSucceeded.set(true);
        this.committing.set(false);
        // Always refresh first; the response might already be `active` if
        // the synchronous webhook fast-path won, otherwise polling catches
        // the async transition.
        this.facade.loadCurrent();
        // Pull-fallback: when invoiceId is known, the polling loop will
        // hit /sync-from-gateway each cycle so localhost dev stops getting
        // stuck in pending_payment.
        this.facade.pollSubscriptionUntilActive({ invoiceId });
        this.toastService.info('Verificando confirmación de pago…');
        this.router.navigate(['/admin/subscription']);
      },
      onDeclined: () => {
        this.committing.set(false);
        this.facade.loadCurrent();
        this.toastService.error(
          'El pago fue rechazado. Intenta con otro método de pago.',
        );
      },
      onPending: () => {
        // PSE/transferencia in-flight — backend awaits webhook, do NOT cancel
        // the pending change on close. Cron reconciles after 60min if the
        // webhook never arrives.
        this.paymentSucceeded.set(true);
        this.committing.set(false);
        this.facade.loadCurrent();
        this.facade.pollSubscriptionUntilActive({ invoiceId });
        this.toastService.info(
          'Pago pendiente de confirmación. Verificando…',
        );
        this.router.navigate(['/admin/subscription']);
      },
      onClosed: () => {
        this.committing.set(false);
        if (this.paymentSucceeded()) {
          this.facade.loadCurrent();
          return;
        }
        // True abandonment — wipe the pending change server-side so the
        // subscription returns to its previous state. If the HTTP call
        // fails, fall back to the cron's 60-minute reconciler.
        this.subscriptionService.cancelPendingChange().subscribe({
          next: () => {
            this.facade.loadCurrent();
            this.toastService.info('Cambio cancelado');
          },
          error: () => {
            this.facade.loadCurrent();
            this.toastService.warning(
              'No pudimos limpiar el cambio. Se eliminará automáticamente en unos minutos.',
            );
          },
        });
      },
      onError: () => {
        this.committing.set(false);
        this.facade.loadCurrent();
        this.toastService.error(
          'No se pudo abrir el widget de pago. Intenta de nuevo.',
        );
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/admin/subscription/plans']);
  }

  asNumber(value: string | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(n) ? 0 : n;
  }

  cycleLabel(cycle: string): string {
    switch (cycle) {
      case 'monthly': return 'mes';
      case 'quarterly': return 'trimestre';
      case 'semiannual': return 'semestre';
      case 'annual':
      case 'yearly':
        return 'año';
      case 'lifetime': return 'pago único';
      default: return cycle;
    }
  }

  kindLabel(
    kind:
      | 'upgrade'
      | 'downgrade'
      | 'same-tier'
      | 'trial_plan_swap'
      | 're_subscribe',
  ): string {
    switch (kind) {
      case 'upgrade': return 'Mejora';
      case 'downgrade': return 'Cambio menor';
      case 'same-tier': return 'Mismo nivel';
      case 'trial_plan_swap': return 'Cambio durante prueba';
      case 're_subscribe': return 'Reactivación';
    }
  }

  /**
   * True when the proration preview signals that the current subscription is
   * `cancelled` or `expired`. Drives a different layout: no "días restantes"
   * notice, no proration badge, single CTA "Reactivar y pagar".
   */
  readonly isResubscribe = computed(
    () => this.proration()?.kind === 're_subscribe',
  );
}
