import {Component, OnInit, signal, DestroyRef, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-invoice-data',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-50 flex items-start justify-center p-4 pt-8">
      <div class="w-full max-w-md">

        <!-- Loading State -->
        @if (loading()) {
          <div class="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div class="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p class="text-gray-500 text-sm">Cargando información...</p>
          </div>
        }

        <!-- Error State -->
        @if (error() && !loading()) {
          <div class="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </div>
            <h2 class="text-xl font-bold text-gray-800 mb-2">{{ errorTitle() }}</h2>
            <p class="text-gray-500 text-sm">{{ errorMessage() }}</p>
          </div>
        }

        <!-- Success State -->
        @if (submitted() && !loading() && !error()) {
          <div class="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <h2 class="text-xl font-bold text-gray-800 mb-2">Datos recibidos</h2>
            <p class="text-gray-500 text-sm mb-4">
              Sus datos de facturación han sido enviados correctamente.
              Recibirá su factura electrónica en el correo indicado.
            </p>
            <div class="bg-blue-50 rounded-xl p-4 text-left">
              <p class="text-sm text-gray-700"><strong>Nombre:</strong> {{ form.first_name }} {{ form.last_name }}</p>
              <p class="text-sm text-gray-700"><strong>Documento:</strong> {{ form.document_type }} {{ form.document_number }}</p>
              @if (form.email) {
                <p class="text-sm text-gray-700"><strong>Email:</strong> {{ form.email }}</p>
              }
            </div>
          </div>
        }

        <!-- Form State -->
        @if (!submitted() && !loading() && !error()) {
          <div class="bg-white rounded-2xl shadow-lg overflow-hidden">
            <!-- Header with store info -->
            <div class="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5 text-white">
              @if (storeName()) {
                <h1 class="text-lg font-bold">{{ storeName() }}</h1>
              }
              <p class="text-blue-100 text-sm mt-1">Solicitud de factura electrónica</p>
            </div>

            <!-- Order Summary -->
            @if (orderInfo(); as info) {
              <div class="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Resumen de compra</p>
                <div class="flex justify-between items-center">
                  <span class="text-sm text-gray-700">Orden #{{ info.order_number }}</span>
                  <span class="text-sm font-bold text-gray-800">{{ info.grand_total | currency:'COP':'symbol-narrow':'1.0-0' }}</span>
                </div>
                <p class="text-xs text-gray-400 mt-1">{{ info.created_at | date:'dd/MM/yyyy HH:mm' }}</p>
              </div>
            }

            <!-- Form -->
            <form (ngSubmit)="onSubmit()" class="p-6 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
                <input
                  type="text"
                  [(ngModel)]="form.first_name"
                  name="first_name"
                  required
                  class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="Nombre"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Apellido *</label>
                <input
                  type="text"
                  [(ngModel)]="form.last_name"
                  name="last_name"
                  required
                  class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="Apellido"
                />
              </div>

              <div class="grid grid-cols-5 gap-3">
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Tipo Doc *</label>
                  <select
                    [(ngModel)]="form.document_type"
                    name="document_type"
                    required
                    class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
                  >
                    <option value="CC">CC</option>
                    <option value="NIT">NIT</option>
                    <option value="CE">CE</option>
                    <option value="PP">PP</option>
                    <option value="TI">TI</option>
                  </select>
                </div>
                <div class="col-span-3">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Número *</label>
                  <input
                    type="text"
                    [(ngModel)]="form.document_number"
                    name="document_number"
                    required
                    class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Número de documento"
                  />
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
                <input
                  type="email"
                  [(ngModel)]="form.email"
                  name="email"
                  class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="correo@ejemplo.com"
                />
                <p class="text-xs text-gray-400 mt-1">Se enviará la factura a este correo</p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                <input
                  type="tel"
                  [(ngModel)]="form.phone"
                  name="phone"
                  class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="+57 300 000 0000"
                />
              </div>

              <button
                type="submit"
                [disabled]="submitting() || !isFormValid()"
                class="w-full py-3 px-4 rounded-xl text-white font-semibold text-sm transition-all"
                [class]="submitting() || !isFormValid() ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98] shadow-lg shadow-blue-200'"
              >
                @if (submitting()) {
                  <span class="flex items-center justify-center gap-2">
                    <span class="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                    Enviando...
                  </span>
                } @else {
                  Enviar datos de facturación
                }
              </button>
            </form>
          </div>

          <p class="text-center text-xs text-gray-400 mt-6">
            Powered by Vendix
          </p>
        }
      </div>
    </div>
  `,
})
export class InvoiceDataComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/invoice-data`;

  token = '';
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly errorTitle = signal('');
  readonly errorMessage = signal('');
  readonly submitted = signal(false);
  readonly submitting = signal(false);

  readonly storeName = signal('');
  readonly orderInfo = signal<any>(null);

  form = {
    first_name: '',
    last_name: '',
    document_type: 'CC',
    document_number: '',
    email: '',
    phone: '',
  };

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.showError('Enlace inválido', 'No se encontró un token válido en la URL.');
      return;
    }
    this.loadRequestInfo();
  }

  private loadRequestInfo(): void {
    this.loading.set(true);
    this.http.get<any>(`${this.apiUrl}/${this.token}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const data = response.data || response;
        this.storeName.set(data.store?.name || '');
        this.orderInfo.set(data.order || null);
        this.loading.set(false);
      },
      error: (err) => {
        const errorCode = err.error?.message || err.error?.error || '';
        if (errorCode.includes('EXPIRED')) {
          this.showError('Enlace expirado', 'El plazo para solicitar su factura ha vencido.');
        } else if (errorCode.includes('ALREADY_COMPLETED')) {
          this.showError('Ya procesado', 'Ya se procesó la factura para esta compra.');
        } else if (errorCode.includes('NOT_FOUND')) {
          this.showError('No encontrado', 'No se encontró la solicitud. Verifique el enlace.');
        } else {
          this.showError('Error', 'Ocurrió un error al cargar la información.');
        }
      },
    });
  }

  isFormValid(): boolean {
    return !!(this.form.first_name && this.form.last_name && this.form.document_type && this.form.document_number);
  }

  onSubmit(): void {
    if (!this.isFormValid() || this.submitting()) return;

    this.submitting.set(true);
    this.http.post<any>(`${this.apiUrl}/${this.token}/submit`, this.form).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitted.set(true);
        this.submitting.set(false);
      },
      error: (err) => {
        this.submitting.set(false);
        const errorCode = err.error?.message || '';
        if (errorCode.includes('NOT_PENDING')) {
          this.showError('Ya enviado', 'Los datos de facturación ya fueron enviados para esta compra.');
        } else if (errorCode.includes('EXPIRED')) {
          this.showError('Enlace expirado', 'El plazo para solicitar su factura ha vencido.');
        } else {
          this.showError('Error', 'Ocurrió un error al enviar los datos. Intente nuevamente.');
        }
      },
    });
  }

  private showError(title: string, message: string): void {
    this.error.set(true);
    this.errorTitle.set(title);
    this.errorMessage.set(message);
    this.loading.set(false);
  }
}
