import {
  Component,
  input,
  output,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { CreateCurrencyDto, CurrencyState, CurrencyPosition } from '../interfaces';
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/index';
import {
  CurrencyService,
  CurrencyCodeInfo,
  CurrencyDetails,
  CurrencyApiError,
} from '../../../../../services/currency.service';

@Component({
  selector: 'app-currency-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Activar Nueva Moneda"
      subtitle="Selecciona una moneda de la lista para activarla en el sistema"
    >
      @if (isLoadingCodes()) {
        <div class="flex flex-col items-center justify-center py-8 space-y-3">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="text-sm text-gray-600">Cargando monedas disponibles...</p>
        </div>
      } @else if (apiError()) {
        <div class="bg-red-50 border border-red-200 rounded-lg p-4">
          <p class="text-sm text-red-800">{{ apiError() }}</p>
        </div>
      } @else {
        <form [formGroup]="currencyForm" (ngSubmit)="onSubmit()">
          <div class="space-y-4">
            <!-- Paso 1: Selector de código de moneda -->
            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-700">
                Seleccionar Moneda
                <span class="text-xs text-gray-500 font-normal">
                  ({{ availableCodes().length }} disponibles)
                </span>
              </label>
              @if (isLoadingDetails()) {
                <div class="flex items-center gap-2 text-sm text-gray-600">
                  <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                  <span>Cargando detalles...</span>
                </div>
              }
              <select
                [formControl]="selectedCodeControl"
                [disabled]="isSubmitting() || isLoadingDetails()"
                class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">-- Selecciona una moneda --</option>
                @for (codeInfo of availableCodes(); track codeInfo.code) {
                  <option [value]="codeInfo.code">
                    {{ codeInfo.code }}
                  </option>
                }
              </select>
              <p class="text-xs text-gray-500">
                Las monedas se obtienen desde Currency Rate Exchange API
              </p>
            </div>

            <!-- Campos readonly desde la API (se muestran después de seleccionar) -->
            @if (currencyDetails()) {
              <div class="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div class="flex items-center gap-3">
                  @if (currencyDetails()?.flagImage) {
                    <img
                      [src]="currencyDetails()!.flagImage"
                      [alt]="'Bandera de ' + currencyDetails()!.countryName"
                      class="w-8 h-6 object-cover rounded shadow-sm"
                    />
                  }
                  <div class="flex-1">
                    <p class="text-sm font-medium text-gray-900">
                      {{ currencyDetails()!.name }}
                    </p>
                    <p class="text-xs text-gray-500">
                      {{ currencyDetails()!.countryName }} ({{ currencyDetails()!.countryCode }})
                    </p>
                  </div>
                </div>
              </div>

              <app-input
                label="Código de Moneda"
                [value]="currencyDetails()?.code || ''"
                [disabled]="true"
                helpText="Código ISO 4217"
              ></app-input>

              <app-input
                label="Nombre de Moneda"
                [value]="currencyDetails()?.name || ''"
                [disabled]="true"
                helpText="Nombre completo desde API"
              ></app-input>

              <app-input
                label="Símbolo"
                [value]="currencyDetails()?.symbol || ''"
                [disabled]="true"
                helpText="Símbolo de moneda desde API"
              ></app-input>

              <!-- Posición del símbolo (editable, default before) -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700">
                  Posición del Símbolo
                </label>
                <select
                  formControlName="position"
                  [disabled]="isSubmitting()"
                  class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option [value]="CurrencyPosition.BEFORE">Antes ($100)</option>
                  <option [value]="CurrencyPosition.AFTER">Después (100$)</option>
                </select>
                <p class="text-xs text-gray-500">
                  Ubicación del símbolo respecto al monto
                </p>
              </div>

              <!-- Campo configurable: decimales -->
              <app-input
                formControlName="decimal_places"
                label="Decimales"
                type="number"
                [required]="true"
                [control]="currencyForm.get('decimal_places')"
                [disabled]="isSubmitting()"
                helpText="Número de decimales (0-4, típicamente 2)"
              ></app-input>

              <!-- Estado -->
              <div class="space-y-2">
                <app-selector
                  formControlName="state"
                  label="Estado Inicial"
                  [options]="stateOptions"
                  [disabled]="isSubmitting()"
                  helpText="Las monedas activas pueden usarse en todo el sistema"
                ></app-selector>
              </div>
            } @else {
              <div class="text-center py-6 text-sm text-gray-500">
                <p>Selecciona un código de moneda arriba para ver los detalles</p>
              </div>
            }
          </div>
        </form>
      }

      <ng-container slot="footer">
        <div class="flex justify-end gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="!canSubmit() || isSubmitting()"
            [loading]="isSubmitting()"
          >
            Activar Moneda
          </app-button>
        </div>
      </ng-container>
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
export class CurrencyCreateModalComponent implements OnInit {
  isOpen = input<boolean>(false);
  isSubmitting = input<boolean>(false);
  isOpenChange = output<boolean>();
  submit = output<CreateCurrencyDto>();
  cancel = output<void>();

  stateOptions: SelectorOption[] = [
    { value: 'active', label: 'Activa' },
    { value: 'inactive', label: 'Inactiva' },
    { value: 'deprecated', label: 'Obsoleta' },
  ];

  // Exponer el enum para usar en el template
  readonly CurrencyPosition = CurrencyPosition;

  private fb = inject(FormBuilder);
  private currencyService = inject(CurrencyService);

  // Signals para el estado reactivo
  availableCodes = signal<CurrencyCodeInfo[]>([]);
  currencyDetails = signal<CurrencyDetails | null>(null);
  isLoadingCodes = signal(false);
  isLoadingDetails = signal(false);
  apiError = signal<string | null>(null);

  selectedCodeControl = inject(FormBuilder).control<string | null>(
    null,
    Validators.required,
  );

  currencyForm: FormGroup = this.fb.group({
    position: [
      CurrencyPosition.BEFORE, // Default before
      [Validators.required],
    ],
    decimal_places: [
      2,
      [Validators.required, Validators.min(0), Validators.max(4)],
    ],
    state: [CurrencyState.ACTIVE],
  });

  async ngOnInit(): Promise<void> {
    this.loadCurrencyCodes();

    // Escuchar cambios en el selector de código
    this.selectedCodeControl.valueChanges.subscribe((code: string | null) => {
      this.onCodeSelect(code);
    });
  }

  /**
   * Paso 1: Cargar la lista de códigos disponibles
   */
  async loadCurrencyCodes(): Promise<void> {
    this.isLoadingCodes.set(true);
    this.apiError.set(null);

    try {
      const codes = await this.currencyService.getAvailableCurrencyCodes();
      this.availableCodes.set(codes);
    } catch (error) {
      console.error('[CurrencyCreateModal] Error loading currency codes:', error);
      if (error instanceof CurrencyApiError) {
        this.apiError.set(error.message);
      } else {
        this.apiError.set('No se pudo cargar la lista de monedas. Intenta nuevamente.');
      }
    } finally {
      this.isLoadingCodes.set(false);
    }
  }

  /**
   * Paso 2: Cuando se selecciona un código, obtener los detalles
   */
  async onCodeSelect(code: string | null): Promise<void> {
    // Resetear detalles y formulario si no hay código
    if (!code) {
      this.currencyDetails.set(null);
      this.resetFormFields();
      return;
    }

    this.isLoadingDetails.set(true);
    this.apiError.set(null);

    try {
      // Obtener detalles desde la API
      const details = await this.currencyService.getCurrencyDetails(code);
      this.currencyDetails.set(details);
    } catch (error) {
      console.error(
        `[CurrencyCreateModal] Error loading details for ${code}:`,
        error
      );
      if (error instanceof CurrencyApiError) {
        this.apiError.set(error.message);
      } else {
        this.apiError.set(`No se pudieron cargar los detalles de ${code}`);
      }
      this.currencyDetails.set(null);
      this.resetFormFields();
    } finally {
      this.isLoadingDetails.set(false);
    }
  }

  /**
   * Verificar si se puede enviar el formulario
   */
  canSubmit(): boolean {
    return (
      this.currencyForm.valid &&
      this.currencyDetails() !== null &&
      !this.isLoadingCodes() &&
      !this.isLoadingDetails()
    );
  }

  onSubmit(): void {
    if (this.currencyForm.valid && this.currencyDetails()) {
      const details = this.currencyDetails()!;
      const currencyData: CreateCurrencyDto = {
        code: details.code,
        name: details.name,
        symbol: details.symbol,
        decimal_places: this.currencyForm.value.decimal_places,
        position: this.currencyForm.value.position || CurrencyPosition.BEFORE,
        state: this.currencyForm.value.state || CurrencyState.ACTIVE,
      };
      this.submit.emit(currencyData);
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
    this.cancel.emit();
  }

  private resetFormFields(): void {
    this.currencyForm.patchValue({
      position: CurrencyPosition.BEFORE,
    });
  }

  resetForm(): void {
    this.selectedCodeControl.reset();
    this.currencyDetails.set(null);
    this.apiError.set(null);
    this.currencyForm.reset({
      position: CurrencyPosition.BEFORE,
      decimal_places: 2,
      state: CurrencyState.ACTIVE,
    });
  }
}
