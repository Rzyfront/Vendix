export const FISCAL_SETTINGS_TEMPLATE = `
  <div class="settings-page">
    <div class="page-intro">
      <div class="page-intro__icon">
        <app-icon name="receipt" size="16"></app-icon>
      </div>
      <p class="page-intro__text">
        <span class="page-intro__lead">Configuración fiscal de la tienda.</span>
        Define si la venta emite su factura electrónica sola. Las reglas AIU
        se configuran por documento o en
        <a routerLink="/admin/invoicing/profiles" class="link link--primary"
          >Perfiles de facturación</a
        >.
      </p>
    </div>

    <app-pos-invoicing-settings-section></app-pos-invoicing-settings-section>

    <!-- R3 — former Hotelería → "Servicios exentos"; /admin/hospitality/exempt-services lands here. -->
    @if (store.isHospitality()) {
      <app-settings-section
        anchorId="section-vat-exempt"
        icon="file-check"
        iconTone="purple"
        title="Servicios exentos de IVA (turistas extranjeros)"
        hint="Facturas de alojamiento con IVA 0 % y el pasaporte y permiso de cada huésped, como soporte de la exención.">
        <app-hospitality-vat-exempt-services-page (ready)="scrollToFragment()" />
      </app-settings-section>
    }
  </div>
`;
