import { Component, inject, OnInit, computed, signal, DestroyRef, effect, viewChild } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { StoreSettingsService, StoreSettingsRequestOptions } from './services/store-settings.service';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { DianEmissionStatus } from '../../invoicing/interfaces/invoice.interface';
import { EmissionStage } from './components/receipts-settings-form/receipts-settings-form.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { GeneralSettingsForm } from './components/general-settings-form/general-settings-form.component';
import { ServicesSettingsForm } from './components/services-settings-form/services-settings-form.component';
import { ReservationsSettingsForm } from './components/reservations-settings-form/reservations-settings-form.component';
import { InventorySettingsForm } from './components/inventory-settings-form/inventory-settings-form.component';
import { NotificationsSettingsForm } from './components/notifications-settings-form/notifications-settings-form.component';
import { PosSettingsForm } from './components/pos-settings-form/pos-settings-form.component';
import { ReceiptsSettingsForm } from './components/receipts-settings-form/receipts-settings-form.component';
import { AppSettingsForm } from './components/app-settings-form/app-settings-form.component';
import { OperationsSettingsForm } from './components/operations-settings-form/operations-settings-form.component';
import { DispatchSettingsForm } from './components/dispatch-settings-form/dispatch-settings-form.component';
import { CarrierSettingsForm } from './components/carrier-settings-form/carrier-settings-form.component';
import { RestaurantSettingsForm } from './components/restaurant-settings-form/restaurant-settings-form.component';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from "lucide-angular";
import { IconComponent, SettingToggleComponent } from '../../../../../shared/components/index';
import { ScrollableTabsComponent } from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { StickyHeaderComponent, StickyHeaderBadgeColor, StickyHeaderActionButton } from '../../../../../shared/components/sticky-header/sticky-header.component';
import { ConfigFacade } from '../../../../../core/store/config';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { firstValueFrom } from 'rxjs';


