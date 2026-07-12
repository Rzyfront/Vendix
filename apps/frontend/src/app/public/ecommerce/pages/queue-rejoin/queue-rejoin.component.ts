import { Component, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import {
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  IconComponent,
} from '../../../../shared/components';
import { TenantFacade } from '../../../../core/store';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-queue-rejoin',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
    RouterLink,
  ],
  template: `
    <div class="min-h-screen bg-[var(--color-background)] flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <!-- Search Form -->
        @if (searchStatus() === 'idle' || searchStatus() === 'loading') {
          <div class="bg-[var(--color-surface)] rounded-2xl shadow-lg p-6 space-y-6">
            <div class="text-center">
              <div class="w-16 h-16 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center mx-auto mb-4">
                <app-icon name="search" [size]="32" color="var(--color-primary)"></app-icon>
              </div>
              <h1 class="text-xl font-bold text-[var(--color-text-primary)]">Recuperar Entrada en Cola</h1>
              <p class="text-sm text-[var(--color-text-secondary)] mt-1">
                Busca tu entrada activa ingresando tu documento
              </p>
            </div>
            <form [formGroup]="form" (ngSubmit)="onSearch()" class="space-y-4">
              <div class="grid grid-cols-2 gap-3">
                <app-selector
                  formControlName="document_type"
                  label="Tipo Doc. *"
                  [options]="documentTypeOptions"
                  [size]="'md'"
                  [placeholder]="'Seleccionar'"
                ></app-selector>
                <app-input
                  formControlName="document_number"
                  label="Número *"
                  placeholder="12345678"
                  type="text"
                  [size]="'md'"
                ></app-input>
              </div>
              <app-button
                variant="primary"
                size="lg"
                type="submit"
                [loading]="searchStatus() === 'loading'"
                [disabled]="!form.valid || searchStatus() === 'loading'"
                [fullWidth]="true"
                >
                Buscar Entrada
              </app-button>
            </form>
            <p class="text-xs text-[var(--color-text-secondary)] text-center">
              ¿No tienes entrada?
              <a routerLink="/fila" class="text-[var(--color-primary)] font-medium hover:underline">
                Regístrate aquí
              </a>
            </p>
            @if (errorMessage()) {
              <p class="text-sm text-red-500 text-center mt-3">
                {{ errorMessage() }}
              </p>
            }
          </div>
        }

        <!-- Found Entry -->
        @if (searchStatus() === 'found') {
          <div class="bg-[var(--color-surface)] rounded-2xl shadow-lg p-6 text-center space-y-4">
            <div class="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
              <app-icon name="check-circle" [size]="40" color="#3b82f6"></app-icon>
            </div>
            <h2 class="text-xl font-bold text-[var(--color-text-primary)]">¡Entrada Encontrada!</h2>
            <div class="bg-[var(--color-primary-light)] rounded-xl p-4">
              <p class="text-sm text-[var(--color-text-secondary)]">Su posición en la cola</p>
              <p class="text-4xl font-bold text-[var(--color-primary)] mt-1">#{{ foundEntry()?.position }}</p>
            </div>
            <p class="text-sm text-[var(--color-text-secondary)]">
              Hola {{ foundEntry()?.first_name }}, el cajero le llamará pronto. No cierre esta página para ver actualizaciones.
            </p>
            @if (foundEntry()?.status === 'selected') {
              <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mt-4">
                <p class="text-yellow-800 font-medium">¡Es su turno! Acérquese a la caja.</p>
              </div>
            }
            @if (foundEntry()?.status === 'consumed') {
              <div class="bg-green-50 border border-green-200 rounded-xl p-4 mt-4">
                <p class="text-green-800 font-medium">Su compra ha sido procesada. ¡Gracias!</p>
              </div>
            }
            <app-button
              variant="secondary"
              size="md"
              [fullWidth]="true"
              (click)="onReset()"
              >
              Buscar Otra Entrada
            </app-button>
          </div>
        }

        <!-- Not Found Entry -->
        @if (searchStatus() === 'not_found') {
          <div class="bg-[var(--color-surface)] rounded-2xl shadow-lg p-6 text-center space-y-4">
            <div class="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <app-icon name="x-circle" [size]="40" color="#dc2626"></app-icon>
            </div>
            <h2 class="text-xl font-bold text-[var(--color-text-primary)]">No Encontrada</h2>
            <p class="text-sm text-[var(--color-text-secondary)]">
              No hay una entrada activa con los datos proporcionados.
            </p>
            <app-button
              variant="primary"
              size="md"
              [fullWidth]="true"
              (click)="onReset()"
              >
              Intentar de Nuevo
            </app-button>
            <p class="text-sm text-[var(--color-text-secondary)] pt-2">
              ¿Quieres registrarte?
              <a routerLink="/fila" class="text-[var(--color-primary)] font-medium hover:underline">
                Regístrate en la cola
              </a>
            </p>
          </div>
        }

        <!-- Expired Entry -->
        @if (searchStatus() === 'expired') {
          <div class="bg-[var(--color-surface)] rounded-2xl shadow-lg p-6 text-center space-y-4">
            <div class="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center mx-auto">
              <app-icon name="clock" [size]="40" color="#f97316"></app-icon>
            </div>
            <h2 class="text-xl font-bold text-[var(--color-text-primary)]">Entrada Expirada</h2>
            <p class="text-sm text-[var(--color-text-secondary)]">
              Esta entrada ya ha expirado. Por favor, regístrate nuevamente.
            </p>
            <app-button
              variant="primary"
              size="md"
              [fullWidth]="true"
              routerLink="/fila"
              >
              Registrarse Nuevamente
            </app-button>
          </div>
        }
      </div>
    </div>
  `,
})
export class QueueRejoinComponent {
  private destroyRef = inject(DestroyRef);
  form: FormGroup;

