import { Component, effect, inject, signal } from '@angular/core';
import {
  FormGroup,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  InputComponent,
  ButtonComponent,
  CardComponent,
  ToggleComponent,
  SpinnerComponent,
  AlertBannerComponent,
  IconComponent,
  StickyHeaderComponent,
  TableComponent,
  TableColumn,
  TableAction,
} from '../../../../../shared/components';
import { OrganizationSettingsService } from '../services/organization-settings.service';

interface DomainItem {
  id: number;
  name: string;
  domain: string;
  is_primary: boolean;
  is_verified: boolean;
  created_at: string;
}

@Component({
  selector: 'app-domains',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    CardComponent,
    ToggleComponent,
    SpinnerComponent,
    AlertBannerComponent,
    IconComponent,
    StickyHeaderComponent,
    TableComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Gestión de Dominios"
        subtitle="Configura los dominios de tu organización"
        icon="globe-2"
        [showBackButton]="true"
        backRoute="/organization/config"
      ></app-sticky-header>

      <div class="mt-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner size="lg" text="Cargando dominios..."></app-spinner>
          </div>
        } @else if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            {{ error() }}
            <button class="ml-3 underline font-semibold" (click)="dismissError()">Cerrar</button>
          </app-alert-banner>
        } @else {
          <div class="space-y-6">
            <!-- Add New Domain -->
            <app-card [responsivePadding]="true">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <app-icon name="plus-circle" size="18"></app-icon>
                Agregar dominio
              </h3>

              <form [formGroup]="addDomainForm" class="flex gap-4 items-end">
                <app-input
                  label="Nombre del dominio"
                  placeholder="mi-dominio.com"
                  formControlName="domain"
                  [customWrapperClass]="'flex-1'"
                ></app-input>

                <app-input
                  label="Nombre para mostrar"
                  placeholder="Mi Tienda"
                  formControlName="name"
                ></app-input>

                <app-button
                  variant="primary"
                  icon="plus"
                  [disabled]="addDomainForm.invalid"
                  (clicked)="onAddDomain()"
                >
                  Agregar
                </app-button>
              </form>
            </app-card>

            <!-- Domains List -->
            <app-card [responsivePadding]="true">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <app-icon name="list" size="18"></app-icon>
                Dominios configurados
              </h3>

              @if (domains().length === 0) {
                <div class="text-center py-8 text-gray-500">
                  <app-icon name="globe" size="48" class="mx-auto mb-3 opacity-50"></app-icon>
                  <p>No hay dominios configurados</p>
                </div>
              } @else {
                <app-table
                  [data]="domains()"
                  [columns]="columns"
                  [actions]="actions"
                  [striped]="true"
                ></app-table>
              }
            </app-card>

            <!-- Domain Settings -->
            <app-card [responsivePadding]="true">
              <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                <app-icon name="settings" size="18"></app-icon>
                Configuración general
              </h3>

              <form [formGroup]="form" class="space-y-4">
                <app-toggle
                  label="Redirección HTTPS automática"
                  description="Todos los accesos via HTTP se redirigen a HTTPS"
                  formControlName="auto_https_redirect"
                ></app-toggle>

                <app-toggle
                  label="WWW obligatorio"
                  description="Requerir el prefijo www en todas las URLs"
                  formControlName="require_www"
                ></app-toggle>

                <app-toggle
                  label="SSL estricto"
                  description="Solo permitir conexiones SSL válidas"
                  formControlName="strict_ssl"
                ></app-toggle>

                <div class="flex justify-end pt-4">
                  <app-button
                    variant="primary"
                    [loading]="saving()"
                    [disabled]="form.pristine"
                    (clicked)="onSave()"
                  >
                    Guardar configuración
                  </app-button>
                </div>
              </form>
            </app-card>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class DomainsComponent {
  private settingsService = inject(OrganizationSettingsService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly domains = signal<DomainItem[]>([]);

  addDomainForm = new FormGroup({
    domain: new FormControl('', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true }),
  });

  form = new FormGroup({
    auto_https_redirect: new FormControl(true, { nonNullable: true }),
    require_www: new FormControl(false, { nonNullable: true }),
    strict_ssl: new FormControl(true, { nonNullable: true }),
  });

  readonly columns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
    },
    {
      key: 'domain',
      label: 'Dominio',
      sortable: true,
    },
    {
      key: 'is_primary',
      label: 'Primario',
      transform: (value) => value ? 'Sí' : 'No',
    },
    {
      key: 'is_verified',
      label: 'Verificado',
      transform: (value) => value ? 'Verificado' : 'Pendiente',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          verified: 'bg-green-100 text-green-700',
          pending: 'bg-yellow-100 text-yellow-700',
        },
      },
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Verificar',
      icon: 'check-circle',
      variant: 'success',
      show: (item) => !item.is_verified,
      action: (item) => this.verifyDomain(item),
    },
    {
      label: (item) => item.is_primary ? 'Quitar primario' : 'Hacer primario',
      icon: (item) => item.is_primary ? 'x-circle' : 'star',
      variant: 'secondary',
      action: (item) => this.setPrimaryDomain(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item) => this.removeDomain(item),
    },
  ];

  constructor() {
    this.settingsService.getSettings().pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.loading.set(this.settingsService.loading());
      this.saving.set(this.settingsService.saving());
      this.error.set(this.settingsService.error());

      if (settings) {
        const domainSettings = (settings as any).domains || {};
        const domainList: DomainItem[] = domainSettings.list || [];
        this.domains.set(domainList);

        this.form.patchValue(
          {
            auto_https_redirect: domainSettings.auto_https_redirect ?? true,
            require_www: domainSettings.require_www ?? false,
            strict_ssl: domainSettings.strict_ssl ?? true,
          },
          { emitEvent: false },
        );
        this.form.markAsPristine();
      }
    });
  }

  onAddDomain(): void {
    if (this.addDomainForm.invalid) return;

    const { domain, name } = this.addDomainForm.value;
    const newDomain: DomainItem = {
      id: Date.now(),
      name: name ?? '',
      domain: domain ?? '',
      is_primary: this.domains().length === 0,
      is_verified: false,
      created_at: new Date().toISOString(),
    };

    this.domains.update((list) => [...list, newDomain]);
    this.addDomainForm.reset();
    this.emitDomainsUpdate();
  }

  verifyDomain(item: DomainItem): void {
    this.domains.update((list) =>
      list.map((d) => (d.id === item.id ? { ...d, is_verified: true } : d)),
    );
    this.emitDomainsUpdate();
  }

  setPrimaryDomain(item: DomainItem): void {
    this.domains.update((list) =>
      list.map((d) => ({ ...d, is_primary: d.id === item.id })),
    );
    this.emitDomainsUpdate();
  }

  removeDomain(item: DomainItem): void {
    this.domains.update((list) => list.filter((d) => d.id !== item.id));
    this.emitDomainsUpdate();
  }

  onSave(): void {
    if (this.form.pristine || this.saving()) return;

    const domainSettings = {
      list: this.domains(),
      auto_https_redirect: this.form.value.auto_https_redirect,
      require_www: this.form.value.require_www,
      strict_ssl: this.form.value.strict_ssl,
    };

    this.settingsService.saveSettings({ domains: domainSettings } as any).subscribe({
      next: () => this.form.markAsPristine(),
      error: () => {},
    });
  }

  private emitDomainsUpdate(): void {
    const domainSettings = {
      list: this.domains(),
      auto_https_redirect: this.form.value.auto_https_redirect,
      require_www: this.form.value.require_www,
      strict_ssl: this.form.value.strict_ssl,
    };
    this.settingsService.saveSettings({ domains: domainSettings } as any).subscribe();
  }

  dismissError(): void {
    this.error.set(null);
  }
}