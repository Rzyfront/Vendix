import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Subject, interval, takeUntil, switchMap } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  IconComponent,
} from '../../../../shared/components';
import { TenantFacade } from '../../../../core/store';

@Component({
  selector: 'app-queue-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
  ],
  template: `
    <div class="min-h-screen bg-[var(--color-background)] flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <!-- Registration Form -->
        <div *ngIf="!registered" class="bg-[var(--color-surface)] rounded-2xl shadow-lg p-6 space-y-6">
          <div class="text-center">
            <div class="w-16 h-16 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center mx-auto mb-4">
              <app-icon name="users" [size]="32" color="var(--color-primary)"></app-icon>
            </div>
            <h1 class="text-xl font-bold text-[var(--color-text-primary)]">Registro en Cola</h1>
            <p class="text-sm text-[var(--color-text-secondary)] mt-1">
              Regístrese para ser atendido más rápido
            </p>
          </div>

          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <app-input
                formControlName="first_name"
                label="Nombre *"
                placeholder="Juan"
                type="text"
                [size]="'md'"
              ></app-input>
              <app-input
                formControlName="last_name"
                label="Apellido *"
                placeholder="Pérez"
                type="text"
                [size]="'md'"
              ></app-input>
            </div>

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

            <app-input
              formControlName="email"
              label="Email (opcional)"
              placeholder="correo@ejemplo.com"
              type="email"
              [size]="'md'"
            ></app-input>

            <app-input
              formControlName="phone"
              label="Teléfono (opcional)"
              placeholder="+57 300 123 4567"
              type="tel"
              [size]="'md'"
            ></app-input>

            <app-button
              variant="primary"
              size="lg"
              type="submit"
              [loading]="submitting"
              [disabled]="!form.valid || submitting"
              [fullWidth]="true"
            >
              Registrarme en la Cola
            </app-button>
          </form>

          <p *ngIf="errorMessage" class="text-sm text-red-500 text-center">
            {{ errorMessage }}
          </p>
        </div>

        <!-- Success State -->
        <div *ngIf="registered" class="bg-[var(--color-surface)] rounded-2xl shadow-lg p-6 text-center space-y-4">
          <div class="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <app-icon name="check" [size]="40" color="#16a34a"></app-icon>
          </div>
          <h2 class="text-xl font-bold text-[var(--color-text-primary)]">¡Registrado!</h2>
          <div class="bg-[var(--color-primary-light)] rounded-xl p-4">
            <p class="text-sm text-[var(--color-text-secondary)]">Su posición en la cola</p>
            <p class="text-4xl font-bold text-[var(--color-primary)] mt-1">#{{ currentPosition }}</p>
          </div>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {{ registeredName }}, el cajero le llamará pronto. No cierre esta página para ver actualizaciones.
          </p>
          <div *ngIf="queueStatus === 'selected'" class="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mt-4">
            <p class="text-yellow-800 font-medium">¡Es su turno! Acérquese a la caja.</p>
          </div>
          <div *ngIf="queueStatus === 'consumed'" class="bg-green-50 border border-green-200 rounded-xl p-4 mt-4">
            <p class="text-green-800 font-medium">Su compra ha sido procesada. ¡Gracias!</p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class QueueRegisterComponent implements OnInit, OnDestroy {
  form: FormGroup;
  submitting = false;
  registered = false;
  errorMessage = '';
  currentPosition = 0;
  registeredName = '';
  registrationToken = '';
  queueStatus = '';

  documentTypeOptions = [
    { value: 'CC', label: 'Cédula de Ciudadanía' },
    { value: 'NIT', label: 'NIT' },
    { value: 'CE', label: 'Cédula de Extranjería' },
    { value: 'PP', label: 'Pasaporte' },
    { value: 'TI', label: 'Tarjeta de Identidad' },
  ];

  private destroy$ = new Subject<void>();
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/customer-queue`;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private tenantFacade: TenantFacade,
  ) {
    this.form = this.fb.group({
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      document_type: ['CC', [Validators.required]],
      document_number: ['', [Validators.required, Validators.minLength(5)]],
      email: [''],
      phone: [''],
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private getHeaders(): HttpHeaders {
    const storeId = this.tenantFacade.getCurrentStoreId();
    return new HttpHeaders({ 'x-store-id': storeId?.toString() || '' });
  }

  onSubmit(): void {
    if (!this.form.valid) return;

    this.submitting = true;
    this.errorMessage = '';

    const data = this.form.value;
    // Remove empty optional fields
    if (!data.email) delete data.email;
    if (!data.phone) delete data.phone;

    this.http
      .post<any>(`${this.apiUrl}/register`, data, { headers: this.getHeaders() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.submitting = false;
          this.registered = true;
          this.currentPosition = res.data?.position || 0;
          this.registeredName = data.first_name;
          this.registrationToken = res.data?.token || '';
          this.startPolling();
        },
        error: (err) => {
          this.submitting = false;
          const errorCode = err.error?.message || err.error?.error;
          if (errorCode === 'CUSTOMER_ALREADY_IN_QUEUE') {
            this.errorMessage =
              'Ya está registrado en la cola con este documento.';
          } else if (errorCode === 'CUSTOMER_QUEUE_DISABLED') {
            this.errorMessage =
              'La cola virtual no está habilitada en este momento.';
          } else if (errorCode === 'QUEUE_FULL') {
            this.errorMessage = 'La cola está llena. Intente más tarde.';
          } else {
            this.errorMessage = 'Error al registrarse. Intente nuevamente.';
          }
        },
      });
  }

  private startPolling(): void {
    if (!this.registrationToken) return;

    interval(15000)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() =>
          this.http.get<any>(
            `${this.apiUrl}/status/${this.registrationToken}`,
            { headers: this.getHeaders() },
          ),
        ),
      )
      .subscribe({
        next: (res) => {
          const data = res.data;
          if (data) {
            this.currentPosition = data.position || this.currentPosition;
            this.queueStatus = data.status || '';
          }
        },
        error: () => {},
      });
  }
}
