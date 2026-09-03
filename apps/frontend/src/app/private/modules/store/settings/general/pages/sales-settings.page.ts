import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { PosSettingsForm } from '../components/pos-settings-form/pos-settings-form.component';
import { ReceiptsSettingsForm } from '../components/receipts-settings-form/receipts-settings-form.component';
import { PromotionsSettingsForm } from '../components/promotions-settings-form/promotions-settings-form.component';
import { SettingsSectionComponent } from '../components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../services/general-settings.store';

/**
 * Pestaña «Venta»: cómo se cobra y qué documento sale impreso.
 *
 * Reúne «Punto de Venta», «Recibos y Facturación», «Formatos de Impresión» y «Promociones».
 * Las cuatro viven juntas a propósito: el store se encarga de persistir cada bloque.
 */
@Component({
  selector: 'app-sales-settings-page',
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    SettingsSectionComponent,
    PosSettingsForm,
    ReceiptsSettingsForm,
    PromotionsSettingsForm,
  ],
  template: `
    <div class="settings-page">
      <div class="page-intro">
        <div class="page-intro__icon">
          <app-icon name="shopping-cart" size="16"></app-icon>
        </div>
        <p class="page-intro__text">
          <span class="page-intro__lead">Gobierna el mostrador.</span>
          Lo que configures acá lo siente el cajero en cada venta: qué puede
          hacer el punto de venta, qué documento respalda la operación y con qué
          formato sale por la impresora.
        </p>
      </div>

      <!-- Promociones y Descuentos -->
      <app-settings-section
        anchorId="section-promotions"
        icon="tag"
        iconTone="green"
        title="Promociones y Descuentos"
        hint="Define si las promociones compiten (Winner-Takes-All) o se acumulan inteligentemente (Stacking Groups).">
        <app-promotions-settings-form
          [settings]="store.settings().promotions"
          [settingsLoaded]="store.settingsLoaded()"
          (settingsChange)="store.onSectionChange('promotions', $event)" />
      </app-settings-section>

      <!-- Punto de Venta -->
      <app-settings-section
        anchorId="section-pos"
        icon="monitor"
        iconTone="orange"
        title="Punto de Venta (POS)"
        hint="Aplica a todos los cajeros de esta tienda, no sólo a tu sesión.">
        <app-pos-settings-form
          [settings]="store.settings().pos"
          [settingsLoaded]="store.settingsLoaded()"
          (settingsChange)="store.onSectionChange('pos', $event)" />
      </app-settings-section>

      <!-- Recibos y Facturación — el título depende del estado real de emisión
           (GET dian-config/emission-status), no de que el wizard fiscal esté
           completo. -->
      <app-settings-section
        anchorId="section-receipts"
        icon="file-text"
        iconTone="indigo"
        [title]="
          store.electronicInvoicingActive()
            ? 'Facturación Electrónica'
            : 'Recibos y Facturación'
        "
        hint="Define qué documento respalda la venta y si se imprime solo al cobrar.">
        <app-receipts-settings-form
          [settings]="store.settings().receipts"
          [emissionStage]="store.emissionStage()"
          [pendingReason]="store.emissionReason()"
          [pendingBlockers]="store.emissionBlockers()"
          [posAutoPrint]="store.posAutoPrint()"
          [posTicketPrintFormat]="store.posTicketPrintFormat()"
          [invoicePrintFormat]="store.invoicePrintFormat()"
          (settingsChange)="store.onReceiptsChange($event)"
          (posAutoPrintChange)="store.onPosAutoPrintChange($event)" />
      </app-settings-section>

      <!-- Formatos de Impresión — Centralizados en el Hub -->
      <app-settings-section
        anchorId="section-printing"
        icon="printer"
        iconTone="indigo"
        title="Formatos de Impresión"
        hint="Diseño, márgenes, papel y auto-impresión de los 16 tipos de documentos de la tienda.">
        <div class="p-4 rounded-xl bg-surface-secondary border border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div class="space-y-1">
            <p class="text-xs font-semibold text-text-primary">Hub de Formatos Centralizado</p>
            <p class="text-xs text-text-secondary">
              Personaliza el diseño visual, papel térmico/hojas, copias y flags de auto-impresión para tiquetes POS, facturas electrónicas y guías desde un solo lugar.
            </p>
          </div>
          <a
            routerLink="/admin/settings/print-formats"
            class="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition whitespace-nowrap shadow-sm"
          >
            <app-icon name="printer" [size]="14"></app-icon>
            Ir al Hub de Formatos
          </a>
        </div>
      </app-settings-section>
    </div>
  `,
  styleUrls: ['./_settings-page.scss'],
})
export class SalesSettingsPage {
  protected readonly store = inject(GeneralSettingsStore);
}
