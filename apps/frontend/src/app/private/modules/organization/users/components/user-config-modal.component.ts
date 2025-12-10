
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
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User } from '../interfaces/user.interface';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-user-config-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Configuración de Usuario"
      (openChange)="onClose.emit()"
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

          <!-- Roles Tab -->
          <div *ngSwitchCase="'roles'" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
               <!-- Placeholder for dynamic roles. In a real scenario, we'd fetch available roles. For now, manual input or simplified list -->
               <div class="p-3 border rounded bg-gray-50 dark:bg-gray-800">
                 <p class="text-sm text-gray-500 italic">
                   La gestión dinámica de roles se implementará conectando con el servicio de roles.
                   Por ahora, puedes ingresar IDs de roles manualmente (separados por coma).
                 </p>
                 <label class="block text-sm font-medium mt-2">Role IDs</label>
                 <input type="text" formControlName="rolesInput" 
                        placeholder="Ej: 1, 2, 3"
                        class="w-full mt-1 px-3 py-2 border rounded text-sm"/>
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
                 <label class="block text-sm font-medium mt-2">Store IDs</label>
                 <input type="text" formControlName="storesInput" 
                        placeholder="Ej: 10, 20"
                        class="w-full mt-1 px-3 py-2 border rounded text-sm"/>
             </div>
          </div>

          <!-- Panel UI Tab -->
          <div *ngSwitchCase="'panel_ui'" class="space-y-4">
            <div class="space-y-2">
              <label class="block text-sm font-medium">Configuración JSON</label>
              <textarea
                formControlName="panelUiInput"
                rows="10"
                class="w-full px-3 py-2 font-mono text-sm border rounded bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200"
                placeholder='{"dashboard": true, "settings": false}'
              ></textarea>
              <p *ngIf="jsonError" class="text-xs text-red-500">{{ jsonError }}</p>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onClose.emit()"
          [disabled]="isSaving"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="configForm.invalid || isSaving || !!jsonError"
          [loading]="isSaving"
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
  @Output() onClose = new EventEmitter<void>();
  @Output() onSaved = new EventEmitter<void>();

  configForm: FormGroup;
  isSaving: boolean = false;
  activeTab: 'general' | 'roles' | 'stores' | 'panel_ui' = 'general';
  jsonError: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private usersService: UsersService
  ) {
    this.configForm = this.fb.group({
      app: ['VENDIX_LANDING'],
      rolesInput: [''],
      storesInput: [''],
      panelUiInput: ['{}'],
    });

    // Validate JSON on change
    this.configForm.get('panelUiInput')?.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(value => {
        try {
          JSON.parse(value);
          this.jsonError = null;
        } catch (e) {
          this.jsonError = 'Invalid JSON format';
        }
      });
  }

  ngOnInit(): void { }

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

    // Reset form first
    this.configForm.reset({
      app: 'VENDIX_LANDING',
      rolesInput: '',
      storesInput: '',
      panelUiInput: '{}'
    });

    this.usersService.getUserConfiguration(this.user.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config: any) => {
          this.configForm.patchValue({
            app: config.app,
            rolesInput: (config.roles || []).join(', '),
            storesInput: (config.store_ids || []).join(', '),
            panelUiInput: JSON.stringify(config.panel_ui || {}, null, 2)
          });
        },
        error: (err: any) => console.error(err)
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
      panel_ui: JSON.parse(formVal.panelUiInput)
    };

    this.usersService.updateUserConfiguration(this.user.id, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isSaving = false;
          this.onSaved.emit();
          this.onClose.emit();
        },
        error: (err: any) => {
          console.error('Failed to save config', err);
          this.isSaving = false;
        }
      });
  }
}
