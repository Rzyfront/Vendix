import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  inject,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User } from '../interfaces/user.interface';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-user-config-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, ModalComponent, InputComponent, TextareaComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Configuración de Usuario"
      subtitle="Administra los roles, tiendas y configuraciones del panel UI"
    >
      <form [formGroup]="configForm" (ngSubmit)="onSubmit()" *ngIf="user">
        <!-- Tabs -->
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

        <!-- Content -->
        <div [ngSwitch]="activeTab">
          <!-- General Tab -->
          <div *ngSwitchCase="'general'" class="space-y-4">
            <div class="space-y-2">
              <label
                class="block text-sm font-medium text-[var(--color-text-primary)]"
              >
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
                Selecciona la aplicación principal a la que tendrá acceso el
                usuario.
              </p>
            </div>
          </div>

          <!-- Roles Tab -->
          <div *ngSwitchCase="'roles'" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- Placeholder for dynamic roles. In a real scenario, we'd fetch available roles. For now, manual input or simplified list -->
              <div class="p-3 border rounded bg-gray-50 dark:bg-gray-800">
                <p class="text-sm text-gray-500 italic">
                  La gestión dinámica de roles se implementará conectando con el
                  servicio de roles. Por ahora, puedes ingresar IDs de roles
                  manualmente (separados por coma).
                </p>
                <app-input
                  styleVariant="modern"
                  formControlName="rolesInput"
                  [label]="'Role IDs'"
                  placeholder="Ej: 1, 2, 3"
                ></app-input>
              </div>
            </div>
          </div>

          <!-- Stores Tab -->
          <div *ngSwitchCase="'stores'" class="space-y-4">
            <div class="p-3 border rounded bg-gray-50 dark:bg-gray-800">
              <p class="text-sm text-gray-500 italic">
                La selección de tiendas se conectará con el servicio de tiendas.
                Por ahora, ingresa IDs de tiendas manualmente.
              </p>
              <app-input
                styleVariant="modern"
                formControlName="storesInput"
                [label]="'Store IDs'"
                placeholder="Ej: 10, 20"
              ></app-input>
            </div>
          </div>

          <!-- Panel UI Tab -->
          <div *ngSwitchCase="'panel_ui'" class="space-y-4">
            <div class="space-y-2">
              <app-textarea
                styleVariant="modern"
                formControlName="panelUiInput"
                [label]="'Configuración JSON'"
                [rows]="10"
                placeholder='{"dashboard": true, "settings": false}'
                customClass="font-mono"
              ></app-textarea>
              <p *ngIf="jsonError" class="text-xs text-red-500">
                {{ jsonError }}
              </p>
            </div>
          </div>
        </div>
      </form>

      <div
        class="flex justify-between items-center pt-4 border-t border-[var(--color-border)]"
        slot="footer"
      >
        <app-button
          variant="outline-danger"
          (clicked)="onCancel()"
          [disabled]="isSaving"
          size="sm"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="configForm.invalid || isSaving || !!jsonError"
          [loading]="isSaving"
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
export class UserConfigModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() user: User | null = null;
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onSaved = new EventEmitter<void>();

  configForm: FormGroup;
  isSaving: boolean = false;
  activeTab: 'general' | 'roles' | 'stores' | 'panel_ui' = 'general';
  jsonError: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private usersService: UsersService,
    private authFacade: AuthFacade,
  ) {
    this.configForm = this.fb.group({
      app: ['VENDIX_LANDING'],
      rolesInput: [''],
      storesInput: [''],
      panelUiInput: ['{}'],
    });

    // Validate JSON on change
    this.configForm
      .get('panelUiInput')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((value) => {
        try {
          JSON.parse(value);
          this.jsonError = null;
        } catch (e) {
          this.jsonError = 'Invalid JSON format';
        }
      });
  }

  ngOnInit(): void {}

  onCancel(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
  }

  ngOnChanges(): void {
    if (this.isOpen && this.user) {
      this.loadConfiguration();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadConfiguration(): void {
    if (!this.user) return;

    // Default panel_ui structure with all submodules
    const defaultPanelUi = {
      ORG_ADMIN: {
        dashboard: true,
        stores: true,
        users: true,
        audit: true,
        settings: true,
        analytics: true,
        reports: true,
        inventory: true,
        billing: true,
        ecommerce: true,
        orders: true,
        expenses: true,
      },
      STORE_ADMIN: {
        dashboard: true,
        pos: true,
        products: true,
        ecommerce: true,
        orders: true,
        orders_sales: true,
        orders_purchase_orders: false,
        inventory: true,
        inventory_pop: true,
        inventory_adjustments: false,
        inventory_locations: false,
        inventory_suppliers: false,
        inventory_movements: false,
        customers: true,
        customers_all: true,
        customers_reviews: false,
        marketing: true,
        marketing_promotions: false,
        marketing_coupons: false,
        analytics: true,
        analytics_overview: true,
        analytics_sales: true,
        analytics_traffic: false,
        analytics_performance: false,
        expenses: true,
        expenses_overview: true,
        expenses_all: true,
        expenses_create: true,
        expenses_categories: true,
        expenses_reports: true,
        settings: true,
        settings_general: true,
        settings_payments: true,
        settings_appearance: false,
        settings_security: true,
        settings_domains: false,
      },
      STORE_ECOMMERCE: {
        profile: true,
        history: true,
        dashboard: true,
        favorites: true,
        orders: true,
        settings: true,
      },
    };

    // Reset form first
    this.configForm.reset({
      app: 'VENDIX_LANDING',
      rolesInput: '',
      storesInput: '',
      panelUiInput: JSON.stringify(defaultPanelUi, null, 2),
    });

    this.usersService
      .getUserConfiguration(this.user.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config: any) => {
          // Merge with defaults to ensure all keys exist
          const mergedPanelUi = {
            ...defaultPanelUi,
            ...(config.panel_ui || {}),
          };

          this.configForm.patchValue({
            app: config.app,
            rolesInput: (config.roles || []).join(', '),
            storesInput: (config.store_ids || []).join(', '),
            panelUiInput: JSON.stringify(mergedPanelUi, null, 2),
          });
        },
        error: (err: any) => console.error(err),
      });
  }

  onSubmit(): void {
    if (this.configForm.invalid || this.jsonError || !this.user) return;

    this.isSaving = true;
    const formVal = this.configForm.value;

    const roles = formVal.rolesInput
      .split(',')
      .map((s: string) => parseInt(s.trim()))
      .filter((n: number) => !isNaN(n));

    const store_ids = formVal.storesInput
      .split(',')
      .map((s: string) => parseInt(s.trim()))
      .filter((n: number) => !isNaN(n));

    const payload = {
      app: formVal.app,
      roles,
      store_ids,
      panel_ui: JSON.parse(formVal.panelUiInput),
    };

    this.usersService
      .updateUserConfiguration(this.user.id, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isSaving = false;

          // Update auth state if editing current user's configuration
          const currentUserId = this.authFacade.getUserId();
          if (this.user && currentUserId === this.user.id) {
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
        error: (err: any) => {
          console.error('Failed to save config', err);
          this.isSaving = false;
        },
      });
  }
}
