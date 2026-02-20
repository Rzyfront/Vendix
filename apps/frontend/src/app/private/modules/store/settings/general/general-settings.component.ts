import { Component, inject, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreSettingsService } from './services/store-settings.service';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { GeneralSettingsForm } from './components/general-settings-form/general-settings-form.component';
import { InventorySettingsForm } from './components/inventory-settings-form/inventory-settings-form.component';
import { NotificationsSettingsForm } from './components/notifications-settings-form/notifications-settings-form.component';
import { PosSettingsForm } from './components/pos-settings-form/pos-settings-form.component';
import { ReceiptsSettingsForm } from './components/receipts-settings-form/receipts-settings-form.component';
import { AppSettingsForm } from './components/app-settings-form/app-settings-form.component';
import { LucideAngularModule } from "lucide-angular";
import { IconComponent } from '../../../../../shared/components/index';
import { StickyHeaderComponent, StickyHeaderBadgeColor, StickyHeaderActionButton } from '../../../../../shared/components/sticky-header/sticky-header.component';
import { ConfigFacade } from '../../../../../core/store/config';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { combineLatest } from 'rxjs';
import { take } from 'rxjs/operators';


@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [
    CommonModule, LucideAngularModule,
    IconComponent,
    GeneralSettingsForm,
    InventorySettingsForm,
    NotificationsSettingsForm,
    PosSettingsForm,
    ReceiptsSettingsForm,
    AppSettingsForm,
    StickyHeaderComponent
  ],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss'],
})
export class GeneralSettingsComponent implements OnInit {
  private settings_service = inject(StoreSettingsService);
  private toast_service = inject(ToastService);
  private configFacade = inject(ConfigFacade);
  private authFacade = inject(AuthFacade);

  isVendixDomain = false;
  storeAppUrl: string | null = null;

  settings: StoreSettings = {} as StoreSettings;
  isLoading = signal(true);
  isSaving = signal(false);
  hasUnsavedChanges = signal(false);
  lastSaved = signal<Date | null>(null);
  activeSection = signal('identity');

  showTemplates = false;
  templates: any[] = [];

  readonly sections = [
    { id: 'identity', label: 'Identidad', icon: 'user' },
    { id: 'branding', label: 'Marca', icon: 'palette' },
    { id: 'inventory', label: 'Inventario', icon: 'package' },
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

  ngOnInit() {
    this.loadSettings();
    this.isVendixDomain = !!this.configFacade.getCurrentConfig()?.domainConfig?.isVendixDomain;
    this.resolveStoreAppUrl();
  }

  private resolveStoreAppUrl(): void {
    combineLatest([
      this.authFacade.userDomainHostname$,
      this.authFacade.userOrganizationSlug$,
    ]).pipe(take(1)).subscribe(([hostname, slug]) => {
      if (hostname) {
        this.storeAppUrl = `${window.location.protocol}//${hostname}`;
      } else if (slug) {
        this.storeAppUrl = '/' + slug;
      }
    });
  }

  loadSettings() {
    this.settings_service.getSettings().subscribe({
      next: (response) => {
        this.settings = response.data;
        // Clean shipping data if present to prevent 400 Bad Request
        if ((this.settings as any).shipping) {
          delete (this.settings as any).shipping;
        }
        this.isLoading.set(false);
        this.hasUnsavedChanges.set(false);
      },
      error: (error) => {
        console.error('Error loading settings:', error);
        this.toast_service.error('Error loading settings');
        this.isLoading.set(false);
      },
    });
  }

  loadTemplates() {
    this.settings_service.getSystemTemplates().subscribe({
      next: (response) => {
        this.templates = response.data;
      },
      error: (error) => {
        console.error('Error loading templates:', error);
        this.toast_service.error('Error loading templates');
      },
    });
  }

  onSectionChange(section: keyof StoreSettings, new_settings: any) {
    this.settings = {
      ...this.settings,
      [section]: new_settings,
    };
    this.hasUnsavedChanges.set(true);
    this.lastSaved.set(null);
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

  saveAllSettings() {
    this.isSaving.set(true);
    // Ensure shipping is not sent
    if ((this.settings as any).shipping) {
      delete (this.settings as any).shipping;
    }

    this.settings_service.saveSettingsNow(this.settings).subscribe({
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
  }

  resetToDefaults() {
    if (
      confirm(
        '¿Estás seguro de restablecer todas las configuraciones a valores por defecto?',
      )
    ) {
      this.settings_service.resetToDefault().subscribe({
        next: () => this.loadSettings(),
        error: (error) => {
          console.error('Error resetting settings:', error);
          this.toast_service.error('Error resetting settings');
        },
      });
    }
  }

  openTemplates() {
    this.showTemplates = true;
    this.loadTemplates();
  }

  applyTemplate(template_name: string) {
    if (
      confirm(
        `¿Aplicar la plantilla "${template_name}"? Esto reemplazará toda la configuración actual.`,
      )
    ) {
      this.settings_service.applyTemplate(template_name).subscribe({
        next: (response) => {
          this.settings = response.data;
          this.showTemplates = false;
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
