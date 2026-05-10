import { Component, inject, OnInit, computed, signal, DestroyRef, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { StoreSettingsService } from './services/store-settings.service';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { GeneralSettingsForm } from './components/general-settings-form/general-settings-form.component';
import { InventorySettingsForm } from './components/inventory-settings-form/inventory-settings-form.component';
import { NotificationsSettingsForm } from './components/notifications-settings-form/notifications-settings-form.component';
import { PosSettingsForm } from './components/pos-settings-form/pos-settings-form.component';
import { ReceiptsSettingsForm } from './components/receipts-settings-form/receipts-settings-form.component';
import { AppSettingsForm } from './components/app-settings-form/app-settings-form.component';
import { OperationsSettingsForm } from './components/operations-settings-form/operations-settings-form.component';
import { LucideAngularModule } from "lucide-angular";
import { IconComponent } from '../../../../../shared/components/index';
import { ScrollableTabsComponent } from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { StickyHeaderComponent, StickyHeaderBadgeColor, StickyHeaderActionButton } from '../../../../../shared/components/sticky-header/sticky-header.component';
import { ConfigFacade } from '../../../../../core/store/config';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { firstValueFrom } from 'rxjs';


@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [
    LucideAngularModule,
    IconComponent,
    GeneralSettingsForm,
    InventorySettingsForm,
    NotificationsSettingsForm,
    PosSettingsForm,
    ReceiptsSettingsForm,
    AppSettingsForm,
    OperationsSettingsForm,
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

  readonly sections = [
    { id: 'identity', label: 'Identidad', icon: 'user' },
    { id: 'branding', label: 'Marca', icon: 'palette' },
    { id: 'inventory', label: 'Inventario', icon: 'package' },
    { id: 'operations', label: 'Operaciones', icon: 'clock' },
    { id: 'notifications', label: 'Alertas', icon: 'bell' },
    { id: 'pos', label: 'POS', icon: 'monitor' },
    { id: 'receipts', label: 'Recibos', icon: 'file-text' },
  ];

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
    this.loadSettings();
    this.resolveStoreAppUrl();
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

  loadSettings() {
    this.settings_service.getSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const data = { ...(response.data as StoreSettings) };
        if ((data as any).shipping) {
          delete (data as any).shipping;
        }
        this.settings.set(data);
        this.isLoading.set(false);
        this.hasUnsavedChanges.set(false);
        this.settingsLoaded.set(true);
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
        'general', 'inventory', 'checkout', 'notifications', 'pos', 'receipts', 'app', 'operations',
      ];
      const currentSettings = this.settings();
      const sanitizedSettings = knownSections.reduce((acc, key) => {
        if (currentSettings[key] !== undefined) {
          (acc as any)[key] = currentSettings[key];
        }
        return acc;
      }, {} as Partial<StoreSettings>);

      // Save all settings
      this.settings_service.saveSettingsNow(sanitizedSettings).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.isSaving.set(false);
          this.hasUnsavedChanges.set(false);
          this.lastSaved.set(new Date());
        },
        error: (error) => {
          this.isSaving.set(false);
          console.error('Error saving settings:', error);
          this.toast_service.error('Error saving settings');
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