  // Signals for UI state (Zoneless-compatible)
  readonly searchStatus = signal<'idle' | 'loading' | 'found' | 'not_found' | 'expired'>('idle');
  readonly foundEntry = signal<{
    position: number;
    status: string;
    first_name: string;
  } | null>(null);
  readonly errorMessage = signal('');

  readonly documentTypeOptions = [
    { value: 'CC', label: 'Cédula de Ciudadanía' },
    { value: 'NIT', label: 'NIT' },
    { value: 'CE', label: 'Cédula de Extranjería' },
    { value: 'PP', label: 'Pasaporte' },
    { value: 'TI', label: 'Tarjeta de Identidad' },
  ];

  private readonly apiUrl = `${environment.apiUrl}/ecommerce/customer-queue`;

  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private tenantFacade = inject(TenantFacade);

  constructor() {
    this.form = this.fb.group({
      document_type: ['CC', [Validators.required]],
      document_number: ['', [Validators.required, Validators.minLength(5)]],
    });
  }

  private getHeaders(): HttpHeaders {
    const storeId = this.tenantFacade.getCurrentStoreId();
    return new HttpHeaders({ 'x-store-id': storeId?.toString() || '' });
  }

  onSearch(): void {
    if (!this.form.valid) return;

    this.searchStatus.set('loading');
    this.errorMessage.set('');
    this.foundEntry.set(null);

    const data = this.form.value;

    this.http
      .post<any>(`${this.apiUrl}/search`, data, { headers: this.getHeaders() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.data) {
            this.foundEntry.set(res.data);
            if (res.data.status === 'expired') {
              this.searchStatus.set('expired');
            } else {
              this.searchStatus.set('found');
            }
          } else {
            this.searchStatus.set('not_found');
          }
        },
        error: (err) => {
          const errorCode = err.error?.message || err.error?.error;
          if (errorCode === 'ENTRY_NOT_FOUND') {
            this.searchStatus.set('not_found');
          } else if (errorCode === 'ENTRY_EXPIRED') {
            this.searchStatus.set('expired');
          } else {
            this.errorMessage.set('Error al buscar entrada. Intente nuevamente.');
            this.searchStatus.set('idle');
          }
        },
      });
  }

  onReset(): void {
    this.searchStatus.set('idle');
    this.foundEntry.set(null);
    this.errorMessage.set('');
    this.form.reset({ document_type: 'CC' });
  }
}
