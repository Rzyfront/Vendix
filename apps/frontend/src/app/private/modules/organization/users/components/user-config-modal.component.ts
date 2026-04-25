import { Component, OnInit, inject, OnChanges, input, output, model, signal, DestroyRef, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  TextareaComponent,
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User } from '../interfaces/user.interface';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { OrgRolesService } from '../../roles/services/org-roles.service';
import { OrganizationStoresService } from '../../stores/services/organization-stores.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { Role } from '../../roles/interfaces/role.interface';
import { StoreListItem } from '../../stores/interfaces/store.interface';

@Component({
  selector: 'app-user-config-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    TextareaComponent,
    MultiSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Configuración de Usuario"
      subtitle="Administra los roles, tiendas y configuraciones del panel UI"
    >
      @if (user()) {
        <form [formGroup]="configForm" (ngSubmit)="onSubmit()">
          <div class="flex border-b border-gray-200 dark:border-gray-700 mb-6">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'general'"
              [class.text-primary]="activeTab === 'general'"
              [class.border-transparent]="activeTab !== 'general'"
              [class.text-gray-500]="activeTab !== 'general'"
              (click)="activeTab = 'general'"
            >
              General
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'roles'"
              [class.text-primary]="activeTab === 'roles'"
              [class.border-transparent]="activeTab !== 'roles'"
              [class.text-gray-500]="activeTab !== 'roles'"
              (click)="activeTab = 'roles'"
            >
              Roles
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'stores'"
              [class.text-primary]="activeTab === 'stores'"
              [class.border-transparent]="activeTab !== 'stores'"
              [class.text-gray-500]="activeTab !== 'stores'"
              (click)="activeTab = 'stores'"
            >
              Tiendas
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium border-b-2 focus:outline-none transition-colors"
              [class.border-primary]="activeTab === 'panel_ui'"
              [class.text-primary]="activeTab === 'panel_ui'"
              [class.border-transparent]="activeTab !== 'panel_ui'"
              [class.text-gray-500]="activeTab !== 'panel_ui'"
              (click)="activeTab = 'panel_ui'"
            >
              Panel UI
            </button>
          </div>

          <div>
            @switch (activeTab) {
              @case ('general') {
                <div class="space-y-4">
                  <div class="space-y-2">
                    <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                      Aplicación Asignada
                    </label>
                    <select
                      formControlName="app"
                      class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
                    >
                      <option value="VENDIX_LANDING">VENDIX_LANDING</option>
                      <option value="ORG_ADMIN">ORG_ADMIN</option>
                      <option value="STORE_ADMIN">STORE_ADMIN</option>
                      <option value="STORE_ECOMMERCE">STORE_ECOMMERCE</option>
                    </select>
                    <p class="text-xs text-gray-500">
                      Selecciona la aplicación principal a la que tendrá acceso el usuario.
                    </p>
                  </div>
                </div>
              }
              @case ('roles') {
                <div class="space-y-4">
                  <app-multi-selector
                    [options]="roleOptions()"
                    [label]="'Roles Asignados'"
                    [placeholder]="'Seleccionar roles...'"
                    [helpText]="'Selecciona los roles que tendrá el usuario'"
                    formControlName="roles"
                  ></app-multi-selector>
                  @if (isLoadingRoles()) {
                    <p class="text-sm text-[var(--color-text-secondary)]">
                      <span class="inline-block animate-spin mr-1">⟳</span>
                      Cargando roles...
                    </p>
                  }
                </div>
              }
              @case ('stores') {
                <div class="space-y-4">
                  <app-multi-selector
                    [options]="storeOptions()"
                    [label]="'Tiendas Asignadas'"
                    [placeholder]="'Seleccionar tiendas...'"
                    [helpText]="'Selecciona las tiendas a las que tendrá acceso el usuario'"
                    formControlName="store_ids"
                  ></app-multi-selector>
                  @if (isLoadingStores()) {
                    <p class="text-sm text-[var(--color-text-secondary)]">
                      <span class="inline-block animate-spin mr-1">⟳</span>
                      Cargando tiendas...
                    </p>
                  }
                </div>
              }
              @case ('panel_ui') {
                <div class="space-y-4">
                  <div class="space-y-2">
                    <app-textarea
                      styleVariant="modern"
                      formControlName="panelUiInput"
                      [label]="'Configuración JSON'"
                      [rows]="10"
                      placeholder='{"dashboard": true, "settings": false}'
                      customClass="font-mono"
                    ></app-textarea>
                    @if (jsonError()) {
                      <p class="text-xs text-red-500">{{ jsonError() }}</p>
                    }
                  </div>
                </div>
              }
            }
          </div>
        </form>
      }

      <div
        class="flex justify-between items-center pt-4 border-t border-[var(--color-border)]"
        slot="footer"
      >
        <app-button
          variant="outline-danger"
          (clicked)="onCancel()"
          [disabled]="isSaving()"
          size="sm"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="configForm.invalid || isSaving() || !!jsonError()"
          [loading]="isSaving()"
          size="sm"
        >
          Guardar Configuración
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class UserConfigModalComponent implements OnInit, OnChanges {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private authFacade = inject(AuthFacade);
  private rolesService = inject(OrgRolesService);
  private storesService = inject(OrganizationStoresService);
  private toastService = inject(ToastService);

  readonly user = input<User | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onSaved = output<void>();

  configForm!: FormGroup;
  readonly isSaving = signal(false);
  readonly isLoadingRoles = signal(false);
  readonly isLoadingStores = signal(false);
  activeTab: 'general' | 'roles' | 'stores' | 'panel_ui' = 'general';
  readonly jsonError = signal<string | null>(null);

  readonly roles = signal<Role[]>([]);
  readonly stores = signal<StoreListItem[]>([]);

  readonly roleOptions = computed<MultiSelectorOption[]>(() =>
    this.roles().map((r) => ({
      value: r.id,
      label: r.name,
      description: r.description || undefined,
    }))
  );

  readonly storeOptions = computed<MultiSelectorOption[]>(() =>
    this.stores().map((s) => ({
      value: s.id,
      label: s.name,
      description: s.store_code ? `Código: ${s.store_code}` : undefined,
    }))
  );

  constructor() {
    this.configForm = this.fb.group({
      app: ['VENDIX_LANDING'],
      roles: [[] as number[]],
      store_ids: [[] as number[]],
      panelUiInput: ['{}'],
    });

    this.configForm
      .get('panelUiInput')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        try {
          JSON.parse(value);
          this.jsonError.set(null);
        } catch {
          this.jsonError.set('Formato JSON inválido');
        }
      });
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadStores();
  }

  ngOnChanges(): void {
    if (this.isOpen() && this.user()) {
      this.loadConfiguration();
    }
  }

  private loadRoles(): void {
    this.isLoadingRoles.set(true);
    this.rolesService.getRoles({ limit: 100 }).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (response) => {
        this.roles.set(response.data);
        this.isLoadingRoles.set(false);
      },
      error: () => {
        this.isLoadingRoles.set(false);
        this.toastService.error('Error cargando roles');
      }
    });
  }

  private loadStores(): void {
    this.isLoadingStores.set(true);
    this.storesService.getStores({ limit: 100 }).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (response) => {
        this.stores.set(response.data?.flat() || []);
        this.isLoadingStores.set(false);
      },
      error: () => {
        this.isLoadingStores.set(false);
        this.toastService.error('Error cargando tiendas');
      }
    });
  }

  loadConfiguration(): void {
    const user = this.user();
    if (!user) return;

    const defaultPanelUi = {
      ORG_ADMIN: {
        dashboard: true, stores: true, users: true, domains: true, audit: true,
        settings: true, accounting: true, payroll: true,
      },
      STORE_ADMIN: {
        dashboard: true, pos: true, products: true, ecommerce: true, orders: true,
        inventory: true, customers: true, marketing: true, analytics: true,
        expenses: true, invoicing: true, accounting: true, payroll: true, help: true, settings: true,
      },
      STORE_ECOMMERCE: {
        profile: true, history: true, dashboard: true, favorites: true, orders: true, settings: true,
      },
    };

    this.configForm.reset({
      app: 'VENDIX_LANDING',
      roles: [],
      store_ids: [],
      panelUiInput: JSON.stringify(defaultPanelUi, null, 2),
    });

    this.usersService
      .getUserConfiguration(user.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config: any) => {
          const mergedPanelUi = {
            ...defaultPanelUi,
            ...(config.panel_ui || {}),
          };

          this.configForm.patchValue({
            app: config.app || 'VENDIX_LANDING',
            roles: config.roles || [],
            store_ids: config.store_ids || [],
            panelUiInput: JSON.stringify(mergedPanelUi, null, 2),
          });
        },
        error: (err: unknown) => {
          console.error('Failed to load configuration', err);
          const message = extractApiErrorMessage(err);
          this.toastService.error(message);
        },
      });
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    const user = this.user();
    if (this.configForm.invalid || this.jsonError() || !user) return;

    this.isSaving.set(true);
    const formVal = this.configForm.value;

    const payload = {
      app: formVal.app,
      roles: formVal.roles as number[],
      store_ids: formVal.store_ids as number[],
      panel_ui: JSON.parse(formVal.panelUiInput),
    };

    this.usersService
      .updateUserConfiguration(user.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.toastService.success('Configuración actualizada exitosamente');

          const currentUserId = this.authFacade.getUserId();
          const userValue = this.user();
          if (userValue && currentUserId === userValue.id) {
            const currentUserSettings = this.authFacade.getUserSettings();
            const updatedSettings = {
              ...currentUserSettings,
              config: {
                ...currentUserSettings?.config,
                panel_ui: {
                  ...currentUserSettings?.config?.panel_ui,
                  [payload.app]: payload.panel_ui,
                },
              },
            };
            this.authFacade.updateUserSettings(updatedSettings);
          }

          this.onSaved.emit();
          this.isOpenChange.emit(false);
        },
        error: (err: unknown) => {
          this.isSaving.set(false);
          const message = extractApiErrorMessage(err);
          this.toastService.error(message);
        },
      });
  }
}