@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [
    LucideAngularModule,
    IconComponent,
    GeneralSettingsForm,
    ServicesSettingsForm,
    ReservationsSettingsForm,
    InventorySettingsForm,
    NotificationsSettingsForm,
    PosSettingsForm,
    ReceiptsSettingsForm,
    AppSettingsForm,
    OperationsSettingsForm,
    DispatchSettingsForm,
    CarrierSettingsForm,
    RestaurantSettingsForm,
    SettingToggleComponent,
    FormsModule,
    ScrollableTabsComponent,
    StickyHeaderComponent
],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss'],
})
export class GeneralSettingsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private settings_service = inject(StoreSettingsService);
  private toast_service = inject(ToastService);
  private configFacade = inject(ConfigFacade);
  private authFacade = inject(AuthFacade);
  private invoicingService = inject(InvoicingService);

  /** Reference to the embedded GeneralSettingsForm so we can read
   * the services FormGroup and pass it to the standalone
   * ServicesSettingsForm card. */
  readonly generalForm = viewChild<GeneralSettingsForm>('generalForm');

  /**
   * Signal that mirrors the current value of `industriesControl`
   * inside the GeneralSettingsForm sub-form. We need this because
   * FormControl.value is a getter, not a signal — so reading it
   * inside a `computed` only samples the initial value, not later
   * user changes. An `effect` subscribes to `valueChanges` and
   * pushes every emit into a `signal` that the template can react to.
   */
  private readonly industriesSignal = signal<string[]>([]);

  constructor() {
    // Whenever the GeneralSettingsForm sub-form mounts, wire up
    // the industries FormControl's valueChanges to our local signal.
    effect(() => {
      const form = this.generalForm();
      // eslint-disable-next-line no-console
      console.log('[general-settings] effect tick, form =', form ? 'PRESENT' : 'undefined');
      if (!form) return;
      const sub = form.industriesControl.valueChanges.subscribe(
        (value: string[] | null | undefined) => {
          // eslint-disable-next-line no-console
          console.log('[general-settings] industries changed:', value);
          this.industriesSignal.set(value ?? []);
        },
      );
      // Seed the signal with the current value so we don't need to
      // wait for the first change to render correctly.
      this.industriesSignal.set(form.industriesControl.value ?? []);
      this.destroyRef.onDestroy(() => sub.unsubscribe());
    });
  }

  /** Show the 'Servicios' card only when 'service' is one of the
   * selected industries. */
  readonly showServicesSection = computed(() =>
    this.industriesSignal().includes('service'),
  );

  isVendixDomain = signal(false);
  storeAppUrl = signal<string | null>(null);

  settings = signal<StoreSettings>({} as StoreSettings);
  isLoading = signal(true);
  settingsLoaded = signal(false);
  isSaving = signal(false);
  hasUnsavedChanges = signal(false);
  lastSaved = signal<Date | null>(null);
  activeSection = signal('identity');

  showTemplates = signal(false);
  templates = signal<any[]>([]);

  pendingAppLogo = signal<{ file: File; preview: string } | null>(null);
  pendingAppFavicon = signal<{ file: File; preview: string } | null>(null);

  /**
   * True when the active store is a restaurant. Gates the "Mesas" settings
   * section (tab + form). Source of truth is the industries cascade resolved
   * by `AuthFacade.isRestaurant` (settings → login → []).
   */
  readonly isRestaurant = this.authFacade.isRestaurant;

  /**
   * True when the active store is a gym. Gates the "Zona Fit" settings
   * section (tab + toggle). Source of truth is the industries cascade resolved
   * by `AuthFacade.isGym` (settings → login → []).
   */
  readonly isGym = this.authFacade.isGym;

  /**
   * Real emission state, from `GET dian-config/emission-status`.
   *
   * This used to be derived from `fiscal_status.invoicing.state` (ACTIVE or
   * LOCKED), which only means the fiscal wizard was completed. A store with its
   * DIAN test set still pending was therefore shown "Facturación electrónica
   * activa" and lost the sale-receipt controls it must keep using until the
   * habilitación reaches production.
   */
  private readonly emissionStatus = signal<DianEmissionStatus | null>(null);

  readonly electronicInvoicingActive = computed(
    () => this.emissionStatus()?.is_live === true,
  );

  /**
   * `pending` = there IS a DIAN configuration but it is not emitting yet, so the
   * section keeps the receipt controls and explains the trámite. `receipts` =
   * nothing configured (also the fallback when the status cannot be read, which
   * must never silently switch a store to invoice-only).
   */
  readonly emissionStage = computed<EmissionStage>(() => {
    const status = this.emissionStatus();
    if (!status) return 'receipts';
    if (status.is_live) return 'live';
    return status.configuration_id ? 'pending' : 'receipts';
  });

  readonly emissionReason = computed(() => this.emissionStatus()?.reason ?? null);

  readonly emissionBlockers = computed(() =>
    (this.emissionStatus()?.blockers ?? []).map((blocker) => ({
      label: blocker.label,
      action: blocker.action,
    })),
  );

  /** `pos.auto_print_receipt`, edited from the Recibos section too. */
  readonly posAutoPrint = computed(
    () => this.settings().pos?.auto_print_receipt ?? false,
  );

  private loadEmissionStatus(): void {
    this.invoicingService
      .getDianEmissionStatus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.emissionStatus.set(response?.data ?? null),
        // Falling back to `receipts` on error/403 is the safe direction: showing
        // receipt controls to a store that already invoices is a cosmetic
        // annoyance, while hiding them from a store that still needs them stops
        // it from documenting its sales.
        error: () => this.emissionStatus.set(null),
      });
  }

  readonly sections = computed(() => {
    const base = [
      { id: 'identity', label: 'Identidad', icon: 'user' },
      { id: 'branding', label: 'Marca', icon: 'palette' },
      { id: 'inventory', label: 'Inventario', icon: 'package' },
      { id: 'operations', label: 'Operaciones', icon: 'clock' },
      { id: 'reservations', label: 'Reservas', icon: 'calendar-clock' },
      { id: 'dispatch', label: 'Despacho', icon: 'truck' },
      { id: 'reparto', label: 'Reparto', icon: 'coins' },
      { id: 'notifications', label: 'Alertas', icon: 'bell' },
      { id: 'pos', label: 'POS', icon: 'monitor' },
      {
        id: 'receipts',
        label: this.electronicInvoicingActive() ? 'Facturación' : 'Recibos',
        icon: 'file-text',
      },
    ];
    if (this.isRestaurant()) {
      // Insert "Mesas" right after "Operaciones" for restaurants only.
      const dispatchIndex = base.findIndex((s) => s.id === 'dispatch');
      base.splice(dispatchIndex, 0, { id: 'restaurant', label: 'Mesas', icon: 'utensils' });
    }
    if (this.isGym()) {
      // Insert "Zona Fit" right before "Despacho" for gyms only.
      const dispatchIndex = base.findIndex((s) => s.id === 'dispatch');
      base.splice(dispatchIndex, 0, { id: 'membership', label: 'Zona Fit', icon: 'dumbbell' });
    }
    return base;
  });

  readonly badgeText = computed(() =>
    this.hasUnsavedChanges() ? 'Pendiente de Guardar' : 'Sincronizado'
  );

  readonly badgeColor = computed<StickyHeaderBadgeColor>(() =>
    this.hasUnsavedChanges() ? 'yellow' : 'green'
  );

  readonly badgePulse = computed(() => this.hasUnsavedChanges());

  readonly metadataContent = computed(() =>
    this.lastSaved() ? `Último guardado: ${this.formatLastSaved()}` : ''
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'reset', label: 'Restablecer', variant: 'outline-danger', icon: 'rotate-ccw' },
    {
      id: 'save',
      label: 'Guardar Cambios',
      variant: 'primary',
      icon: 'save',
      loading: this.isSaving(),
      disabled: !this.hasUnsavedChanges() && !this.isSaving()
    }
  ]);

  private readonly configEffect = effect(() => {
    this.isVendixDomain.set(!!this.configFacade.getCurrentConfig()?.domainConfig?.isVendixDomain);
  });

  ngOnInit() {
    // forceRefresh: true on mount too — the 60s cache would otherwise
    // return the stale pre-save response after navigation, and the form
    // would re-mount without the persisted `services` sub-section.
    this.loadSettings({ forceRefresh: true });
    this.resolveStoreAppUrl();
    this.loadEmissionStatus();
  }

  private resolveStoreAppUrl(): void {
    const hostname = this.authFacade.userDomainHostname();
    const slug = this.authFacade.userOrganizationSlug();
    if (hostname) {
      this.storeAppUrl.set(`${window.location.protocol}//${hostname}`);
    } else if (slug) {
      this.storeAppUrl.set('/' + slug);
    }
  }

  loadSettings(options: StoreSettingsRequestOptions = {}) {
    this.settings_service.getSettings(options).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const data = { ...(response.data as StoreSettings) };
        if ((data as any).shipping) {
          delete (data as any).shipping;
        }
        this.settings.set(data);
        this.isLoading.set(false);
        this.hasUnsavedChanges.set(false);
        this.settingsLoaded.set(true);

        // QUI-289 — el sidebar (y el header móvil) pintan el logo desde
        // `user.store.logo_url` del snapshot de auth, que sólo se hidrataba en
        // login: guardar un logo nuevo persistía bien pero el panel seguía
        // mostrando el viejo hasta re-loguear. Este GET es la fuente
        // autoritativa — el backend firma la clave S3 aquí —, así que cada
        // lectura canónica (montaje, post-guardado, post-reset) resincroniza el
        // snapshot. `null` es válido: significa que la tienda quedó sin logo.
        this.authFacade.updateStoreLogo(data.general?.logo_url ?? null);
      },
      error: (error) => {
        console.error('Error loading settings:', error);
        this.toast_service.error('Error loading settings');
        this.isLoading.set(false);
      },
    });
  }

  loadTemplates() {
    this.settings_service.getSystemTemplates().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.templates.set(response.data);
      },
      error: (error) => {
        console.error('Error loading templates:', error);
        this.toast_service.error('Error loading templates');
      },
    });
  }

  onSectionChange(section: keyof StoreSettings, new_settings: any) {
    this.settings.update((s) => ({ ...s, [section]: new_settings }));
    this.hasUnsavedChanges.set(true);
    this.lastSaved.set(null);
  }

  /**
   * Recursively mark every control in the form (and nested sub-groups)
   * as touched + dirty so the red error messages surface under each
   * invalid field. Used right before showing the 'incomplete form'
   * toast so the user can see WHICH fields are missing.
   */
  private markAllAsTouched(form: FormGroup): void {
    form.markAllAsTouched();
    Object.values(form.controls).forEach((ctrl) => {
      if (ctrl instanceof FormGroup) {
        this.markAllAsTouched(ctrl);
      } else {
        ctrl.markAsDirty();
      }
    });
  }

  /**
   * The Recibos section edits `pos.auto_print_receipt`, which belongs to the POS
   * block. Routed here instead of copying the flag into `receipts` so the setting
   * keeps a single home.
   */
  onPosAutoPrintChange(value: boolean): void {
    this.onSectionChange('pos', {
      ...(this.settings().pos ?? {}),
      auto_print_receipt: value,
    });
  }

  onPendingAppLogo(event: { file: File; preview: string } | null): void {
    this.pendingAppLogo.set(event);
    this.hasUnsavedChanges.set(true);
  }

  onPendingAppFavicon(event: { file: File; preview: string } | null): void {
    this.pendingAppFavicon.set(event);
    this.hasUnsavedChanges.set(true);
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'reset') this.resetToDefaults();
    else if (actionId === 'save') this.saveAllSettings();
  }

  scrollToSection(sectionId: string): void {
    this.activeSection.set(sectionId);
    const el = document.getElementById(`section-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private formatLastSaved(): string {
    const lastSaved = this.lastSaved();
    if (!lastSaved) return '';
    const date = new Date(lastSaved);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async saveAllSettings() {
    this.isSaving.set(true);

    // Validate the GeneralSettingsForm (which embeds the services
    // sub-form) before any save. If the user has enabled
    // '¿Ofrece servicio a domicilio?' but left the required address
    // fields empty, the form is invalid and the toast surfaces the
    // specific reason.
    const generalForm = this.generalForm();
    if (generalForm && generalForm.form.invalid) {
      this.markAllAsTouched(generalForm.form);
      this.toast_service.error(
        'Ingrese la dirección en el apartado de Servicio',
      );
      this.isSaving.set(false);
      return;
    }

    if ((this.settings() as any).shipping) {
      this.settings.update((s) => {
        const { shipping, ...rest } = s as any;
        return rest as StoreSettings;
      });
    }

    try {
      const uploads: Promise<void>[] = [];

      const pendingLogo = this.pendingAppLogo();
      if (pendingLogo) {
        const logoFile = pendingLogo.file;
        uploads.push(
          firstValueFrom(this.settings_service.uploadStoreLogo(logoFile)).then((result) => {
            this.settings.update((s) => ({
              ...s,
              app: { ...s.app, logo_url: result.key },
              general: { ...s.general, logo_url: result.key },
            }));
            this.pendingAppLogo.set(null);
          }),
        );
      }

      const pendingFavicon = this.pendingAppFavicon();
      if (pendingFavicon) {
        const faviconFile = pendingFavicon.file;
        uploads.push(
          firstValueFrom(this.settings_service.uploadStoreFavicon(faviconFile)).then((result) => {
            this.settings.update((s) => ({ ...s, app: { ...s.app, favicon_url: result.key } }));
            this.pendingAppFavicon.set(null);
          }),
        );
      }

      if (uploads.length > 0) {
        await Promise.all(uploads);
      }

      const knownSections: (keyof StoreSettings)[] = [
        'general', 'inventory', 'checkout', 'notifications', 'pos', 'receipts', 'app', 'operations', 'dispatch', 'carrier', 'restaurant', 'membership', 'panel_ui', 'reservations',
      ];
      const currentSettings = this.settings();
      const sanitizedSettings = knownSections.reduce((acc, key) => {
        if (currentSettings[key] !== undefined) {
          (acc as any)[key] = currentSettings[key];
        }
        return acc;
      }, {} as Partial<StoreSettings>);

      // The 'services' sub-form lives outside the top-level sections
      // (it's a sub-form rendered as its own card). Take the current
      // value from the GeneralSettingsForm and persist it as
      // `store_settings.settings.services.*` on the backend.
      const generalForm = this.generalForm();
      if (generalForm) {
        const servicesValue = generalForm.form.get('services')?.value;
        if (servicesValue) {
          (sanitizedSettings as any).services = servicesValue;
        }
      }

      // Save all settings. After the save succeeds, re-read the
      // settings from the backend so the `settings` signal reflects
      // the canonical state — including any defaults the backend
      // might apply to fields the frontend didn't send. Without this
      // re-read, navigating away and back would re-mount the
      // GeneralSettingsForm with the in-memory 'settings' value,
      // which can be stale if the backend normalized anything.
      this.settings_service.saveSettingsNow(sanitizedSettings).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.isSaving.set(false);
          this.hasUnsavedChanges.set(false);
          this.lastSaved.set(new Date());
          // CRITICAL: forceRefresh: true to bypass the 60s settings cache.
          // Without this, loadSettings() returns the stale pre-save
          // response (which lacks `services`), and the form re-mounts
          // with the address fields empty even though the save
          // persisted correctly.
          this.loadSettings({ forceRefresh: true });
        },
        error: (error) => {
          this.isSaving.set(false);

          // QUI-560 — antes se mostraba un literal en inglés y se descartaba
          // `error_code`, así que un rechazo del guard de transición llegaba al
          // usuario como "Error saving settings" y sin decirle qué hacer.
          const parsed = parseApiError(error);
          console.error(
            `Error saving settings [${parsed.errorCode ?? 'sin código'}]:`,
            parsed.devMessage ?? error,
          );
          this.toast_service.error(parsed.userMessage);

          // El estado local quedó con el valor rechazado; sin resincronizar, la
          // UI mostraría un settings que la DB nunca aceptó.
          this.loadSettings();
        },
      });
    } catch (error) {
      this.isSaving.set(false);
      console.error('Error uploading files:', error);
      this.toast_service.error('Error al subir archivos');
    }
  }

  resetToDefaults() {
    if (
      confirm(
        '¿Estás seguro de restablecer todas las configuraciones a valores por defecto?',
      )
    ) {
      this.settings_service.resetToDefault().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.loadSettings(),
        error: (error) => {
          console.error('Error resetting settings:', error);
          this.toast_service.error('Error resetting settings');
        },
      });
    }
  }

  openTemplates() {
    this.showTemplates.set(true);
    this.loadTemplates();
  }

  applyTemplate(template_name: string) {
    if (
      confirm(
        `¿Aplicar la plantilla "${template_name}"? Esto reemplazará toda la configuración actual.`,
      )
    ) {
      this.settings_service.applyTemplate(template_name).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (response) => {
          this.settings.set(response.data);
          this.showTemplates.set(false);
          this.toast_service.success('Plantilla aplicada correctamente');
        },
        error: (error) => {
          console.error('Error applying template:', error);
          this.toast_service.error('Error aplicando plantilla');
        },
      });
    }
  }

}
