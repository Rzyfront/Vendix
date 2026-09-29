import {
  Component,
  ElementRef,
  input,
  output,
  inject,
  effect,
  DestroyRef,
  signal,
  computed } from '@angular/core';
import { NgClass } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';


import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  SelectorComponent,
  IconComponent,
  InputsearchComponent,
  ToggleComponent,
  ToastService,
  DialogService,
  AlertBannerComponent,
  type AddressPayload } from '../../../../../shared/components';
import {
  DOCUMENT_TYPES,
  findDocumentType,
  DocumentTypeOption,
} from '../../../../../shared/constants/document-types';
import { computeNitDv } from '../../../../../shared/utils/nit.util';
import { PosCustomerService } from '../services/pos-customer.service';
import { PosQueueService, QueueEntry } from '../services/pos-queue.service';
import {
  PosCustomer,
  CreatePosCustomerRequest,
  PaginatedCustomersResponse } from '../models/customer.model';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { CustomerModalComponent } from '../../customers/components/customer-modal/customer-modal.component';
import { CustomersService } from '../../customers/services/customers.service';
import {
  CreateCustomerRequest,
  ExternalCustomerLookupResult,
} from '../../customers/models/customer.model';
import {
  RuesIdentityCardComponent,
  ruesIdentityToPrefill,
} from '../../customers/components/rues-identity-card/rues-identity-card.component';

@Component({
  selector: 'app-pos-customer-modal',
  standalone: true,
  imports: [
    RuesIdentityCardComponent,
    FormsModule,
    NgClass,
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
    InputsearchComponent,
    ToggleComponent,
    AlertBannerComponent,
    CustomerModalComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      [size]="'md'"
      [dialog]="true"
      class="cm-aa-scope"
      >
      <!-- Tab Navigation -->
      <!-- full-bleed calibrado al padding del body de app-modal (px-3 py-2.5 md:px-5 md:py-4): evita scroll horizontal -->
      @if (!customer()) {
        <div class="flex border-b border-[var(--color-border)] -mx-3 -mt-2.5 px-3 md:-mx-5 md:-mt-4 md:px-5 mb-6" role="tablist" aria-label="Modo de cliente">
          <button
            type="button"
            role="tab"
            (click)="switchToSearchMode()"
            [attr.aria-selected]="currentStep() === 'search'"
            class="flex-1 px-4 py-3 min-h-[44px] text-sm font-medium transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
            [class.text-[var(--color-primary)]]="currentStep() === 'search'"
            [class.border-b-2]="currentStep() === 'search'"
            [class.border-[var(--color-primary)]]="currentStep() === 'search'"
            [class.text-[var(--color-neutral-600)]]="currentStep() !== 'search'"
            >
            Buscar
          </button>
          <button
            type="button"
            role="tab"
            (click)="switchToCreateMode()"
            [attr.aria-selected]="currentStep() === 'create'"
            class="flex-1 px-4 py-3 min-h-[44px] text-sm font-medium transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
            [class.text-[var(--color-primary)]]="currentStep() === 'create'"
            [class.border-b-2]="currentStep() === 'create'"
            [class.border-[var(--color-primary)]]="currentStep() === 'create'"
            [class.text-[var(--color-neutral-600)]]="currentStep() !== 'create'"
            >
            Crear
          </button>
          @if (queueEnabled()) {
            <button
              type="button"
              role="tab"
              (click)="switchToQueueMode()"
              [attr.aria-selected]="currentStep() === 'queue'"
              class="flex-1 px-4 py-3 min-h-[44px] text-sm font-medium transition-colors relative focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
              [class.text-[var(--color-primary)]]="currentStep() === 'queue'"
              [class.border-b-2]="currentStep() === 'queue'"
              [class.border-[var(--color-primary)]]="currentStep() === 'queue'"
              [class.text-[var(--color-neutral-600)]]="currentStep() !== 'queue'"
              >
              Cola
              @if (queueEntries().length > 0) {
                <span class="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-[var(--color-success-700)] rounded-full">
                  {{ queueEntries().length }}
                </span>
              }
            </button>
          }
        </div>
      }
    
      <!-- Modal Content -->
        <!-- Search Step -->
        @if (currentStep() === 'search') {
          <div class="space-y-4">
            <app-inputsearch
              placeholder="Buscar por nombre, email o documento..."
              (search)="onSearch($event)"
              [debounceTime]="300"
            ></app-inputsearch>
            <!-- Search Results -->
            @if (searchResults().length > 0) {
              <div class="space-y-2">
                <h3 class="text-sm font-medium text-[var(--color-neutral-600)]">
                  Resultados de búsqueda:
                </h3>
                <div class="max-h-48 overflow-y-auto space-y-2">
                  @for (customer of searchResults(); track customer.id) {
                    <button
                      type="button"
                      (click)="selectCustomer(customer)"
                      [attr.aria-label]="'Seleccionar ' + displayName(customer)"
                      class="w-full min-h-[44px] p-3 border border-[var(--color-border)] rounded-lg text-left cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)]"
                      >
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-[var(--color-text-primary)] truncate">
                            {{ displayName(customer) }}
                          </p>
                          <p class="text-sm text-[var(--color-neutral-600)] truncate">
                            {{ customer.email }}
                          </p>
                          @if (documentLine(customer)) {
                            <p class="text-xs text-[var(--color-neutral-600)]">
                              {{ documentLine(customer) }}
                            </p>
                          }
                        </div>
                        <app-icon
                          [name]="customer.person_type === 'JURIDICA' ? 'building' : 'chevron'"
                          [size]="16"
                          color="var(--color-neutral-600)"
                        ></app-icon>
                      </div>
                    </button>
                  }
                </div>
              </div>
            }
            <!-- No Results -->
            @if (searchPerformed() && searchResults().length === 0) {
              <div
                class="text-center py-8"
                >
                <app-icon
                  name="user"
                  [size]="48"
                  color="var(--color-neutral-600)"
                  class="mx-auto mb-4"
                ></app-icon>
                <p class="text-[var(--color-neutral-600)] mb-4">
                  No se encontraron clientes con esos criterios
                </p>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="switchToCreateMode()"
                  >
                  <app-icon name="plus" [size]="16" slot="icon" ></app-icon>
                  Crear cliente nuevo
                </app-button>
              </div>
            }
            <!-- Quick Create Option -->
            @if (!searchPerformed() && !lookupPerformed()) {
              <div
                class="text-center py-4 border-t border-[var(--color-border)]"
                >
                <p class="text-sm text-[var(--color-neutral-600)] mb-2">
                  ¿No quieres buscar?
                </p>
                <app-button
                  variant="outline"
                  size="sm"
                  customClasses="min-h-[44px]"
                  (clicked)="switchToCreateMode()"
                  >
                  <app-icon name="plus" [size]="16" slot="icon" ></app-icon>
                  Crear cliente nuevo
                </app-button>
              </div>
            }
            <!-- Búsqueda avanzada: lookup por documento (debajo de crear) -->
            <div class="mb-4 p-4 bg-[var(--color-primary-light)]/30 rounded-lg border border-[var(--color-primary)]/20">
              <label class="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                Búsqueda avanzada
              </label>
              <div class="flex gap-2">
                <div class="flex-1">
                  <app-input
                    [ngModel]="lookupQuery()"
                    (ngModelChange)="onLookupQueryChange($event)"
                    placeholder="Ingrese cédula o NIT..."
                    type="text"
                    [size]="'md'"
                    (keydown.enter)="onDocumentLookup()"
                  ></app-input>
                </div>
                <app-button
                  variant="primary"
                  size="md"
                  (clicked)="onDocumentLookup()"
                  [loading]="lookupLoading()"
                  [disabled]="!lookupQuery() || lookupQuery().trim().length < 5"
                  >
                  <app-icon name="search" [size]="16" slot="icon" ></app-icon>
                  Buscar
                </app-button>
              </div>
              <!-- Lookup Result: Found -->
              @if (lookupPerformed() && lookupResult(); as lr) {
                <div class="mt-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="font-medium text-[var(--color-text-primary)] truncate">
                        {{ displayName(lr) }}
                      </p>
                      <p class="text-sm text-[var(--color-neutral-600)] truncate">{{ lr.email }}</p>
                      @if (documentLine(lr)) {
                        <p class="text-xs text-[var(--color-neutral-600)]">{{ documentLine(lr) }}</p>
                      }
                    </div>
                    <app-button variant="primary" size="sm" customClasses="min-h-[44px] shrink-0" (clicked)="selectCustomer(lr)">
                      Seleccionar
                    </app-button>
                  </div>
                </div>
              }
              <!-- Lookup Result: Not Found -->
              @if (lookupPerformed() && !lookupResult() && !lookupLoading()) {
                @if (externalLoading()) {
                  <div class="mt-3 flex items-center justify-center gap-2 text-sm text-[var(--color-neutral-600)]">
                    <app-icon name="loader-2" [size]="16" class="animate-spin"></app-icon>
                    Consultando fuentes públicas…
                  </div>
                } @else if (externalResult()?.found && externalResult()?.identity) {
                  <app-rues-identity-card
                    [identity]="externalResult()!.identity!"
                    (createWithData)="createFromExternal()"
                    (createManual)="createFromLookup()"
                  ></app-rues-identity-card>
                } @else {
                  <div class="mt-3 text-center">
                    <p class="text-sm text-[var(--color-neutral-600)] mb-2">
                      No se encontró cliente con este documento
                    </p>
                    @if (externalResult()?.unavailable) {
                      <p class="text-xs text-[var(--color-neutral-500)] mb-2">
                        Fuentes públicas no disponibles en este momento
                      </p>
                    } @else if (externalResult()) {
                      <p class="text-xs text-[var(--color-neutral-500)] mb-2">
                        Tampoco aparece en fuentes públicas
                      </p>
                    }
                    <app-button variant="outline" size="sm" customClasses="min-h-[44px]" (clicked)="createFromLookup()">
                      <app-icon name="plus" [size]="16" slot="icon" ></app-icon>
                      Crear con este documento
                    </app-button>
                  </div>
                }
              }
            </div>
          </div>
        }
    
        <!-- Create Step -->
        @if (currentStep() === 'create') {
          <div class="space-y-4">
            @if (!customer()) {
              <div class="mb-4 p-4 bg-[var(--color-primary-light)]/30 rounded-lg border border-[var(--color-primary)]/20">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-[var(--color-text-primary)]">
                      ¿Necesitas facturar? Usa la creación completa
                    </p>
                    <p class="text-xs text-[var(--color-neutral-600)]">
                      Incluye razón social y datos fiscales DIAN (NATURAL/JURIDICA).
                    </p>
                  </div>
                  <app-button variant="outline" size="sm" customClasses="min-h-[44px] shrink-0" (clicked)="showFullCreate.set(true)">
                    <app-icon name="building" [size]="16" slot="icon" ></app-icon>
                    Creación completa
                  </app-button>
                </div>
              </div>
            }
            @if (customer()) {
              <div class="flex items-center gap-2 mb-4">
                <app-button
                  variant="ghost"
                  size="sm"
                  (clicked)="switchToSearchMode()"
                  >
                  <app-icon name="arrow-left" [size]="16" slot="icon" ></app-icon>
                  Volver a buscar
                </app-button>
              </div>
            }
            <form [formGroup]="customerForm" class="space-y-4">
              <!-- Email -->
              <app-input
                formControlName="email"
                label="Email"
                placeholder="cliente@ejemplo.com"
                type="email"
                [size]="'md'"
                [required]="true"
                [error]="getFieldError('email')"
                (blur)="onFieldBlur('email')"
                >
              </app-input>
              <!-- Name / Razón social (según tipo de persona) -->
              @if (personTypeValue() !== 'JURIDICA') {
                <div class="grid grid-cols-2 gap-4">
                  <app-input
                    formControlName="firstName"
                    label="Nombre"
                    placeholder="Juan"
                    type="text"
                    [size]="'md'"
                    [required]="true"
                    [error]="getFieldError('firstName')"
                    (blur)="onFieldBlur('firstName')"
                    >
                  </app-input>
                  <app-input
                    formControlName="lastName"
                    label="Apellido"
                    placeholder="Pérez"
                    type="text"
                    [size]="'md'"
                    [required]="true"
                    [error]="getFieldError('lastName')"
                    (blur)="onFieldBlur('lastName')"
                    >
                  </app-input>
                </div>
              } @else {
                <app-input
                  formControlName="legalName"
                  label="Razón social"
                  placeholder="Acme S.A.S"
                  type="text"
                  [size]="'md'"
                  [required]="true"
                  [error]="getFieldError('legalName')"
                  (blur)="onFieldBlur('legalName')"
                  >
                </app-input>
              }
              <!-- Phone -->
              <app-input
                formControlName="phone"
                label="Teléfono"
                placeholder="+54 9 11 1234-5678"
                type="tel"
                [size]="'md'"
                [required]="true"
                helperText="El número de teléfono debe tener 10 dígitos (sin prefijo de país)."
                [error]="getFieldError('phone')"
                (blur)="onFieldBlur('phone')"
                >
              </app-input>
              <!-- Document Type and Number -->
              <div class="grid grid-cols-2 gap-4">
                <app-selector
                  formControlName="documentType"
                  label="Tipo Doc."
                  [options]="documentTypeOptions"
                  [size]="'md'"
                  [required]="true"
                  [placeholder]="'Seleccionar'"
                  [errorText]="getFieldError('documentType') ?? ''"
                  >
                </app-selector>
                <app-input
                  formControlName="documentNumber"
                  label="Número"
                  [placeholder]="documentNumberPlaceholder()"
                  type="text"
                  [size]="'md'"
                  [required]="true"
                  [helperText]="documentNumberHint()"
                  [error]="getFieldError('documentNumber')"
                  (blur)="onFieldBlur('documentNumber')"
                  customWrapperClass="mt-0"
                  >
                </app-input>
              </div>
              @if (selectedDocumentType()?.code === 'NIT') {
                <!-- A.8 — el DV nunca viaja tecleado: se deriva del NIT con
                     módulo 11 (misma regla de invoice-create-page) y sólo se
                     muestra como referencia; el valor enviado se recalcula
                     fresco al guardar. -->
                <p class="text-xs text-[var(--color-text-secondary)] -mt-2">
                  Dígito de verificación: <strong>{{ computedVerificationDigit() ?? '—' }}</strong> (calculado automáticamente)
                </p>
              }
              @if (legalPersonDocumentTypeWarning()) {
                <!--
                  P2 — el candado JURIDICA→NIT normalmente fuerza y bloquea
                  el tipo de documento, pero esta ficha ya existía como
                  JURIDICA con un tipo distinto de NIT (dato guardado antes
                  de esa regla, o corregido a mano). Se respeta lo guardado en
                  vez de reescribirlo en silencio: el campo queda editable y
                  el backend rechazará el guardado si la combinación sigue
                  siendo incoherente.
                -->
                <app-alert-banner
                  variant="warning"
                  icon="alert-triangle"
                  tone="token"
                  heading="Persona jurídica debe usar NIT"
                >
                  Esta ficha es persona jurídica pero su tipo de documento no
                  es NIT. Corrige el tipo de documento antes de guardar; de lo
                  contrario el guardado será rechazado.
                </app-alert-banner>
              }
              <!-- Información fiscal -->
              <div class="pt-2 border-t border-[var(--color-border)]">
                <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
                  Información fiscal
                </h3>
                <div class="grid grid-cols-2 gap-4">
                  <app-selector
                    formControlName="taxRegime"
                    label="Régimen tributario"
                    [options]="taxRegimeOptions"
                    [size]="'md'"
                    [required]="true"
                    [placeholder]="'Seleccionar'"
                    [errorText]="getFieldError('taxRegime') ?? ''"
                    >
                  </app-selector>
                  <app-selector
                    formControlName="personType"
                    label="Tipo de persona"
                    [options]="personTypeOptions"
                    [size]="'md'"
                    [required]="true"
                    [placeholder]="'Seleccionar'"
                    [errorText]="getFieldError('personType') ?? ''"
                    >
                  </app-selector>
                </div>
                <div class="flex items-center gap-3 mt-4">
                  <app-toggle
                    formControlName="isWithholdingAgent"
                    label="¿Es agente retenedor?"
                  ></app-toggle>
                </div>
              </div>
            </form>
          </div>
        }
    
        <!-- Queue Step -->
        @if (currentStep() === 'queue') {
          <div class="space-y-4">
            @if (queueLoading()) {
              <div class="flex justify-center py-8">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
              </div>
            }
            @if (!queueLoading() && queueEntries().length === 0) {
              <div class="text-center py-8">
                <app-icon name="users" [size]="48" color="var(--color-neutral-400)" class="mx-auto mb-4"></app-icon>
                <p class="text-[var(--color-text-primary)] font-medium mb-4">No hay clientes en la cola</p>
                @if (queueQrData(); as qr) {
                  <div class="mt-4">
                    <p class="text-sm text-[var(--color-neutral-600)] mb-2">Comparte este QR para que los clientes se registren:</p>
                    <img [src]="qr.qr_data_url" alt="QR Cola" class="mx-auto w-40 h-40">
                    <p class="text-xs text-[var(--color-neutral-600)] mt-2">{{ qr.url }}</p>
                    <app-button variant="outline" size="md" (clicked)="printQueueQr()" class="mt-3">
                      <app-icon name="printer" [size]="16" slot="icon" ></app-icon>
                      Imprimir QR
                    </app-button>
                  </div>
                }
              </div>
            }
            @if (!queueLoading() && queueEntries().length > 0) {
              <div class="space-y-2 max-h-64 overflow-y-auto">
                @for (entry of queueEntries(); track entry; let i = $index) {
                  <div
                    class="p-3 border border-[var(--color-border)] rounded-lg transition-colors"
                    [ngClass]="entry.status === 'selected' ? 'bg-[var(--color-warning-light)] border-[var(--color-warning)]' : ''"
                    >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-3">
                        <span class="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-sm font-bold">
                          {{ i + 1 }}
                        </span>
                        <div>
                          <p class="font-medium text-[var(--color-text-primary)]">
                            {{ entry.first_name }} {{ entry.last_name }}
                          </p>
                          <p class="text-xs text-[var(--color-neutral-600)]">
                            {{ entry.document_type }}: {{ entry.document_number }}
                          </p>
                          @if (entry.status === 'selected') {
                            <span class="inline-flex items-center px-2 py-0.5 text-xs font-bold text-white bg-[var(--color-success-700)] rounded-full">
                              Seleccionado
                            </span>
                          }
                        </div>
                      </div>
                      <div class="flex gap-2">
                        @if (entry.status === 'waiting') {
                          <app-button
                            variant="primary"
                            size="md"
                            (clicked)="onSelectFromQueue(entry)"
                            >
                            Seleccionar
                          </app-button>
                        }
                        @if (entry.status === 'selected') {
                          <app-button
                            variant="outline"
                            size="md"
                            (clicked)="onReleaseFromQueue(entry)"
                            >
                            Liberar
                          </app-button>
                        }
                      </div>
                    </div>
                  </div>
                }
              </div>
            }
            <!-- QR Code section when queue has entries -->
            @if (!queueLoading() && queueEntries().length > 0 && queueQrData(); as qr2) {
              <div class="pt-4 border-t border-[var(--color-border)]">
                <details class="text-center">
                  <summary class="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-medium text-[var(--color-neutral-600)] cursor-pointer focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)]">Mostrar QR de registro</summary>
                  <img [src]="qr2.qr_data_url" alt="QR Cola" class="mx-auto w-32 h-32 mt-2">
                  <p class="text-xs text-[var(--color-neutral-600)] mt-1">{{ qr2.url }}</p>
                  <app-button variant="outline" size="md" (clicked)="printQueueQr()" class="mt-2">
                    <app-icon name="printer" [size]="16" slot="icon" ></app-icon>
                    Imprimir QR
                  </app-button>
                </details>
              </div>
            }
          </div>
        }
    
      <!-- Modal Footer -->
      @if (currentStep() === 'create') {
        <div
          class="flex justify-between items-center p-6 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
          >
          <app-button variant="secondary" size="md" (clicked)="onCancel()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            size="md"
            (clicked)="onSave()"
            [loading]="loading()"
            [disabled]="loading()"
            >
            <app-icon name="save" [size]="16" slot="icon" ></app-icon>
            Crear Cliente
          </app-button>
        </div>
      }
    </app-modal>

    <!-- Creación completa (canónica): razón social + datos fiscales DIAN -->
    <app-customer-modal
      [isOpen]="showFullCreate()"
      [customer]="null"
      [loading]="fullCreateLoading()"
      (closed)="onFullCreateClosed()"
      (save)="onFullCreateSave($event)"
      (addressData)="pendingFullCreateAddress.set($event)"
    ></app-customer-modal>
    `,
  styles: [`
    /* Stitch 11b (1)(2) — scope a11y del modal (shared/ fuera de alcance, se
       remapean vars heredadas en vez de tocar app-button/app-input): primary
       #2ecc71 -> success-700 (blanco encima pasa de 2.1 a ~5.0; tabs activos,
       outline y focus rings heredan el verde oscuro), text-secondary ->
       neutral-600 y text-muted -> neutral-500 (helpers/labels/placeholders de
       2.56 a >=4.8). Solo afecta a este subárbol. */
    .cm-aa-scope {
      --color-primary: var(--color-success-700);
      --color-text-secondary: var(--color-neutral-600);
      --color-text-muted: var(--color-neutral-500);
    }
  `] })
export class PosCustomerModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly customer = input<PosCustomer | null>(null);
  readonly openInQueueMode = input<boolean>(false);
  readonly queueEnabled = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly customerSelected = output<PosCustomer>();
  readonly customerCreated = output<PosCustomer>();
  readonly customerUpdated = output<PosCustomer>();

  customerForm: FormGroup;
  readonly loading = signal(false);
  readonly currentStep = signal<'search' | 'create' | 'queue'>('search');
  readonly searchResults = signal<PosCustomer[]>([]);
  readonly searchPerformed = signal(false);

  // Queue
  readonly queueEntries = signal<QueueEntry[]>([]);
  readonly queueLoading = signal(false);
  readonly queueQrData = signal<{ qr_data_url: string; url: string } | null>(null);

  /** Opciones del selector derivadas del catálogo compartido (single source of truth). */
  readonly documentTypeOptions = DOCUMENT_TYPES.map((opt) => ({
    value: opt.code,
    label: opt.label,
  }));

  /** Opciones de régimen tributario (clasificación fiscal del cliente). */
  readonly taxRegimeOptions = [
    { value: 'COMUN', label: 'Régimen común' },
    { value: 'SIMPLIFICADO', label: 'Régimen simplificado' },
    { value: 'GRAN_CONTRIBUYENTE', label: 'Gran contribuyente' },
  ];

  /** Opciones de tipo de persona. */
  readonly personTypeOptions = [
    { value: 'NATURAL', label: 'Persona natural' },
    { value: 'JURIDICA', label: 'Persona jurídica' },
  ];

  /** Tipo de documento seleccionado (reactivo a cambios del FormControl). */
  readonly selectedDocumentType = signal<DocumentTypeOption | undefined>(undefined);

  /** Tipo de persona (reactivo), para togglear nombre/apellido vs razón social. */
  readonly personTypeValue = signal<string>('');

  /**
   * `true` cuando la ficha cargada es JURIDICA con un `document_type`
   * distinto de NIT (dato guardado antes del candado, o corregido a mano).
   * El candado JURIDICA→NIT normalmente fuerza el valor a NIT y bloquea el
   * campo; en ese caso NO lo hace (ver el efecto que lo escribe, en el
   * constructor) para no reescribir en silencio una ficha real. La plantilla
   * usa esta señal para mostrar la advertencia visible.
   */
  readonly legalPersonDocumentTypeWarning = signal(false);

  /** Número de documento (reactivo), para derivar el DV automáticamente. */
  readonly documentNumberValue = signal<string>('');

  /**
   * DV derivado del NIT con módulo 11 (mismo criterio que
   * `invoice-create-page.component.ts`: "el DV nunca viaja tecleado, se
   * deriva del NIT"). Sólo aplica cuando el tipo elegido es NIT.
   */
  readonly computedVerificationDigit = computed(() => {
    if (this.selectedDocumentType()?.code !== 'NIT') return null;
    return computeNitDv(this.documentNumberValue());
  });

  /** Placeholder dinámico para el input de número de documento. */
  readonly documentNumberPlaceholder = computed(() => {
    const type = this.selectedDocumentType();
    return type?.placeholder ?? '12345678';
  });

  /**
   * QUI-724 — helper text para el campo de número de documento.
   * Muestra el rango esperado del tipo seleccionado (p. ej. "CC: 6-10 dígitos")
   * y un contador en vivo "X / Y" para que el cashier sepa cuándo está completo.
   * Si no hay tipo seleccionado, muestra un texto genérico.
   */
  readonly documentNumberMin = signal<number | null>(null);
  readonly documentNumberMax = signal<number | null>(null);
  readonly documentNumberIsAlphanumeric = signal<boolean>(false);
  readonly documentNumberLength = signal<number>(0);
  readonly documentNumberHint = computed(() => {
    const type = this.selectedDocumentType();
    if (!type) {
      return 'Selecciona primero el tipo de documento';
    }
    const min = this.documentNumberMin() ?? 0;
    const max = this.documentNumberMax() ?? 0;
    const len = this.documentNumberLength();
    const remaining = Math.max(0, min - len);
    const isAlphanumeric = this.documentNumberIsAlphanumeric();

    if (min === max) {
      return `${type.label}: exactamente ${min} caracteres${isAlphanumeric ? ' alfanuméricos' : ' (solo dígitos)'} (${len} / ${min})`;
    }

    if (min > 0 && len < min) {
      const charWord = isAlphanumeric ? 'caracteres alfanuméricos' : 'dígitos';
      const verb = remaining === 1 ? 'falta' : 'faltan';
      return `${type.label}: ${verb} ${remaining} ${charWord} (llevas ${len} / ${min}–${max})`;
    }

    if (min > 0) {
      return `${type.label}: ${len} caracteres en el rango válido (${min}–${max})`;
    }

    return `${type.label}: hasta ${max} caracteres (${len} digitados)`;
  });

  // Document lookup
  readonly lookupQuery = signal('');
  readonly lookupResult = signal<PosCustomer | null>(null);
  readonly lookupPerformed = signal(false);
  readonly lookupLoading = signal(false);
  /** Consulta en fuentes públicas (RUES, SECOP, RNT; sólo tras un no-encontrado local). */
  readonly externalResult = signal<ExternalCustomerLookupResult | null>(null);
  readonly externalLoading = signal(false);

  /** Salto a creación completa (app-customer-modal canónico). */
  readonly showFullCreate = signal(false);
  readonly fullCreateLoading = signal(false);
  readonly pendingFullCreateAddress = signal<AddressPayload | null>(null);

  readonly modalTitle = computed(() =>
    this.customer()
      ? 'Editar Cliente'
      : this.currentStep() === 'search'
        ? 'Buscar Cliente'
        : this.currentStep() === 'queue'
          ? 'Cola de Clientes'
          : 'Crear Cliente Rápido',
  );
  readonly modalSubtitle = computed(() =>
    this.customer()
      ? 'Edita la información del cliente seleccionado'
      : this.currentStep() === 'search'
        ? 'Busca un cliente existente o crea uno nuevo'
        : this.currentStep() === 'queue'
          ? 'Selecciona un cliente de la cola de espera'
          : 'Agrega un nuevo cliente para la venta actual',
  );
private searchSubject$ = new Subject<string>(); // LEGÍTIMO — debounceTime+distinctUntilChanged search stream
  private hostRef = inject(ElementRef);
  private dialogService = inject(DialogService);
  private fb = inject(FormBuilder);
  private customerService = inject(PosCustomerService);
  private customersService = inject(CustomersService);
  private toastService = inject(ToastService);
  private storeContextService = inject(StoreContextService);
  private queueService = inject(PosQueueService);

  constructor() {
    this.customerForm = this.createCustomerForm();
    this.setupSearchSubscription();

    // Bridge document_type valueChanges -> signal (Zoneless-safe reactive read).
    const documentTypeControl = this.customerForm.controls['documentType'];
    const documentTypeValue = toSignal(documentTypeControl.valueChanges, {
      initialValue: documentTypeControl.value as string | null,
    });

    // Mantener `selectedDocumentType` sincronizado con el FormControl.
    effect(() => {
      const code = documentTypeValue();
      this.selectedDocumentType.set(findDocumentType(code));
    });

    // Validadores dinámicos del número de documento según el tipo elegido.
    effect(() => {
      const ctrl = this.customerForm.controls['documentNumber'];
      const type = this.selectedDocumentType();
      if (type) {
        ctrl.setValidators([
          Validators.required,
          Validators.pattern(type.regex),
          Validators.maxLength(type.maxLength),
        ]);
        // Mirror catalog min/max so the helper text can show "X / Y" live.
        const min = extractDocTypeMin(type.regex);
        this.documentNumberMin.set(min);
        this.documentNumberMax.set(type.maxLength);
        this.documentNumberIsAlphanumeric.set(isAlphanumericRegex(type.regex));
      } else {
        ctrl.setValidators([Validators.required]);
        this.documentNumberMin.set(null);
        this.documentNumberMax.set(null);
        this.documentNumberIsAlphanumeric.set(false);
      }
      ctrl.updateValueAndValidity({ emitEvent: false });
    });

    // Live counter for the helper text — updates as the cashier types. Se
    // reutiliza para alimentar `documentNumberValue` (DV derivado en vivo).
    this.customerForm.controls['documentNumber'].valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v: string | null) => {
        this.documentNumberLength.set((v ?? '').length);
        this.documentNumberValue.set(v ?? '');
      });

    // Bridge person_type valueChanges -> signal (para swap jurídica/natural).
    const personTypeControl = this.customerForm.controls['personType'];
    const personTypeSignalValue = toSignal(personTypeControl.valueChanges, {
      initialValue: personTypeControl.value as string | null,
    });

    effect(() => {
      this.personTypeValue.set(personTypeSignalValue() ?? '');
      this.applyPersonTypeValidators();
    });

    // Persona jurídica en Colombia sólo tiene NIT (nunca CC): se fija y se
    // bloquea el selector (mismo criterio que
    // customer-modal.component.ts). Natural puede conservar un NIT si el
    // usuario lo dejó así explícitamente (autónomo con RUT), así que sólo se
    // libera el candado en esa dirección, nunca se cambia el valor.
    effect(() => {
      const isJuridica = this.personTypeValue() === 'JURIDICA';
      const docTypeCtrl = this.customerForm.controls['documentType'];
      const loadedCustomer = this.customer();
      // P2 — una ficha JURIDICA vieja pudo quedar guardada con CC (dato de
      // antes de este candado, o corregido a mano). Si el estado actual
      // coincide EXACTO con lo que la ficha ya traía guardado, no es una
      // elección en vivo — es el `patchValue` de `populateFormForEdit` — y
      // forzar NIT aquí la reescribiría en silencio. Se respeta el dato, se
      // avisa (`legalPersonDocumentTypeWarning`), y el campo queda editable
      // para que el usuario lo corrija (el backend rechaza la combinación
      // incoherente si se toca).
      const isLoadedInconsistentJuridica =
        isJuridica &&
        docTypeCtrl.value !== 'NIT' &&
        loadedCustomer?.person_type === 'JURIDICA' &&
        loadedCustomer?.document_type === docTypeCtrl.value;

      this.legalPersonDocumentTypeWarning.set(isLoadedInconsistentJuridica);

      if (isJuridica) {
        if (isLoadedInconsistentJuridica) {
          if (docTypeCtrl.disabled) {
            docTypeCtrl.enable({ emitEvent: false });
          }
        } else {
          if (docTypeCtrl.value !== 'NIT') {
            docTypeCtrl.setValue('NIT');
          }
          if (docTypeCtrl.enabled) {
            docTypeCtrl.disable({ emitEvent: false });
          }
        }
      } else if (docTypeCtrl.disabled) {
        docTypeCtrl.enable({ emitEvent: false });
      }
    });

    // If customer is provided, populate form for editing
    effect(() => {
      if (this.customer()) {
        this.populateFormForEdit();
        this.currentStep.set('create');
      }
    });

    effect(() => {
      if (this.openInQueueMode() && this.queueEnabled() && this.isOpen()) {
        this.switchToQueueMode();
      }
    });
  }

  private createCustomerForm(): FormGroup {
    return this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      phone: ['', [Validators.required, Validators.pattern(/^\d{10}$/)]],
      documentType: ['', [Validators.required]],
      documentNumber: ['', [Validators.required]],
      taxRegime: ['', [Validators.required]],
      personType: ['', [Validators.required]],
      // Razón social (JURIDICA). Validators reales los pone
      // `applyPersonTypeValidators()` según person_type — ver constructor.
      legalName: ['', [Validators.maxLength(255)]],
      isWithholdingAgent: [false] });
  }

  /**
   * Alterna requerido first_name/last_name <-> legal_name según person_type
   * (mismo criterio que el backend `JuridicaNameRule`: jurídica exige razón
   * social y prohíbe nombre/apellido; natural es al revés).
   */
  private applyPersonTypeValidators(): void {
    const isJuridica = this.personTypeValue() === 'JURIDICA';
    const first = this.customerForm.controls['firstName'];
    const last = this.customerForm.controls['lastName'];
    const legal = this.customerForm.controls['legalName'];

    if (isJuridica) {
      first.clearValidators();
      last.clearValidators();
      first.setValue(null, { emitEvent: false });
      last.setValue(null, { emitEvent: false });
      legal.setValidators([Validators.required, Validators.maxLength(255)]);
    } else {
      legal.clearValidators();
      legal.setValue(null, { emitEvent: false });
      first.setValidators([Validators.required, Validators.minLength(2)]);
      last.setValidators([Validators.required, Validators.minLength(2)]);
    }

    first.updateValueAndValidity({ emitEvent: false });
    last.updateValueAndValidity({ emitEvent: false });
    legal.updateValueAndValidity({ emitEvent: false });
  }

  private setupSearchSubscription(): void {
    this.searchSubject$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        if (query.trim()) {
          this.performSearch(query);
        } else {
          this.searchResults.set([]);
          this.searchPerformed.set(false);
        }
      });
  }

  onSearch(query: string): void {
    this.searchSubject$.next(query);
  }

  private performSearch(query: string): void {
    this.loading.set(true);
    this.customerService
      .searchCustomers({ query: query, limit: 10 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.searchResults.set(response.data || []);
          this.searchPerformed.set(true);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.searchResults.set([]);
          this.searchPerformed.set(true);
        } });
  }

  selectCustomer(customer: PosCustomer): void {
    this.customerSelected.emit(customer);
    this.onModalClosed();
  }

  switchToCreateMode(): void {
    this.currentStep.set('create');
  }

  onDocumentLookup(): void {
    const doc = this.lookupQuery().trim();
    if (doc.length < 5 || this.lookupLoading()) return;

    this.lookupLoading.set(true);
    this.lookupPerformed.set(false);
    this.lookupResult.set(null);
    this.externalResult.set(null);
    this.externalLoading.set(false);

    this.customerService
      .lookupByDocument(doc)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.lookupResult.set(result);
          this.lookupPerformed.set(true);
          this.lookupLoading.set(false);
          if (!result) this.lookupExternal(doc);
        },
        error: () => {
          this.lookupResult.set(null);
          this.lookupPerformed.set(true);
          this.lookupLoading.set(false);
          this.lookupExternal(doc);
        } });
  }

  onLookupQueryChange(value: string): void {
    this.lookupQuery.set(value);
    this.externalResult.set(null);
    this.externalLoading.set(false);
  }

  /** Una sola consulta a fuentes públicas por búsqueda; el service nunca lanza. */
  private lookupExternal(doc: string): void {
    this.externalLoading.set(true);
    this.customersService
      .lookupExternalByDocument(doc)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        // Descarta respuesta rancia si el operador cambió el texto.
        if (this.lookupQuery().trim() !== doc) return;
        this.externalResult.set(res);
        this.externalLoading.set(false);
      });
  }

  createFromExternal(): void {
    const identity = this.externalResult()?.identity;
    if (!identity) return;
    const prefill = ruesIdentityToPrefill(identity);
    const juridica = identity.person_type === 'JURIDICA';
    this.currentStep.set('create');
    this.customerForm.patchValue({
      documentType: prefill.document_type ?? '',
      documentNumber: prefill.document_number ?? '',
      personType: identity.person_type,
      legalName: juridica ? (prefill.legal_name ?? '') : '',
      firstName: juridica ? '' : (prefill.first_name ?? ''),
      lastName: juridica ? '' : (prefill.last_name ?? ''),
    });
  }

  createFromLookup(): void {
    this.currentStep.set('create');
    this.customerForm.patchValue({
      documentNumber: this.lookupQuery() });
  }

  private populateFormForEdit(): void {
    if (this.customer()) {
      this.customerForm.patchValue({
        email: this.customer()!.email,
        firstName: this.customer()!.first_name,
        lastName: this.customer()!.last_name,
        phone: this.customer()!.phone || '',
        documentType: this.customer()!.document_type || '',
        documentNumber: this.customer()!.document_number || '',
        taxRegime: this.customer()!.tax_regime || '',
        personType: this.customer()!.person_type || '',
        // Sin esto, editar un cliente JURIDICA lo degradaba a natural: el
        // patch nunca traía legal_name, así que el submit salía sin razón
        // social (root cause del incidente Óptica Panorama SAS).
        legalName: this.customer()!.legal_name || '',
        isWithholdingAgent: this.customer()!.is_withholding_agent ?? false });
    }
  }

  switchToSearchMode(): void {
    this.currentStep.set('search');
    this.customerForm.reset();
    this.searchResults.set([]);
    this.searchPerformed.set(false);
    this.lookupQuery.set('');
    this.lookupResult.set(null);
    this.lookupPerformed.set(false);
  }

  /** Plain methods (not computed): read the row fresh on each CD run. */
  displayName(customer: PosCustomer): string {
    if (customer.person_type === 'JURIDICA' && customer.legal_name?.trim()) {
      return customer.legal_name.trim();
    }
    const full = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
    return full || customer.legal_name?.trim() || customer.email || 'Sin nombre';
  }

  documentLine(customer: PosCustomer): string {
    const doc = [customer.document_type, customer.document_number]
      .filter((part) => !!part?.trim())
      .join(' ');
    return doc.trim();
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.customerForm.get(fieldName);
    if (field && field.errors && field.touched) {
      if (field.errors['required']) {
        switch (fieldName) {
          case 'phone':
            return 'El teléfono es requerido';
          case 'email':
            return 'El correo es requerido';
          case 'firstName':
            return 'El nombre es requerido';
          case 'lastName':
            return 'El apellido es requerido';
          case 'documentType':
            return 'Selecciona un tipo de documento';
          case 'documentNumber':
            return 'El número de documento es requerido';
          case 'taxRegime':
            return 'Selecciona un régimen tributario';
          case 'personType':
            return 'Selecciona un tipo de persona';
          case 'legalName':
            return 'La razón social es requerida';
          default:
            return 'Este campo es requerido';
        }
      }
      if (field.errors['email']) {
        return 'Email inválido';
      }
      if (field.errors['minlength']) {
        return `Mínimo ${field.errors['minlength'].requiredLength} caracteres`;
      }
      if (field.errors['pattern']) {
        switch (fieldName) {
          case 'phone':
            return 'El teléfono debe tener 10 dígitos';
          case 'documentNumber':
            return 'El formato del documento no es válido';
          default:
            return 'Formato inválido';
        }
      }
    }
    return undefined;
  }

  onFieldBlur(fieldName: string): void {
    const field = this.customerForm.get(fieldName);
    if (field) {
      field.markAsTouched();
    }
  }

  onCancel(): void {
    this.customerForm.reset();
    this.onModalClosed();
    this.isOpenChange.emit(false);
  }

  onSave(): void {
    if (!this.customerForm.valid) {
      this.markFormGroupTouched();
      this.focusFirstInvalidField();
      return;
    }

    this.loading.set(true);

    // getRawValue() (no .value): documentType puede estar disabled+locked en
    // NIT cuando person_type=JURIDICA (ver efecto de bloqueo en el
    // constructor); .value la omitiría y el payload perdería el tipo.
    const formData = this.customerForm.getRawValue();
    const isJuridica = formData.personType === 'JURIDICA';
    const documentType = formData.documentType || undefined;
    const documentNumber = formData.documentNumber || undefined;
    // A.8 — el DV nunca viaja tecleado: se recalcula fresco al guardar con
    // el mismo módulo 11 compartido (computeNitDv), sólo para NIT.
    const verificationDigit =
      documentType === 'NIT' && documentNumber
        ? (computeNitDv(documentNumber) ?? undefined)
        : undefined;

    const customerData: CreatePosCustomerRequest = {
      email: formData.email,
      // Jurídica: first_name vacío satisface el tipado no-opcional Y la
      // regla backend JuridicaNameRule (exige legal_name, prohíbe
      // first/last_name). Ver apps/backend/.../juridica-name.validator.ts.
      first_name: isJuridica ? '' : formData.firstName,
      last_name: isJuridica ? undefined : (formData.lastName || undefined),
      legal_name: isJuridica ? formData.legalName || undefined : undefined,
      phone: formData.phone || undefined,
      document_type: documentType,
      document_number: documentNumber,
      verification_digit: verificationDigit,
      // Mapeo camelCase (form) -> snake_case (request backend).
      tax_regime: formData.taxRegime || undefined,
      person_type: formData.personType || undefined,
      is_withholding_agent: formData.isWithholdingAgent ?? false };

    if (this.customer()) {
      // Update existing customer
      this.customerService
        .updateCustomer(this.customer()!.id, customerData)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (updatedCustomer) => {
            this.loading.set(false);
            this.customerUpdated.emit(updatedCustomer);
            this.onModalClosed();
          },
          error: (error) => {
            this.loading.set(false);
          } });
    } else {
      // Create new customer
      this.customerService
        .createCustomer(customerData)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (newCustomer) => {
            this.loading.set(false);
            this.customerCreated.emit(newCustomer);
            this.onModalClosed();
          },
          error: (error) => {
            this.loading.set(false);
          } });
    }
  }

  private markFormGroupTouched(): void {
    Object.keys(this.customerForm.controls).forEach((key) => {
      const control = this.customerForm.get(key);
      if (control) {
        control.markAsTouched();
      }
    });
  }

  /**
   * Stitch paso 4 — business decision "errores por campo con foco al primer
   * error": tras marcar touched, mueve el foco al primer campo inválido del
   * formulario (DOM order = orden del form). Solo presentación/a11y: no cambia
   * validaciones ni el contrato del servicio.
   */
  private focusFirstInvalidField(): void {
    // Review PR #824: diferir un frame para que .ng-invalid se aplique en
    // el siguiente ciclo CD (Zoneless) antes de buscar el campo inválido.
    requestAnimationFrame(() => {
      const root = this.hostRef.nativeElement as HTMLElement;
      const invalidControl = root.querySelector(
        'app-input.ng-invalid, app-selector.ng-invalid',
      );
      const focusable = invalidControl?.querySelector(
        'input, select, textarea, button',
      ) as HTMLElement | null;
      focusable?.focus();
    });
  }

  // Queue methods

  switchToQueueMode(): void {
    this.currentStep.set('queue');
    this.loadQueueData();
  }

  private loadQueueData(): void {
    this.queueLoading.set(true);
    this.queueService.loadQueue().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (entries) => {
        this.queueEntries.set(entries);
        this.queueLoading.set(false);
      },
      error: () => {
        this.queueEntries.set([]);
        this.queueLoading.set(false);
      } });

    if (!this.queueQrData()) {
      this.queueService.getQrCode().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (data) => this.queueQrData.set(data),
        error: () => {} });
    }
  }

  onSelectFromQueue(entry: QueueEntry): void {
    this.queueService.selectEntry(entry.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (selected) => {
        // Map queue entry to PosCustomer format and emit
        const customer: PosCustomer = {
          id: 0,
          email: entry.email || '',
          first_name: entry.first_name,
          last_name: entry.last_name,
          name: `${entry.first_name} ${entry.last_name}`,
          phone: entry.phone,
          document_type: entry.document_type,
          document_number: entry.document_number,
          created_at: new Date(),
          updated_at: new Date(),
          queueEntryId: entry.id,
          fromQueue: true };
        this.customerSelected.emit(customer);
        this.onModalClosed();
      },
      error: () => {} });
  }

  onReleaseFromQueue(entry: QueueEntry): void {
    this.queueService.releaseEntry(entry.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.loadQueueData(),
      error: () => {} });
  }

  printQueueQr(): void {
    const queueQrData = this.queueQrData();
    if (!queueQrData) return;
    const win = window.open('', '_blank', 'width=400,height=500');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Cola Virtual</title>
        <style>
          body { margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; }
          img { width: 250px; height: 250px; }
          p { font-size: 12px; color: #555; margin-top: 8px; word-break: break-all; text-align: center; max-width: 280px; }
          h2 { font-size: 16px; margin-bottom: 12px; }
          @media print { body { min-height: auto; } }
        </style>
      </head>
      <body>
        <h2>Registro en Cola Virtual</h2>
        <img src="${queueQrData.qr_data_url}" alt="QR Cola">
        <p>${queueQrData.url}</p>
        <script>window.onload = function() { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `);
    win.document.close();
  }

  // queueEnabled is now an @Input from the parent POS component

  onFullCreateClosed(): void {
    this.showFullCreate.set(false);
    this.pendingFullCreateAddress.set(null);
  }

  /**
   * Guarda lo capturado en la creación completa: mismo endpoint que el
   * quick-create (`POST /store/customers`) con el DTO fiscal extendido →
   * emite `customerCreated` (mismo output que el quick-create) y cierra.
   * En error, toast + modal abierto para corregir.
   */
  onFullCreateSave(data: CreateCustomerRequest): void {
    this.fullCreateLoading.set(true);
    const request: CreatePosCustomerRequest = {
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name || undefined,
      phone: data.phone || undefined,
      document_type: data.document_type || undefined,
      document_number: data.document_number || undefined,
      legal_name: data.legal_name || undefined,
      verification_digit: data.verification_digit || undefined,
      ciiu_code: data.ciiu_code || undefined,
      fiscal_responsibilities: data.fiscal_responsibilities ?? undefined,
      tax_regime: data.tax_regime ?? undefined,
      person_type: data.person_type ?? undefined,
      is_withholding_agent: data.is_withholding_agent ?? false,
    };
    this.customerService
      .createCustomer(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.fullCreateLoading.set(false);
          this.persistFullCreateAddress(created.id);
          this.showFullCreate.set(false);
          this.pendingFullCreateAddress.set(null);
          this.customerCreated.emit(created);
          this.onModalClosed();
        },
        error: () => {
          this.fullCreateLoading.set(false);
          this.toastService.error(
            'No se pudo crear el cliente. Revisa los datos e intenta de nuevo.',
          );
        },
      });
  }

  /**
   * Persiste la dirección capturada en la creación completa
   * (`POST /store/addresses`). Best-effort y no bloqueante: el cliente ya
   * quedó creado; un fallo aquí solo avisa por toast. Mismo mapeo que
   * `order-details-page.persistChangeCustomerAddress`.
   */
  private persistFullCreateAddress(customerId: number): void {
    const addr = this.pendingFullCreateAddress();
    this.pendingFullCreateAddress.set(null);
    if (!addr?.address_line1 || !addr.city) return;
    this.customersService
      .createCustomerAddress({
        address_line_1: addr.address_line1,
        address_line_2: addr.address_line2 ?? undefined,
        city: addr.city,
        state: addr.state_province ?? '',
        country: addr.country_code ?? '',
        postal_code: addr.postal_code ?? undefined,
        municipality_code: addr.municipality_code ?? undefined,
        type: 'shipping',
        is_primary: true,
        customer_id: customerId,
        ...(addr.latitude != null ? { latitude: String(addr.latitude) } : {}),
        ...(addr.longitude != null
          ? { longitude: String(addr.longitude) }
          : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.toastService.warning(
            'Cliente creado, pero no se pudo guardar la dirección.',
          );
        },
      });
  }

  onModalClosed(): void {
    this.customerForm.reset();
    this.currentStep.set('search');
    this.searchResults.set([]);
    this.searchPerformed.set(false);
    this.lookupQuery.set('');
    this.lookupResult.set(null);
    this.lookupPerformed.set(false);
    this.queueEntries.set([]);
    this.queueQrData.set(null);
    this.showFullCreate.set(false);
    this.pendingFullCreateAddress.set(null);
    this.closed.emit();
  }
}

/**
 * QUI-724 — extrae el mínimo de caracteres de un regex de tipo de documento.
 * Soporta patrones como /^\d{6,10}$/, /^\d{8,10}-?\d?$/ y /^[A-Z0-9]{5,16}$/.
 * Devuelve 0 si no puede parsear (caso defensivo).
 */
function extractDocTypeMin(regex: RegExp): number {
  const match = regex.source.match(/\{(\d+)(?:,(\d*))?\}/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

/**
 * QUI-724 — devuelve true si el regex exige caracteres alfabéticos (alfanumérico).
 * Heurística: la fuente del regex contiene letras en una clase de caracteres.
 */
function isAlphanumericRegex(regex: RegExp): boolean {
  return /[A-Za-z]/.test(regex.source);
}
