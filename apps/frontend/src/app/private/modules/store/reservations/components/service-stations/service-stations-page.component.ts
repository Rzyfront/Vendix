import { CommonModule, DecimalPipe } from '@angular/common';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { HttpClient } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom, interval } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  CustomerSelectComponent,
  CustomerSelectOption,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderActionButton,
  StickyHeaderTab,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { ShippingMethodsService } from '../../../settings/shipping/services/shipping-methods.service';
import { ShippingRateTaxOptions } from '../../../settings/shipping/interfaces/shipping-zones.interface';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { ReservationsService } from '../../services/reservations.service';
import { ServiceProvider } from '../../interfaces/reservation.interface';
import {
  ServiceStation,
  ProviderAvailability,
  ServiceStationsService,
  StationProviderOption,
  StationServiceOption,
  IntakeTemplate,
  IntakeTemplateItem,
  SessionIntake,
  StationType,
} from './service-stations.service';
import { SessionIntakeFormComponent } from './session-intake-form/session-intake-form.component';
import {
  buildIntakeEntries,
  flattenIntakeSections,
  missingRequiredIntakeItems,
  uniqueIntakeItems,
} from './session-intake-form/session-intake-form.util';
import {
  computeStationClock,
  nextReservationLabel,
  shouldWarnNextReservation,
  StationClock,
} from './station-clock.util';
import { stationTypeLabel } from './station-type-labels';

import { environment } from '../../../../../../../environments/environment';
import { DataCollectionTemplatesService } from '../../../data-collection/services/data-collection-templates.service';
import { MetadataFieldsService } from '../../../data-collection/services/metadata-fields.service';
import { MetadataField } from '../../../data-collection/interfaces/metadata-field.interface';
import {
  DEFAULT_CUSTOMER_SECTION,
  SERVICE_FIELD_PRESETS,
  STATION_TEMPLATE_TYPES,
  StationTemplateType,
  presetEntityType,
} from '../../../data-collection/utils/service-field-presets';
import { forkJoin, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ServiceRemindersPageComponent } from '../service-reminders-page/service-reminders-page.component';
import {
  DEFAULT_STATION_RULES,
  StationRulesFormComponent,
  stationRulesError,
  stationRulesFrom,
  stationRulesPayload,
} from './station-rules-form/station-rules-form.component';
import {
  DEFAULT_RENTAL_RULES,
  StationRentalFormComponent,
  stationRentalError,
  stationRentalFrom,
  stationRentalPayload,
  stationRentalSummary,
} from './station-rental-form/station-rental-form.component';
import { StationRateWindowsComponent } from './station-rate-windows/station-rate-windows.component';
import { WeeklyScheduleEditorComponent } from '../schedule-management/weekly-schedule-editor/weekly-schedule-editor.component';
import {
  OpenSessionDepositComponent,
  OpenSessionDepositValue,
  openCustomerError,
  openDepositError,
} from './open-session-deposit/open-session-deposit.component';

/** El selector de impuesto trabaja con `number`; `null` es «Sin impuesto». */
function toTaxCategoryId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface CheckinLine {
  key: number;
  product_id: number | null;
  product_variant_id: number | null;
  quantity: number;
  unit_price: number | null;
  /** true si el usuario cambió el precio: solo entonces se envía `unit_price`. */
  price_edited: boolean;
}

export interface ServiceSessionRow {
  id: number;
  status: string;
  opened_at: string;
  planned_end_at?: string | null;
  next_reservation?: { start_at: string; booking_id?: number | null; customer_name?: string | null } | null;
  station_id: number;
  station_name: string;
  product_id?: number | null;
  product_name: string;
  subject?: { label: string; subject_type?: string; metadata?: Record<string, unknown> } | null;
  allocation?: { provider_id?: number; provider_name?: string } | null;
  budget_amount?: number | null;
  access_url?: string | null;
  contact_email?: string | null;
  intake?: SessionIntake | null;
  order?: {
    id: number;
    order_number: string;
    grand_total: number;
    subtotal_amount: number;
    tax_amount?: number;
    remaining_balance: number;
    order_items?: Array<{
      id: number;
      product_id: number;
      product_name: string;
      quantity: number;
      unit_price: number;
      total_price: number;
      /** Precio por unidad con impuestos (base + IVA del producto). */
      final_unit_price?: number | null;
      tax_rate?: number | null;
      item_type?: string;
    }>;
  } | null;
}

export interface StationTypeMeta {
  id: StationType;
  label: string;
  singularLabel: string;
  icon: string;
  description: string;
  requiresVehicle: boolean;
  vehicleNamePlaceholder: string;
  platePlaceholder: string;
}

export const STATION_TYPES_META: Record<StationType, StationTypeMeta> = {
  carro: {
    id: 'carro',
    label: 'Bahías para Carros / Autos',
    singularLabel: 'Carro / Automóvil',
    icon: 'warehouse',
    description: 'Elevadores, fosas, lubricación, autolavado y mecánica automotriz',
    requiresVehicle: true,
    vehicleNamePlaceholder: 'Ej. Toyota Corolla, Chevrolet Onix, Kia Sportage',
    platePlaceholder: 'Ej. ABC-123',
  },
  moto: {
    id: 'moto',
    label: 'Boxes para Motos',
    singularLabel: 'Motocicleta / Moto',
    icon: 'zap',
    description: 'Rampas para motos, lubricación, frenos y lavado especializado',
    requiresVehicle: true,
    vehicleNamePlaceholder: 'Ej. Yamaha NMAX 155, Bajaj Pulsar NS 200, AKT NKD',
    platePlaceholder: 'Ej. XYZ-45D',
  },
  celular: {
    id: 'celular',
    label: 'Reparación de Celulares / Electrónica',
    singularLabel: 'Celular / Electrónica',
    icon: 'smartphone',
    description: 'Diagnóstico, cambio de pantalla, microelectrónica y reparación de dispositivos',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  peluqueria: {
    id: 'peluqueria',
    label: 'Peluquería',
    singularLabel: 'Peluquería',
    icon: 'scissors',
    description: 'corte, tinte, peinado, tratamientos capilares (unisex)',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  barberia: {
    id: 'barberia',
    label: 'Barbería (Sillón Clásico)',
    singularLabel: 'Barbería',
    icon: 'user',
    description: 'corte masculino, fade, arreglo de barba y afeitado con navaja',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  salon_belleza: {
    id: 'salon_belleza',
    label: 'Salón de Belleza / Spa',
    singularLabel: 'Salón de Belleza / Spa',
    icon: 'sparkles',
    description: 'manicure, pedicure, masajes, faciales',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  general: {
    id: 'general',
    label: 'Servicios Generales',
    singularLabel: 'Estación General',
    icon: 'activity',
    description: 'Puestos polivalentes de atención directa a clientes',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  cava: {
    id: 'cava',
    label: 'Cavas',
    singularLabel: 'Cava',
    icon: 'sparkles',
    description: 'Cavas y zonas privadas con consumo por anticipo',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  cancha: {
    id: 'cancha',
    label: 'Canchas',
    singularLabel: 'Cancha',
    icon: 'trophy',
    description: 'Canchas y escenarios deportivos por tiempo',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  sala: {
    id: 'sala',
    label: 'Salas',
    singularLabel: 'Sala',
    icon: 'door-open',
    description: 'Salas de reunión, juegos o eventos por tiempo',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
  finca: {
    id: 'finca',
    label: 'Fincas',
    singularLabel: 'Finca',
    icon: 'home',
    description: 'Fincas y espacios campestres de uso por día',
    requiresVehicle: false,
    vehicleNamePlaceholder: '',
    platePlaceholder: '',
  },
};

export const STATION_TYPE_SELECTOR_OPTIONS: SelectorOption[] = [
  { value: 'carro', label: 'Bahía para Carros / Automóviles', icon: 'warehouse', description: 'Elevadores, fosas, autolavado y lubricación' },
  { value: 'moto', label: 'Box para Motos / Motocicletas', icon: 'zap', description: 'Rampas neumáticas y lubricación de motos' },
  { value: 'celular', label: 'Reparación de Celulares / Electrónica', icon: 'smartphone', description: 'Diagnóstico, cambio de pantalla y microelectrónica' },
  { value: 'peluqueria', label: 'Peluquería', icon: 'scissors', description: 'corte, tinte, peinado, tratamientos capilares (unisex)' },
  { value: 'barberia', label: 'Barbería (Sillón Clásico)', icon: 'user', description: 'corte masculino, fade, arreglo de barba y afeitado con navaja' },
  { value: 'salon_belleza', label: 'Salón de Belleza / Spa', icon: 'sparkles', description: 'manicure, pedicure, masajes, faciales' },
  { value: 'cava', label: 'Cava', icon: 'sparkles', description: 'Zona privada con anticipo consumible' },
  { value: 'cancha', label: 'Cancha', icon: 'trophy', description: 'Escenario deportivo por tiempo' },
  { value: 'sala', label: 'Sala', icon: 'door-open', description: 'Sala de reunión, juegos o eventos' },
  { value: 'finca', label: 'Finca', icon: 'home', description: 'Espacio campestre de uso por día' },
  { value: 'general', label: 'Servicio General', icon: 'activity', description: 'Atención personalizada y puestos polivalentes' },
];

export type StatusFilterId = 'all' | 'occupied' | 'free' | 'paused';

@Component({
  selector: 'app-service-stations-page',
  standalone: true,
  imports: [
    CommonModule,
    DecimalPipe,
    CurrencyPipe,
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    SpinnerComponent,
    ButtonComponent,
    ConfirmationModalComponent,
    IconComponent,
    BadgeComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
    SessionIntakeFormComponent,
    ServiceRemindersPageComponent,
    CustomerSelectComponent,
    StationRulesFormComponent,
    StationRentalFormComponent,
    StationRateWindowsComponent,
    WeeklyScheduleEditorComponent,
    OpenSessionDepositComponent,
  ],
  templateUrl: './service-stations-page.component.html',
  styleUrl: './service-stations-page.component.scss',
})
export class ServiceStationsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly stationsApi = inject(ServiceStationsService);
  private readonly reservationsApi = inject(ReservationsService);
  private readonly router = inject(Router);
  private readonly templatesApi = inject(DataCollectionTemplatesService);
  private readonly fieldsApi = inject(MetadataFieldsService);
  readonly stationTemplateTypes = STATION_TEMPLATE_TYPES;
  /** Selector de tipo antes de diseñar una plantilla de estación. */
  readonly showTemplateTypePicker = signal(false);

  /** Formularios activos de Recolección de datos, para asignar uno a cada estación. */
  readonly intakeTemplates = signal<Array<{ id: number; name: string; entity_type?: string; station_type?: string | null }>>([]);
  readonly intakeTemplateOptions = computed<SelectorOption[]>(() => [
    { value: 0, label: 'Usar el formulario de cada servicio' },
    ...this.intakeTemplates().map((t) => ({ value: t.id, label: t.name })),
  ]);
  /** Plantillas de estación (Atención de servicio): una es obligatoria para crear la estación. */
  readonly stationTemplateOptions = computed<SelectorOption[]>(() =>
    this.intakeTemplates()
      .filter((t) => !t.entity_type || t.entity_type === 'service_session')
      .map((t) => ({
        value: t.id,
        label: t.name,
        description: STATION_TEMPLATE_TYPES.find((type) => type.value === t.station_type)?.label ?? 'General',
      })),
  );
  readonly newIntakeTemplateId = signal<number>(0);
  readonly designingTemplate = signal(false);
  readonly editIntakeTemplateId = signal<number>(0);

  // Impuesto del alquiler: mismo catálogo y elegibilidad que la tarifa de envío.
  private readonly shippingService = inject(ShippingMethodsService);
  readonly taxOptions = signal<ShippingRateTaxOptions | null>(null);
  readonly loadingTaxOptions = signal(false);
  readonly taxOptionsError = signal<string | null>(null);
  readonly newTaxCategoryId = signal<number | null>(null);
  readonly newTaxIsInclusive = signal(true);
  readonly editTaxCategoryId = signal<number | null>(null);
  readonly editTaxIsInclusive = signal(true);
  // Reglas de uso y anticipo (S1): un valor por formulario, con el impuesto de Gastos de reserva.
  readonly newRules = signal(DEFAULT_STATION_RULES);
  readonly editRules = signal(DEFAULT_STATION_RULES);
  readonly newRental = signal(DEFAULT_RENTAL_RULES);
  readonly editRental = signal(DEFAULT_RENTAL_RULES);
  readonly newRulesTaxOptions = computed(() =>
    this.buildTaxSelectorOptions(this.newRules().reservation_fee_tax_category_id),
  );
  readonly editRulesTaxOptions = computed(() =>
    this.buildTaxSelectorOptions(this.editRules().reservation_fee_tax_category_id),
  );
  readonly newTaxSelectorOptions = computed(() => this.buildTaxSelectorOptions(null));
  readonly editTaxSelectorOptions = computed(() =>
    this.buildTaxSelectorOptions(this.selectedStation()?.rental_tax_category_id ?? null),
  );
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  readonly currencyCode = this.currencyService.currencyCode;

  /** Ticks every second so the per-station clocks stay live (signal based, no zone APIs). */
  readonly now = signal(Date.now());

  // Base state
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly stations = signal<ServiceStation[]>([]);
  readonly activeSessions = signal<ServiceSessionRow[]>([]);
  readonly services = signal<StationServiceOption[]>([]);
  readonly providers = signal<StationProviderOption[]>([]);
  readonly providerRecords = signal<ServiceProvider[]>([]);

  // Header Actions
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'templates',
      label: 'Ver plantillas',
      variant: 'secondary',
      icon: 'layout-template',
    },
    {
      id: 'design-template',
      label: 'Diseñar plantilla de estación',
      variant: 'outline',
      icon: 'layout-template',
      loading: this.designingTemplate(),
    },
    {
      id: 'create-station',
      label: 'Nueva Estación',
      variant: 'outline',
      icon: 'plus',
    },
    {
      id: 'new-checkin',
      label: 'Nuevo Ingreso',
      variant: 'primary',
      icon: 'plus',
    },
  ]);

  onHeaderAction(id: string): void {
    if (id === 'templates') {
      // Plantillas creadas (Recolección de datos); su flecha ← vuelve a Estaciones.
      this.router.navigate(['/admin/data-collection/templates']);
    } else if (id === 'design-template') {
      this.designNewStationTemplate();
    } else if (id === 'create-station') {
      this.openCreateModal();
    } else if (id === 'new-checkin') {
      this.openCheckinModal();
    }
  }

  // Filters & selection
  readonly selectedCategory = signal<string>('all');
  readonly selectedStatusFilter = signal<StatusFilterId>('all');
  readonly timezone = computed(() => this.storeSettings.timezone());
  /** `pos.allow_anonymous_sales`, read as the table and POS flows do: off means a customer is required. */
  readonly checkinAllowsAnonymous = computed(() => this.storeSettings.pos()?.allow_anonymous_sales ?? false);

  // Modals state
  readonly showCreateModal = signal(false);
  readonly showCheckinModal = signal(false);
  readonly showConfigModal = signal(false);
  readonly showDeactivateConfirm = signal(false);
  readonly showDeleteConfirm = signal(false);
  readonly showQrModal = signal(false);

  // QR Modal State
  readonly qrStation = signal<ServiceStation | null>(null);
  readonly qrDataUrl = signal<string | null>(null);
  readonly qrPublicUrl = signal<string | null>(null);
  readonly qrLoading = signal(false);
  /** Why the QR could not be built (shown inside the modal, not only as a toast). */
  readonly qrError = signal<string | null>(null);
  /** True when the failure is the missing public domain (STATION_014). */
  readonly qrNeedsDomain = signal(false);

  // Create station form
  readonly newName = signal('');
  /** Empty means: the backend takes the type from the chosen template. */
  readonly newStationType = signal<StationType | ''>('');
  readonly newTrackTime = signal(false);
  readonly newTargetMinutes = signal<number | null>(null);

  // Check-in form
  readonly checkinStationId = signal<number | null>(null);
  /** True si el modal se abrió desde "Asignar" de una tarjeta: muestra el nombre fijo. */
  readonly checkinStationLocked = signal(false);
  readonly checkinVehicleName = signal('');
  readonly checkinPlate = signal('');
  readonly checkinMileage = signal('');
  readonly checkinDeviceModel = signal('');
  readonly checkinImei = signal('');
  readonly checkinReportedIssue = signal('');
  readonly checkinUnlockCode = signal('');
  readonly checkinAccessories = signal('');
  readonly checkinStylePreference = signal('');
  readonly checkinAllergies = signal('');
  // Formulario de recepción (Recolección de datos) del servicio seleccionado
  readonly checkinIntakeTemplate = signal<IntakeTemplate | null>(null);
  readonly checkinIntakeLoading = signal(false);
  readonly checkinIntakeValues = signal<Record<number, unknown>>({});
  private readonly destroyRef = inject(DestroyRef);

  /** Prellenado del alta de cliente con lo ya digitado en el check-in. */
  readonly checkinCustomerInitialValues = computed(() => {
    const [first, ...rest] = this.checkinCustomerName().trim().split(/\s+/).filter(Boolean);
    return {
      ...(first ? { first_name: first } : {}),
      ...(rest.length ? { last_name: rest.join(' ') } : {}),
      ...(this.checkinCustomerDoc().trim() ? { document_number: this.checkinCustomerDoc().trim() } : {}),
      ...(this.checkinCustomerPhone().trim() ? { phone: this.checkinCustomerPhone().trim() } : {}),
      ...(this.checkinCustomerEmail().trim() ? { email: this.checkinCustomerEmail().trim() } : {}),
    };
  });
  readonly checkinCustomer = signal<CustomerSelectOption | null>(null);
  readonly checkinCustomerName = signal('');
  readonly checkinCustomerDoc = signal('');
  readonly checkinCustomerPhone = signal('');
  readonly checkinCustomerEmail = signal('');
  readonly checkinProductId = signal<number | null>(null);
  readonly checkinProviderId = signal<number | null>(null);
  /** Se prende al intentar iniciar sin técnico (borde rojo + mensaje bajo el select). */
  readonly checkinProviderError = signal(false);
  readonly checkinDurationMinutes = signal<number>(45);
  readonly checkinNotes = signal('');

  // Presupuesto inicial e insumo inicial (Aplica como opcional a TODOS los tipos)
  readonly checkinBudgetAmount = signal<number | null>(null);
  /** Productos que entran a la cuenta desde el ingreso (además del servicio). */
  readonly checkinLines = signal<CheckinLine[]>([]);
  /** Anticipo del ingreso (S4): monto, medio y request_id; null mientras la estación no lo pide. */
  readonly checkinDeposit = signal<OpenSessionDepositValue | null>(null);
  private checkinLineSeq = 0;

  // access_url recién emitido por sesión; viaja a la página de la atención al abrirla
  readonly lastAccessUrlBySession = signal<Map<number, string>>(new Map());

  // Selector Options
  readonly stationTypesMeta = STATION_TYPES_META;
  readonly stationTypeOptions = STATION_TYPE_SELECTOR_OPTIONS;
  readonly newStationTypeOptions: SelectorOption[] = [
    { value: '', label: 'Según la plantilla', description: 'Usa el tipo de la plantilla elegida' },
    ...STATION_TYPE_SELECTOR_OPTIONS,
  ];

  readonly selectedCheckinStation = computed(() => {
    const id = this.checkinStationId();
    if (!id) return null;
    return this.stations().find((s) => s.id === id) ?? null;
  });

  readonly checkinStationType = computed<StationType>(() => {
    const st = this.selectedCheckinStation();
    if (!st) return 'carro';
    return this.getStationType(st);
  });

  /** El tiempo estimado solo se pide cuando la estación tiene el cronómetro activo. */
  readonly checkinTracksTime = computed(() => !!this.selectedCheckinStation()?.track_time);

  readonly checkinRequiresVehicle = computed(() => {
    const type = this.checkinStationType();
    return type === 'carro' || type === 'moto';
  });

  readonly checkinIsMoto = computed(() => {
    return this.checkinStationType() === 'moto';
  });

  readonly checkinIsCelular = computed(() => {
    return this.checkinStationType() === 'celular';
  });

  readonly checkinIsBeauty = computed(() => {
    const type = this.checkinStationType();
    return type === 'peluqueria' || type === 'barberia' || type === 'salon_belleza';
  });

  readonly stationSelectorOptions = computed<SelectorOption[]>(() => {
    return this.stations().map((st) => {
      const sess = this.stationSession(st.id);
      const isOccupied = !!sess;
      const isInactive = st.status !== 'active';
      const type = this.getStationType(st);
      const meta = STATION_TYPES_META[type];
      const statusLabel = isOccupied ? ' [Ocupada]' : isInactive ? ' [Inactiva]' : ' [Libre]';
      return {
        value: st.id,
        label: `${st.name}${statusLabel}`,
        icon: meta.icon,
        disabled: isOccupied || isInactive,
        description: isOccupied ? `Ocupada (${this.getCustomerName(sess!)})` : meta.singularLabel,
      };
    });
  });

  readonly checkinLinkedServiceIds = computed<number[]>(() => {
    return this.selectedCheckinStation()?.services?.map((s) => s.product_id) ?? [];
  });

  readonly serviceSelectorOptions = computed<SelectorOption[]>(() => {
    const opts: SelectorOption[] = [];
    // Solo los servicios asignados a ESTA estación y activos en el catálogo.
    const linked = this.checkinLinkedServiceIds();
    const list = this.services().filter((s) => linked.includes(s.id) && (!s.state || s.state === 'active'));
    const effective = linked.length && !list.length
      ? this.selectedCheckinStation()?.services?.map((s) => ({
          id: s.product_id,
          name: s.product?.name ?? `Servicio #${s.product_id}`,
          base_price: s.product?.base_price,
          service_duration_minutes: s.product?.service_duration_minutes ?? null,
        })) ?? []
      : list;
    for (const s of effective) {
      opts.push({
        value: s.id,
        label: `${s.name} · ${this.currencyService.format(Number(s.base_price || 0))}`,
        description: s.service_duration_minutes ? `${s.service_duration_minutes} min estimados` : 'Precio cargado a la cuenta al iniciar',
      });
    }
    return opts;
  });

  readonly checkinServicePrice = computed(() => {
    const productId = Number(this.checkinProductId() || 0);
    const service = this.services().find((svc) => svc.id === productId) as { base_price?: unknown; final_price?: unknown } | undefined;
    // final_price ya trae el IVA del servicio resuelto por el backend (incluido o sumado).
    return Number(service?.final_price ?? service?.base_price ?? 0);
  });

  readonly checkinIntakeItems = computed<IntakeTemplateItem[]>(() =>
    uniqueIntakeItems(flattenIntakeSections(this.checkinIntakeTemplate())),
  );

  /** Campos de cliente (entity_type customer) de la plantilla, en orden y sin repetir. */
  readonly checkinCustomerIntakeItems = computed<IntakeTemplateItem[]>(() =>
    this.checkinIntakeItems().filter((item) => item.metadata_field.entity_type === 'customer'),
  );

  /** La plantilla trae campos de cliente: van en "Datos del Cliente", una sola vez. */
  readonly templateHasCustomerFields = computed(() => this.checkinCustomerIntakeItems().length > 0);

  /** El servicio solo se manda al cargar la plantilla si la estación no trae la suya. */
  readonly checkinIntakeProductId = computed(() =>
    this.selectedCheckinStation()?.intake_template_id ? null : Number(this.checkinProductId() || 0) || null,
  );

  readonly checkinInitialLineTotal = computed(() => {
    return this.checkinLines().reduce((acc, line) => acc + this.checkinLineEstimate(line), 0);
  });

  readonly checkinEstimatedTotal = computed(() => this.checkinServicePrice() + this.checkinInitialLineTotal());

  readonly checkinProviderAvailability = signal<ProviderAvailability[]>([]);
  /** Personal de la estación que no se puede asignar ahora, con el motivo. */
  readonly unavailableCheckinProviders = computed(() =>
    this.checkinProviderAvailability().filter((entry) => entry.status !== 'available' && entry.status !== 'inactive'),
  );

  /** Station staff still loading: the check-in waits so a staffed station is never opened without its specialist. */
  readonly checkinProvidersLoading = signal(false);
  /**
   * A specialist is mandatory only where the station has active staff assigned. Rooms and
   * cavas usually have none, and the API opens those sessions without a provider.
   */
  readonly checkinNeedsProvider = computed(() => this.checkinProviderAvailability().some((entry) => entry.status !== 'inactive'));

  private loadCheckinProviderAvailability(): void {
    const stationId = Number(this.checkinStationId() || 0);
    this.checkinProviderAvailability.set([]);
    this.checkinProvidersLoading.set(false);
    if (!stationId) return;
    this.checkinProvidersLoading.set(true);
    const plannedEnd = new Date(Date.now() + (Number(this.checkinDurationMinutes()) || 45) * 60000).toISOString();
    this.stationsApi.getProviderAvailability(stationId, plannedEnd).subscribe({
      next: (list) => {
        if (Number(this.checkinStationId()) !== stationId) return;
        this.checkinProvidersLoading.set(false);
        this.checkinProviderAvailability.set(list);
        const chosen = Number(this.checkinProviderId() || 0);
        if (chosen && !list.some((p) => p.provider_id === chosen && p.status === 'available')) this.checkinProviderId.set(null);
      },
      error: () => {
        if (Number(this.checkinStationId()) !== stationId) return;
        this.checkinProvidersLoading.set(false);
        this.checkinProviderAvailability.set([]);
      },
    });
  }

  readonly providerSelectorOptions = computed<SelectorOption[]>(() => {
    // Sin opción "Rotativo": el técnico es obligatorio en el check-in.
    const opts: SelectorOption[] = [];
    // Solo el personal de ESTA estación con horario que cubre este momento y libre
    // (sin otra atención ni reserva que se cruce); el backend lo vuelve a validar.
    for (const p of this.checkinProviderAvailability().filter((entry) => entry.status === 'available')) {
      opts.push({ value: p.provider_id, label: p.display_name });
    }
    return opts;
  });

  readonly catalogProductSelectorOptions = computed<SelectorOption[]>(() => {
    return this.allCatalogProducts().map((prod) => ({
      value: prod.id,
      label: `${prod.name} (${this.currencyService.format(Number(prod.base_price || 0))})`,
      description: prod.product_type === 'physical' ? 'Insumo / Repuesto físico' : 'Servicio / Mano de obra',
    }));
  });

  // Catalogs used by the check-in line picker
  readonly allCatalogProducts = signal<any[]>([]);
  readonly sellableCatalogProducts = signal<any[]>([]);

  // Config station state
  readonly selectedStation = signal<ServiceStation | null>(null);
  readonly selectedConfigTab = signal<'details' | 'intake' | 'schedule' | 'services' | 'providers'>('details');
  readonly editName = signal('');
  readonly editStationType = signal<StationType>('carro');
  readonly editCapacity = signal(1);
  readonly editTrackTime = signal(false);
  readonly editTargetMinutes = signal<number | null>(null);
  readonly serviceIds = signal<number[]>([]);
  readonly providerIds = signal<number[]>([]);

  // Computed KPIs (estilo restaurante mesas)
  readonly totalStations = computed(() => this.stations().length);

  readonly occupiedCount = computed(() =>
    this.activeSessions().filter((s) => s.status === 'open' || s.status === 'in_progress').length,
  );

  readonly pausedCount = computed(() =>
    this.activeSessions().filter((s) => s.status === 'paused').length,
  );

  readonly freeCount = computed(() =>
    Math.max(
      0,
      this.stations().filter((s) => s.status === 'active').length -
        this.occupiedCount() -
        this.pausedCount(),
    ),
  );

  readonly occupancyRate = computed(() => {
    const total = this.totalStations();
    if (!total) return 0;
    const busy = this.occupiedCount() + this.pausedCount();
    return Math.min(100, Math.round((busy / total) * 100));
  });

  readonly avgDurationMinutes = computed(() => {
    const sessions = this.activeSessions();
    if (!sessions.length) return 38;
    const totalMinutes = sessions.reduce((acc, s) => acc + this.sessionElapsedMinutes(s.opened_at), 0);
    return Math.max(1, Math.round(totalMinutes / sessions.length));
  });

  readonly totalActiveBudget = computed(() => {
    return this.activeSessions().reduce((acc, s) => {
      const orderTotal = s.order?.grand_total;
      if (orderTotal != null && !isNaN(Number(orderTotal))) return acc + Number(orderTotal);
      return acc + (Number(s.budget_amount) || 0);
    }, 0);
  });

  // Dynamic Categories based ONLY on stations that exist
  readonly existingStationTypes = computed<StationType[]>(() => {
    const set = new Set<StationType>();
    for (const st of this.stations()) {
      set.add(this.getStationType(st));
    }
    return Array.from(set);
  });

  readonly availableCategoryTabs = computed(() => {
    const existing = this.existingStationTypes();
    const tabs: Array<{ id: string; label: string; icon: string; count: number }> = [
      { id: 'all', label: `Todos (${this.stations().length})`, icon: 'warehouse', count: this.stations().length },
    ];
    for (const type of existing) {
      const meta = STATION_TYPES_META[type];
      const count = this.stations().filter((s) => this.getStationType(s) === type).length;
      tabs.push({
        id: type,
        label: `${meta.label} (${count})`,
        icon: meta.icon,
        count,
      });
    }
    return tabs;
  });

  // Displayed groups
  readonly displayedGroups = computed(() => {
    const selCat = this.selectedCategory();
    const statusFilter = this.selectedStatusFilter();
    const all = this.stations();
    const existing = this.existingStationTypes();
    const typesToRender = selCat === 'all' ? existing : [selCat as StationType];

    return typesToRender
      .filter((t) => existing.includes(t))
      .map((type) => {
        const meta = STATION_TYPES_META[type];
        let items = all.filter((st) => this.getStationType(st) === type);
        if (statusFilter !== 'all') {
          items = items.filter((st) => {
            const sess = this.stationSession(st.id);
            if (statusFilter === 'occupied') return sess && sess.status !== 'paused';
            if (statusFilter === 'paused') return sess && sess.status === 'paused';
            if (statusFilter === 'free') return st.status === 'active' && !sess;
            return true;
          });
        }
        const activeCount = items.filter((st) => {
          const sess = this.stationSession(st.id);
          return sess && sess.status !== 'paused';
        }).length;
        const freeCount = items.filter((st) => st.status === 'active' && !this.stationSession(st.id)).length;
        const pausedCount = items.filter((st) => {
          const sess = this.stationSession(st.id);
          return sess && sess.status === 'paused';
        }).length;

        return {
          ...meta,
          stations: items,
          activeCount,
          freeCount,
          pausedCount,
        };
      })
      .filter((group) => group.stations.length > 0 || selCat === group.id);
  });

  ngOnInit(): void {
    this.loadData();
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  loadData(): void {
    this.loadStations();
    this.loadActiveSessions();
    this.loadCatalogs();
  }

  loadStations(selectId?: number): void {
    this.loading.set(true);
    this.stationsApi.list(1, 100).subscribe({
      next: (response) => {
        const items = response.data ?? [];
        this.stations.set(items);
        this.loading.set(false);
        if (selectId) {
          const found = items.find((s) => s.id === selectId);
          if (found) this.selectStationForConfig(found);
        }
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.toastService.error(this.errorText(error, 'No fue posible cargar las estaciones.'));
      },
    });
  }

  loadActiveSessions(): void {
    this.http.get<any>(`${environment.apiUrl}/store/service-sessions`).subscribe({
      next: (r) => {
        const items = r?.data?.items ?? r?.data ?? [];
        this.activeSessions.set(Array.isArray(items) ? items : []);
      },
      error: () => {},
    });
  }

  loadCatalogs(): void {
    this.stationsApi.getServiceOptions().subscribe({
      next: (services) => this.services.set(services ?? []),
      error: () => {},
    });
    this.reservationsApi.getProviders().subscribe({
      next: (data) => {
        const list = data ?? [];
        this.providerRecords.set(list);
        this.providers.set(
          list.map((p) => ({
            id: p.id,
            display_name: p.display_name ?? (p as any).name ?? `Especialista #${p.id}`,
            is_active: Boolean(p.is_active),
          })),
        );
      },
      error: () => this.providerRecords.set([]),
    });
  }

  // Station Category / Type Classification
  getStationType(station: ServiceStation): StationType {
    if (station.station_type && STATION_TYPES_META[station.station_type]) {
      return station.station_type;
    }
    const combined = (
      station.name +
      ' ' +
      (station.services || []).map((s) => s.product?.name || '').join(' ')
    ).toLowerCase();
    if (/celular|smartphone|telefono|móvil|movil|pantalla|display|tablet|electr[oó]nic/i.test(combined)) return 'celular';
    if (/moto|box|rampa|dos ruedas/i.test(combined)) return 'moto';
    if (/belleza|spa|uña|manic|pedic|facial|cabina|color|estilismo/i.test(combined)) return 'salon_belleza';
    if (/barber|silla|barba|corte|fade|caballero/i.test(combined)) return 'barberia';
    if (/peluquer/i.test(combined)) return 'peluqueria';
    return 'carro';
  }

  getStationCategory(station: ServiceStation): string {
    return this.getStationType(station);
  }

  categoryCount(cat: string): number {
    if (cat === 'all') return this.stations().length;
    return this.stations().filter((st) => this.getStationType(st) === cat).length;
  }

  // Session & Live Timers Helpers
  stationSession(stationId: number): ServiceSessionRow | undefined {
    return this.activeSessions().find(
      (s) =>
        s.station_id === stationId &&
        (s.status === 'open' || s.status === 'in_progress' || s.status === 'paused'),
    );
  }

  /** Lleva al formulario del servicio, donde se elige su "Formulario de recepción". */
  openServiceIntakeConfig(): void {
    const productId = Number(this.checkinProductId() || 0);
    if (!productId) return;
    this.showCheckinModal.set(false);
    this.router.navigate(['/admin/products/edit', productId]);
  }

  /** "Yamaha NMAX · ABC123": las dos primeras respuestas de texto del formulario identifican lo atendido. */
  private intakeSubjectLabel(): string {
    const values = this.checkinIntakeValues();
    return this.checkinIntakeItems()
      .filter((item) => ['text', 'select'].includes(item.metadata_field.field_type))
      .map((item) => String(values[item.metadata_field.id] ?? '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ')
      .slice(0, 120);
  }

  /** Pestaña activa del módulo; se refleja en ?vista=registro para poder enlazarla. */
  readonly view = signal<'stations' | 'registry'>(
    new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('vista') === 'registro' ? 'registry' : 'stations',
  );

  readonly viewTabs: StickyHeaderTab[] = [
    { id: 'stations', label: 'Estaciones', icon: 'warehouse' },
    { id: 'registry', label: 'Registro de servicios', icon: 'history' },
  ];

  setView(view: 'stations' | 'registry'): void {
    this.view.set(view);
    this.router.navigate([], { queryParams: { vista: view === 'registry' ? 'registro' : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private loadIntakeTemplates(): void {
    this.templatesApi.getAll('active').subscribe({
      next: (templates) => this.intakeTemplates.set((templates ?? []).map((t) => ({ id: t.id, name: t.name, entity_type: t.entity_type, station_type: t.station_type }))),
      error: () => {}, // El selector queda solo con la opción "del servicio"
    });
  }

  saveStationIntakeTemplate(): void {
    const station = this.selectedStation();
    if (!station) return;
    this.runSave(
      this.stationsApi.update(station.id, { intake_template_id: Number(this.editIntakeTemplateId()) || null }),
      'Formulario de recepción guardado.',
      station.id,
    );
  }

  /**
   * Abre el editor de la plantilla de la estación en esta misma pestaña. Si la
   * estación aún no tiene plantilla, crea una vacía ("Atención de servicio") y la
   * deja ligada; el editor vuelve a Estaciones al guardar.
   */
  designStationTemplate(station: ServiceStation): void {
    const openEditor = (templateId: number) => {
      this.designingTemplate.set(false);
      this.showConfigModal.set(false);
      this.showCreateModal.set(false);
      this.router.navigate(['/admin/data-collection/templates', templateId, 'edit'], {
        queryParams: { returnTo: '/admin/services/stations' },
      });
    };
    const linked = Number(this.editIntakeTemplateId()) || station.intake_template_id;
    if (linked) {
      openEditor(linked);
      return;
    }
    this.designingTemplate.set(true);
    this.templatesApi
      .create({ name: `Plantilla ${station.name}`, entity_type: 'service_session', status: 'active', sections: [] })
      .subscribe({
        next: (template) => {
          this.stationsApi.update(station.id, { intake_template_id: template.id }).subscribe({
            next: () => openEditor(template.id),
            error: (error: unknown) => {
              this.designingTemplate.set(false);
              this.toastService.error(this.errorText(error, 'No fue posible ligar la plantilla a la estación.'));
            },
          });
        },
        error: (error: unknown) => {
          this.designingTemplate.set(false);
          this.toastService.error(this.errorText(error, 'No fue posible crear la plantilla de la estación.'));
        },
      });
  }

  /**
   * Botón del encabezado: crea una plantilla de estación vacía y abre su editor en
   * esta pestaña. Al guardar vuelve a Estaciones, donde ya se puede elegir al
   * crear una estación.
   */
  designNewStationTemplate(): void {
    this.showTemplateTypePicker.set(true);
  }

  /**
   * Crea la plantilla del tipo elegido ya con sus campos (reutiliza los que existan
   * por clave y entidad, crea los que falten) y abre el editor para ajustarla.
   */
  createTemplateForType(type: StationTemplateType): void {
    const meta = STATION_TEMPLATE_TYPES.find((t) => t.value === type)!;
    this.showTemplateTypePicker.set(false);
    this.designingTemplate.set(true);
    // Datos del cliente (sección editable) + los campos del tipo de estación.
    const customerKeys = DEFAULT_CUSTOMER_SECTION.keys;
    const presets = [...customerKeys, ...meta.keys].map((key) => SERVICE_FIELD_PRESETS[key]);
    this.fieldsApi
      .getFields()
      .pipe(
        switchMap((existing: MetadataField[]) =>
          presets.length
            ? forkJoin(
                presets.map((preset) => {
                  const entity_type = presetEntityType(preset, 'service_session');
                  const found = existing.find((f) => f.field_key === preset.field_key && f.entity_type === entity_type);
                  return found
                    ? of(found)
                    : this.fieldsApi.createField({
                        label: preset.label,
                        field_key: preset.field_key,
                        entity_type,
                        field_type: preset.field_type,
                        display_mode: 'detail',
                        is_required: false,
                        ...(preset.options ? { options: preset.options } : {}),
                      } as Partial<MetadataField>);
                }),
              )
            : of([] as MetadataField[]),
        ),
        switchMap((fields: MetadataField[]) =>
          this.templatesApi.create({
            name: `Plantilla ${meta.label}`,
            entity_type: 'service_session',
            station_type: type,
            // Guía en borrador: solo aparece al crear estaciones cuando el usuario la guarda.
            status: 'inactive',
            sections: [
              {
                title: DEFAULT_CUSTOMER_SECTION.title,
                sort_order: 0,
                items: fields.slice(0, customerKeys.length).map((field, index) => ({
                  metadata_field_id: field.id,
                  sort_order: index,
                  is_required: field.field_key === 'nombre_cliente',
                })),
              },
              {
                title: 'Datos de ingreso',
                sort_order: 1,
                items: fields.slice(customerKeys.length).map((field, index) => ({
                  metadata_field_id: field.id,
                  sort_order: index,
                  is_required: meta.required.includes(field.field_key),
                })),
              },
            ],
          }),
        ),
      )
      .subscribe({
        next: (template) => {
          this.designingTemplate.set(false);
          this.router.navigate(['/admin/data-collection/templates', template.id, 'edit'], {
            queryParams: { returnTo: '/admin/services/stations' },
          });
        },
        error: (error: unknown) => {
          this.designingTemplate.set(false);
          this.toastService.error(this.errorText(error, 'No fue posible crear la plantilla de estación.'));
          this.loadIntakeTemplates();
        },
      });
  }

  /** Nombre de la estación de una atención (el detalle completo no siempre lo trae). */
  stationNameOf(session: ServiceSessionRow): string {
    return session.station_name || this.stations().find((s) => s.id === session.station_id)?.name || 'Estación';
  }

  stationTracksTime(stationId: number): boolean {
    return !!this.stations().find((s) => s.id === stationId)?.track_time;
  }

  /** Vacío o inválido → null (la estación usa la duración de cada servicio). */
  private positiveMinutes(value: number | string | null): number | null {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 1440) : null;
  }

  sessionElapsedMinutes(openedAt: string): number {
    if (!openedAt) return 0;
    const diff = Math.max(0, this.now() - new Date(openedAt).getTime());
    return Math.floor(diff / 60000);
  }

  /** Planned end of the live session: the sessions list wins, the station summary is the fallback. */
  private sessionPlannedEnd(station: ServiceStation, session: ServiceSessionRow): string | null {
    return session.planned_end_at ?? station.active_session?.planned_end_at ?? null;
  }

  /** Live clock for an occupied station: elapsed up, countdown down, or "+HH:MM:SS" past the end. */
  stationClock(station: ServiceStation, session: ServiceSessionRow): StationClock | null {
    return computeStationClock(
      session.opened_at ?? station.active_session?.opened_at,
      this.sessionPlannedEnd(station, session),
      this.now(),
    );
  }

  /** "Próxima reserva 02:00" when the session is overtime or ends within 30 min of the next booking. */
  nextReservationChip(station: ServiceStation, session: ServiceSessionRow): string | null {
    const next = station.next_reservation ?? session.next_reservation ?? null;
    if (!next) return null;
    return shouldWarnNextReservation(this.sessionPlannedEnd(station, session), next, this.now())
      ? nextReservationLabel(next, this.timezone())
      : null;
  }

  stationTypeSubtitle(station: ServiceStation): string {
    const rule = stationRentalSummary(station, (amount) => this.currencyService.format(amount));
    const label = stationTypeLabel(this.getStationType(station));
    return rule ? `${label} · ${rule}` : label;
  }

  /** The account now lives in its own page; "Finalizar" lands there with the close flow open. */
  openSessionPage(session: ServiceSessionRow, startClose = false): void {
    void this.router.navigate(['/admin/services/stations/session', session.id], {
      queryParams: startClose ? { close: 1 } : undefined,
      // The tracking link only exists in memory right after check-in; hand it to the page.
      state: { accessUrl: this.lastAccessUrlBySession().get(session.id) ?? session.access_url ?? null },
    });
  }

  // Modal QR: Visualización, descarga e impresión del QR físico
  async openQrModal(station: ServiceStation): Promise<void> {
    this.qrStation.set(station);
    this.qrDataUrl.set(null);
    this.qrPublicUrl.set(null);
    this.qrError.set(null);
    this.qrNeedsDomain.set(false);
    this.qrLoading.set(true);
    this.showQrModal.set(true);

    try {
      const QRCode = await import('qrcode');
      const stationUrl = await firstValueFrom(this.stationsApi.getPublicUrl(station.id));
      this.qrPublicUrl.set(stationUrl);
      const dataUrl = await QRCode.toDataURL(stationUrl, {
        width: 480,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
      this.qrDataUrl.set(dataUrl);
    } catch (error) {
      const body = (error as { error?: { error_code?: string } } | null)?.error;
      this.qrNeedsDomain.set(body?.error_code === 'STATION_014');
      this.qrError.set(
        extractApiErrorMessage(error) || 'No se pudo generar el código QR de la estación.',
      );
    } finally {
      this.qrLoading.set(false);
    }
  }

  retryQr(): void {
    const station = this.qrStation();
    if (station) void this.openQrModal(station);
  }

  goToDomains(): void {
    this.showQrModal.set(false);
    void this.router.navigate(['/admin/settings/domains']);
  }

  async copyQrLink(): Promise<void> {
    const st = this.qrStation();
    if (!st) return;
    let url = this.qrPublicUrl();
    if (!url) {
      try { url = await firstValueFrom(this.stationsApi.getPublicUrl(st.id)); this.qrPublicUrl.set(url); }
      catch (error) { this.toastService.error(extractApiErrorMessage(error) || 'No se pudo resolver el dominio público de la tienda.'); return; }
    }
    if (!url) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.toastService.success('Enlace de la estación copiado al portapapeles.');
      }).catch(() => {
        this.toastService.info(`URL de estación: ${url}`);
      });
    } else {
      this.toastService.info(`URL de estación: ${url}`);
    }
  }

  downloadQrImage(): void {
    const dataUrl = this.qrDataUrl();
    const st = this.qrStation();
    if (!dataUrl || !st) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `QR-Estacion-${st.name.replace(/\s+/g, '_')}.png`;
    link.click();
    this.toastService.success('Imagen del código QR descargada.');
  }

  printQrCode(): void {
    const dataUrl = this.qrDataUrl();
    const st = this.qrStation();
    if (!dataUrl || !st) return;
    const meta = STATION_TYPES_META[this.getStationType(st)];
    // La ventana comparte origen con la app: todo texto del usuario va escapado.
    const name = escapeHtml(st.name);
    const label = escapeHtml(meta.singularLabel);
    const publicId = escapeHtml(st.public_id || `station-${st.id}`);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      this.toastService.error('Permite las ventanas emergentes para imprimir el código QR.');
      return;
    }

    printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>QR - ${name}</title>
  <style>
    @page { size: auto; margin: 15mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 30px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #0f172a;
      background: #ffffff;
    }
    .card {
      border: 3px solid #0f172a;
      border-radius: 28px;
      padding: 36px 44px;
      text-align: center;
      max-width: 440px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.06);
    }
    .badge {
      display: inline-block;
      padding: 6px 18px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #334155;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 6px 0;
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    p.subtitle {
      margin: 0 0 24px 0;
      color: #64748b;
      font-size: 14px;
      font-weight: 500;
    }
    img.qr {
      width: 270px;
      height: 270px;
      margin-bottom: 20px;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      padding: 10px;
      background: #ffffff;
    }
    .instruction {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 6px;
    }
    .token {
      font-family: monospace;
      font-size: 11px;
      color: #64748b;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${label}</div>
    <h1>${name}</h1>
    <p class="subtitle">Estación de Servicio • Vendix</p>
    <img src="${dataUrl}" class="qr" alt="QR ${name}" />
    <div class="instruction">Escanea para consultar estado o autoservicio</div>
    <div class="token">ID: ${publicId}</div>
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 250);
    };
  </script>
</body>
</html>`);
    printWindow.document.close();
  }

  // Modal 1: Create Station con Tipo de Estación
  openCreateModal(): void {
    this.newName.set('');
    this.newStationType.set('');
    this.newTrackTime.set(false);
    this.newTargetMinutes.set(null);
    this.newIntakeTemplateId.set(0);
    this.newTaxCategoryId.set(null);
    this.newTaxIsInclusive.set(true);
    this.newRules.set(DEFAULT_STATION_RULES);
    this.newRental.set(DEFAULT_RENTAL_RULES);
    this.loadIntakeTemplates();
    this.loadTaxOptions();
    this.showCreateModal.set(true);
  }

  loadTaxOptions(): void {
    if (this.taxOptions() || this.loadingTaxOptions()) return;
    this.loadingTaxOptions.set(true);
    this.taxOptionsError.set(null);
    this.shippingService
      .getRateTaxOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.taxOptions.set(options);
          this.loadingTaxOptions.set(false);
        },
        error: () => {
          this.taxOptionsError.set('No se pudieron cargar los impuestos. Puedes guardar la estación sin impuesto.');
          this.loadingTaxOptions.set(false);
        },
      });
  }

  /** «Sin impuesto» + categorías del catálogo; conserva visible la categoría guardada aunque ya no esté. */
  private buildTaxSelectorOptions(currentId: number | null): SelectorOption[] {
    // `SelectorOption.value` no admite null en su tipo; el selector compara por identidad.
    const options: SelectorOption[] = [{ value: null as unknown as number, label: 'Sin impuesto' }];
    const categories = this.taxOptions()?.categories ?? [];
    for (const c of categories) {
      const taxLabel = this.shippingService.getRateTaxLabel(c);
      const base = taxLabel ? `${c.name} (${taxLabel})` : c.name;
      options.push({
        value: c.id,
        label: c.eligible ? base : `${base} — ${c.reason || 'No disponible'}`,
        disabled: !c.eligible,
        description: c.eligible ? undefined : c.reason,
      });
    }
    if (currentId && !categories.some((c) => c.id === currentId)) {
      options.push({ value: currentId, label: `Impuesto #${currentId}` });
    }
    return options;
  }

  /** En una estación nueva el modo se preselecciona desde la categoría (`is_inclusive`). */
  onNewTaxCategoryChange(value: unknown): void {
    const id = toTaxCategoryId(value);
    this.newTaxCategoryId.set(id);
    const hint = this.taxOptions()?.categories.find((c) => c.id === id)?.is_inclusive;
    if (typeof hint === 'boolean') this.newTaxIsInclusive.set(hint);
  }

  onEditTaxCategoryChange(value: unknown): void {
    this.editTaxCategoryId.set(toTaxCategoryId(value));
  }

  createStation(): void {
    const name = this.newName().trim();
    if (!name) {
      this.toastService.error('El nombre de la estación es obligatorio.');
      return;
    }
    const templateId = Number(this.newIntakeTemplateId()) || 0;
    if (!templateId) {
      this.toastService.error('Elige la plantilla de la estación (o diséñala con el botón de arriba).');
      return;
    }
    const rulesError = stationRulesError(this.newRules()) ?? stationRentalError(this.newRental());
    if (rulesError) {
      this.toastService.error(rulesError);
      return;
    }
    this.saving.set(true);
    this.stationsApi.create({
      name,
      capacity: 1,
      // Sin tipo elegido, el backend usa el de su plantilla (carro, moto, barbería…).
      ...(this.newStationType() ? { station_type: this.newStationType() as StationType } : {}),
      track_time: this.newTrackTime(),
      target_minutes: this.newTrackTime() ? this.positiveMinutes(this.newTargetMinutes()) : null,
      intake_template_id: templateId,
      rental_tax_category_id: this.newTaxCategoryId(),
      rental_tax_is_inclusive: this.newTaxIsInclusive(),
      ...stationRulesPayload(this.newRules()),
      ...stationRentalPayload(this.newRental()),
    }).subscribe({
      next: (station) => {
        this.saving.set(false);
        this.showCreateModal.set(false);
        this.toastService.success('Estación creada con éxito.');
        this.loadStations(station.id);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toastService.error(this.errorText(error, 'No fue posible crear la estación.'));
      },
    });
  }

  // Helper methods to read customer and vehicle metadata
  getCustomerName(session: ServiceSessionRow): string {
    const meta = session.subject?.metadata as Record<string, any> | undefined;
    if (meta && meta['customer_name']) return String(meta['customer_name']);
    return session.subject?.label || 'Cliente General';
  }

  getVehicleName(session: ServiceSessionRow): string | null {
    const meta = session.subject?.metadata as Record<string, any> | undefined;
    if (meta && meta['vehicle_name']) return String(meta['vehicle_name']);
    if (session.subject?.label && session.subject.label.includes(' - ')) {
      return session.subject.label.split(' - ')[0].trim();
    }
    return null;
  }

  getCustomerPlate(session: ServiceSessionRow): string | null {
    const meta = session.subject?.metadata as Record<string, any> | undefined;
    if (meta && meta['plate']) return String(meta['plate']);
    if (session.subject?.label && session.subject.label.includes(' - ')) {
      const parts = session.subject.label.split(' - ');
      const candidate = parts[parts.length - 1].trim();
      if (/^[A-Z0-9-]{4,8}$/i.test(candidate)) return candidate.toUpperCase();
    }
    return null;
  }

  getCustomerPhone(session: ServiceSessionRow): string | null {
    const meta = session.subject?.metadata as Record<string, any> | undefined;
    return meta && meta['customer_phone'] ? String(meta['customer_phone']) : null;
  }

  getCustomerDoc(session: ServiceSessionRow): string | null {
    const meta = session.subject?.metadata as Record<string, any> | undefined;
    return meta && meta['customer_document'] ? String(meta['customer_document']) : null;
  }

  // Modal 2: Check-in / Nuevo Ingreso
  openCheckinModal(station?: ServiceStation): void {
    this.checkinStationLocked.set(!!station);
    let target: ServiceStation | null = station ?? null;
    if (!target) {
      const freeStation = this.stations().find((s) => s.status === 'active' && !this.stationSession(s.id));
      target = freeStation || this.stations()[0] || null;
    }
    this.checkinStationId.set(target ? target.id : null);
    this.loadCheckinProviderAvailability();
    this.checkinVehicleName.set('');
    this.checkinPlate.set('');
    this.checkinMileage.set('');
    this.checkinDeviceModel.set('');
    this.checkinImei.set('');
    this.checkinReportedIssue.set('');
    this.checkinUnlockCode.set('');
    this.checkinAccessories.set('');
    this.checkinStylePreference.set('');
    this.checkinAllergies.set('');
    this.checkinCustomer.set(null);
    this.checkinCustomerName.set('');
    this.checkinCustomerDoc.set('');
    this.checkinCustomerPhone.set('');
    this.checkinCustomerEmail.set('');
    this.checkinProductId.set(this.defaultCheckinServiceId(target));
    this.resetCheckinIntake();
    this.checkinProviderId.set(null);
    this.checkinProviderError.set(false);
    this.checkinDurationMinutes.set(this.defaultCheckinDuration());
    this.checkinNotes.set('');

    // Limpiar campos de presupuesto e insumos iniciales
    this.checkinBudgetAmount.set(null);
    this.checkinLines.set([]);
    this.checkinDeposit.set(null);

    // Asegurar carga de catálogo de productos para el selector de insumos
    // Catálogo vendible con variantes para las líneas de "Agregar producto"
    if (!this.sellableCatalogProducts().length) {
      this.stationsApi.getSellableProducts().subscribe({
        next: (prods) => this.sellableCatalogProducts.set(prods || []),
        error: () => {},
      });
    }

    this.showCheckinModal.set(true);
  }

  onCheckinStationChange(stationId: number | string): void {
    this.checkinStationId.set(Number(stationId));
    this.checkinProviderId.set(null); // el técnico elegido puede no estar asignado a la nueva estación
    this.checkinProviderError.set(false);
    this.loadCheckinProviderAvailability();
    this.checkinProductId.set(this.defaultCheckinServiceId(this.selectedCheckinStation()));
    this.checkinDurationMinutes.set(this.defaultCheckinDuration());
    this.resetCheckinIntake();
  }

  /** Minutos objetivo de la estación; si no tiene, la duración del servicio elegido; si no, 45. */
  private defaultCheckinDuration(): number {
    const station = this.selectedCheckinStation();
    if (station?.target_minutes) return station.target_minutes;
    const productId = Number(this.checkinProductId() || 0);
    const service = station?.services?.find((s) => s.product_id === productId)?.product;
    return service?.service_duration_minutes || 45;
  }

  onCheckinServiceChange(productId: number | string): void {
    const next = Number(productId) || 0;
    const changed = next !== Number(this.checkinProductId() || 0);
    this.checkinProductId.set(next);
    if (changed) {
      this.checkinDurationMinutes.set(this.defaultCheckinDuration());
      // Con plantilla de estación el formulario no cambia con el servicio: no se
      // recarga para no borrar lo que ya se escribió.
      if (!this.selectedCheckinStation()?.intake_template_id) this.resetCheckinIntake();
    }
  }

  /**
   * Cliente registrado (opcional) elegido o creado en el selector. Completa los
   * datos de contacto del check-in (siguen editables) y prellena los campos de
   * tipo Cliente del formulario de recepción desde su perfil.
   */
  onCheckinCustomerChange(customer: CustomerSelectOption | null): void {
    this.checkinCustomer.set(customer);
    if (!customer) return;
    this.fillTemplateCustomerFields(customer);
    const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || customer.name;
    this.checkinCustomerName.set(fullName);
    if (customer.document_number) this.checkinCustomerDoc.set(customer.document_number);
    if (customer.phone) this.checkinCustomerPhone.set(customer.phone);
    if (customer.email) this.checkinCustomerEmail.set(customer.email);
  }

  /**
   * Reinicia el formulario de recepción: `app-session-intake-form` vuelve a cargar
   * la plantilla de la estación (o, sin ella, la del servicio) con sus entradas.
   */
  private resetCheckinIntake(): void {
    this.checkinIntakeTemplate.set(null);
    this.checkinIntakeValues.set({});
    this.checkinIntakeLoading.set(!!(this.checkinIntakeProductId() || Number(this.checkinStationId() || 0)));
  }

  private defaultCheckinServiceId(station: ServiceStation | null): number {
    // Con un único servicio se preselecciona; con varios se elige a mano (es obligatorio).
    const linked = station?.services?.map((s) => s.product_id) ?? [];
    const active = linked.filter((id) => this.services().some((s) => s.id === id && (!s.state || s.state === 'active')));
    return active.length === 1 ? active[0] : 0;
  }

  readonly checkinProductOptions = computed<SelectorOption[]>(() =>
    this.sellableCatalogProducts()
      .filter((prod) => prod.is_ingredient !== true && prod.is_sellable !== false && prod.product_type !== 'service')
      .map((prod) => ({ value: prod.id, label: prod.name })),
  );

  checkinLineVariantOptions(productId: number | null): SelectorOption[] {
    if (!productId) return [];
    const product = this.sellableCatalogProducts().find((p) => p.id === productId);
    return (product?.product_variants ?? []).map((v: any) => ({ value: v.id, label: v.name || v.sku }));
  }

  addCheckinLine(): void {
    this.checkinLines.update((lines) => [
      ...lines,
      { key: ++this.checkinLineSeq, product_id: null, product_variant_id: null, quantity: 1, unit_price: null, price_edited: false },
    ]);
  }

  removeCheckinLine(key: number): void {
    this.checkinLines.update((lines) => lines.filter((line) => line.key !== key));
  }

  updateCheckinLine(key: number, patch: Partial<CheckinLine>): void {
    this.checkinLines.update((lines) =>
      lines.map((line) =>
        line.key === key
          ? { ...line, ...patch, ...('unit_price' in patch ? { price_edited: true } : {}) }
          : line,
      ),
    );
  }

  onCheckinLineProduct(key: number, productId: number | string | null): void {
    const id = Number(productId) || null;
    const product = this.sellableCatalogProducts().find((p) => p.id === id);
    this.checkinLines.update((lines) =>
      lines.map((line) =>
        line.key === key
          ? { ...line, product_id: id, product_variant_id: null, unit_price: product ? this.publishedPrice(product) : null, price_edited: false }
          : line,
      ),
    );
  }

  onCheckinLineVariant(key: number, variantId: number | string | null): void {
    const vid = Number(variantId) || null;
    this.checkinLines.update((lines) =>
      lines.map((line) => {
        if (line.key !== key) return line;
        const product = this.sellableCatalogProducts().find((p) => p.id === line.product_id);
        const variant = product?.product_variants?.find((v: any) => v.id === vid);
        return { ...line, product_variant_id: vid, unit_price: this.publishedPrice(product, variant), price_edited: false };
      }),
    );
  }

  /** Precio publicado (antes del IVA adicional), misma escalera que el backend. */
  private publishedPrice(product: any, variant?: any): number {
    if (variant?.is_on_sale && Number(variant.sale_price) > 0) return Number(variant.sale_price);
    if (Number(variant?.price_override) > 0) return Number(variant.price_override);
    if (product?.is_on_sale && Number(product.sale_price) > 0) return Number(product.sale_price);
    return Number(product?.base_price || 0);
  }

  /** Estimado con IVA: `final_price` del catálogo ya trae el impuesto resuelto por el backend. */
  private checkinLineEstimate(line: CheckinLine): number {
    if (!line.product_id) return 0;
    const product = this.sellableCatalogProducts().find((p) => p.id === line.product_id);
    const variant = product?.product_variants?.find((v: any) => v.id === line.product_variant_id);
    const published = this.publishedPrice(product, variant);
    const finalPrice = Number(variant?.final_price ?? product?.final_price ?? published);
    const taxFactor = published > 0 ? finalPrice / published : 1;
    const unit = line.price_edited ? Number(line.unit_price ?? 0) * taxFactor : finalPrice;
    return Math.max(1, Number(line.quantity || 1)) * Math.max(0, unit);
  }

  /** Campos de cliente de la plantilla (por clave) que reemplazan al bloque fijo. */
  private readonly templateCustomerFieldIds = computed(() => {
    const ids: Record<string, number> = {};
    for (const item of this.checkinIntakeItems()) {
      const field = item.metadata_field;
      if (field.entity_type === 'customer' && ['nombre_cliente', 'numero_documento', 'telefono', 'correo'].includes(field.field_key)) {
        ids[field.field_key] = field.id;
      }
    }
    return ids;
  });

  readonly templateHandlesCustomer = computed(() => !!this.templateCustomerFieldIds()['nombre_cliente']);

  /** Bloques fijos visibles según la plantilla (sin plantilla u opciones = visibles). */
  readonly checkinShowBudget = computed(() => this.checkinIntakeTemplate()?.checkin_show_budget ?? true);
  readonly checkinShowProducts = computed(() => this.checkinIntakeTemplate()?.checkin_show_products ?? true);
  readonly checkinShowNotes = computed(() => this.checkinIntakeTemplate()?.checkin_show_notes ?? true);

  /** Lleva lo escrito en "Datos del cliente" de la plantilla a los datos de contacto de la atención. */
  private syncCustomerFromTemplate(): void {
    if (!this.templateHasCustomerFields()) return;
    const ids = this.templateCustomerFieldIds();
    const values = this.checkinIntakeValues();
    const read = (key: string) => String(values[ids[key]] ?? '').trim();
    if (read('nombre_cliente')) this.checkinCustomerName.set(read('nombre_cliente'));
    if (read('numero_documento')) this.checkinCustomerDoc.set(read('numero_documento'));
    if (read('telefono')) this.checkinCustomerPhone.set(read('telefono'));
    if (read('correo')) this.checkinCustomerEmail.set(read('correo'));
  }

  /** Cliente elegido en el buscador → llena la sección de cliente de la plantilla si está vacía. */
  private fillTemplateCustomerFields(customer: CustomerSelectOption): void {
    const ids = this.templateCustomerFieldIds();
    const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || customer.name;
    const fill: Record<string, unknown> = {
      nombre_cliente: fullName,
      numero_documento: customer.document_number,
      telefono: customer.phone,
      correo: customer.email,
    };
    this.checkinIntakeValues.update((values) => {
      const next = { ...values };
      for (const [key, value] of Object.entries(fill)) {
        const id = ids[key];
        if (!id || value == null || value === '') continue;
        if (next[id] === undefined || next[id] === null || next[id] === '') next[id] = value;
      }
      return next;
    });
  }

  submitCheckin(): void {
    const stationId = this.checkinStationId();
    this.syncCustomerFromTemplate();
    const customerName = this.checkinCustomerName().trim();
    if (!stationId) {
      this.toastService.error('Debes seleccionar una estación libre.');
      return;
    }
    if (!customerName) {
      this.toastService.error('El nombre del cliente es obligatorio.');
      return;
    }

    const station = this.stations().find((s) => s.id === stationId);
    const stationType = station ? this.getStationType(station) : 'carro';
    const requiresVehicle = stationType === 'carro' || stationType === 'moto';
    const isCelular = stationType === 'celular';
    const isBeauty = stationType === 'peluqueria' || stationType === 'barberia' || stationType === 'salon_belleza';

    const vehicleName = this.checkinVehicleName().trim();
    const plate = this.checkinPlate().trim().toUpperCase();
    const mileage = this.checkinMileage().trim();

    const deviceModel = this.checkinDeviceModel().trim();
    const imei = this.checkinImei().trim();
    const reportedIssue = this.checkinReportedIssue().trim();
    const unlockCode = this.checkinUnlockCode().trim();
    const accessories = this.checkinAccessories().trim();

    const stylePreference = this.checkinStylePreference().trim();
    const allergies = this.checkinAllergies().trim();

    // Con formulario de recepción, los datos los define el formulario y no los campos fijos.
    const usesIntakeForm = !!this.checkinIntakeTemplate();
    if (usesIntakeForm) {
      // Validado más abajo contra los campos obligatorios del formulario.
    } else if (requiresVehicle) {
      if (!vehicleName) {
        this.toastService.error(
          stationType === 'moto'
            ? 'Debes ingresar el nombre o modelo de la moto (ej. Yamaha NMAX).'
            : 'Debes ingresar el nombre o modelo del carro (ej. Toyota Hilux).',
        );
        return;
      }
      if (!plate) {
        this.toastService.error('La placa del vehículo es obligatoria.');
        return;
      }
    } else if (isCelular) {
      if (!deviceModel) {
        this.toastService.error('Debes ingresar la marca y modelo del equipo (ej. iPhone 13, Samsung S21).');
        return;
      }
      if (!reportedIssue) {
        this.toastService.error('Debes ingresar la falla reportada del equipo.');
        return;
      }
    }

    const selectedServiceId = Number(this.checkinProductId() || 0);
    if (!this.serviceSelectorOptions().length) {
      this.toastService.error('Esta estación no tiene servicios activos. Asígnalos en Configurar estación → Servicios.');
      return;
    }
    if (!selectedServiceId || !this.serviceSelectorOptions().some((o) => Number(o.value) === selectedServiceId)) {
      this.toastService.error('Selecciona el servicio de la atención.');
      return;
    }
    if (this.checkinProvidersLoading()) {
      this.toastService.error('Espera a que cargue el personal de la estación.');
      return;
    }
    if (this.checkinNeedsProvider() && !this.checkinProviderId()) {
      this.checkinProviderError.set(true);
      this.toastService.error('Seleccione una persona de servicio.');
      return;
    }
    this.checkinProviderError.set(false);
    if (this.checkinIntakeLoading()) {
      this.toastService.error('Espera a que cargue el formulario de recepción del servicio.');
      return;
    }
    const intakeValues = buildIntakeEntries(this.checkinIntakeItems(), this.checkinIntakeValues());
    const [missingIntakeItem] = missingRequiredIntakeItems(this.checkinIntakeItems(), this.checkinIntakeValues());
    if (missingIntakeItem) {
      this.toastService.error(`Completa el campo obligatorio "${missingIntakeItem.metadata_field.label}".`);
      return;
    }

    this.saving.set(true);
    const duration = this.checkinDurationMinutes() || 45;
    const plannedEnd = new Date(Date.now() + duration * 60000).toISOString();

    const doc = this.checkinCustomerDoc().trim();
    const phone = this.checkinCustomerPhone().trim();
    const email = this.checkinCustomerEmail().trim();
    const notes = this.checkinShowNotes() ? this.checkinNotes().trim() : '';

    // Spec: Label del subject: vehículo "<modelo> - <placa>", celular "<modelo equipo>", persona: nombre del cliente
    let label = customerName;
    if (usesIntakeForm) {
      label = this.intakeSubjectLabel() || customerName;
    } else if (requiresVehicle) {
      label = `${vehicleName} - ${plate}`;
    } else if (isCelular) {
      label = deviceModel;
    }

    // Spec: CORRIGE BUG: ServiceSubjectDto.subject_type solo acepta 'vehicle' | 'person' | 'other'
    // Con plantilla, lo atendido sale de sus respuestas (placa, equipo…): 'other' lo
    // deja visible en el seguimiento; 'person' lo ocultaría por ser el nombre del cliente.
    const subjectType: 'vehicle' | 'person' | 'other' = usesIntakeForm && label !== customerName
      ? 'other'
      : requiresVehicle
      ? 'vehicle'
      : isCelular
        ? 'other'
        : 'person';

    const metadata: Record<string, unknown> = {
      customer_name: customerName,
      ...(doc ? { customer_document: doc } : {}),
      ...(phone ? { customer_phone: phone } : {}),
      ...(email ? { customer_email: email } : {}),
      station_type: stationType,
      ...(notes ? { notes } : {}),
    };

    if (requiresVehicle) {
      metadata['vehicle_name'] = vehicleName;
      metadata['plate'] = plate;
      if (mileage) metadata['mileage'] = mileage;
    } else if (isCelular) {
      metadata['device_model'] = deviceModel;
      metadata['reported_issue'] = reportedIssue;
      if (imei) metadata['imei'] = imei;
      if (unlockCode) metadata['unlock_code'] = unlockCode;
      if (accessories) metadata['accessories'] = accessories;
    } else if (isBeauty) {
      if (stylePreference) metadata['style_preference'] = stylePreference;
      if (allergies) metadata['allergies'] = allergies;
    }

    // Fallback de servicio para que nunca falle la apertura walk-in
    const productId = selectedServiceId;

    const payload: any = {
      station_id: Number(stationId),
      ...(productId ? { product_id: productId } : {}),
      provider_id: this.checkinProviderId() ? Number(this.checkinProviderId()) : undefined,
      planned_end_at: plannedEnd,
      contact_email: email || undefined,
      ...(this.checkinCustomer()?.id ? { customer_id: this.checkinCustomer()!.id } : {}),
      ...(intakeValues.length ? { intake_values: intakeValues } : {}),
      subject: {
        subject_type: subjectType,
        label,
        metadata,
      },
    };

    // Anticipo (S4): solo viaja si la estación lo pide y el cajero registró monto y medio.
    const deposit = station && station.deposit_policy && station.deposit_policy !== 'none' ? this.checkinDeposit() : null;
    const depositError =
      openCustomerError(this.checkinAllowsAnonymous(), this.checkinCustomer()?.id) ??
      openDepositError(station, this.checkinCustomer()?.id, deposit);
    if (depositError) {
      this.saving.set(false);
      this.toastService.error(depositError);
      return;
    }
    if (deposit) payload.deposit = deposit;

    const budgetVal = this.checkinShowBudget() ? this.checkinBudgetAmount() : null;
    const initialLines = (this.checkinShowProducts() ? this.checkinLines() : [])
      .filter((line) => line.product_id)
      .map((line) => ({
        product_id: line.product_id!,
        ...(line.product_variant_id ? { product_variant_id: line.product_variant_id } : {}),
        quantity: Math.max(1, Number(line.quantity || 1)),
        // Sin editar, la cuenta toma el precio de catálogo (con oferta/variante).
        ...(line.price_edited && line.unit_price != null ? { unit_price: Number(line.unit_price) } : {}),
      }));

    this.http.post<any>(`${environment.apiUrl}/store/service-sessions`, payload).subscribe({
      next: (res) => {
        const newSessionId = res?.data?.id || res?.id;
        const accessUrl = res?.data?.access_url ?? res?.access_url ?? null;
        if (newSessionId && accessUrl) {
          this.lastAccessUrlBySession.update((map) => new Map(map).set(newSessionId, accessUrl));
        }

        if (newSessionId) {
          // 1. Guardar presupuesto inicial opcional para TODOS los tipos
          if (budgetVal != null && Number(budgetVal) > 0) {
            this.stationsApi.setBudget(newSessionId, Number(budgetVal), this.currencyService.currencyCode() || 'COP').subscribe({
              error: (error: unknown) =>
                this.toastService.warning(
                  this.errorText(error, 'La atención se abrió, pero no se pudo guardar el presupuesto. Ajústalo desde "Ver Cuenta".'),
                  undefined,
                  6000,
                ),
            });
          }
          // 2. Productos del ingreso: todos en una sola transacción
          if (initialLines.length) {
            this.stationsApi.addItemsBulk(newSessionId, initialLines).subscribe({
              next: () => this.loadActiveSessions(),
              error: (error: unknown) =>
                this.toastService.warning(
                  this.errorText(error, 'La atención se abrió, pero no se pudieron agregar los productos. Agrégalos desde "Ver Cuenta".'),
                  undefined,
                  6000,
                ),
            });
          }
        }

        this.saving.set(false);
        this.showCheckinModal.set(false);
        this.toastService.success(
          usesIntakeForm
            ? `Ingreso de ${label} registrado con éxito.`
            : requiresVehicle
            ? `Ingreso de ${vehicleName} (${plate}) registrado con éxito.`
            : isCelular
              ? `Ingreso de ${deviceModel} (${customerName}) registrado con éxito.`
              : `Atención de ${customerName} iniciada con éxito.`,
        );
        this.loadActiveSessions();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toastService.error(this.errorText(error, 'No fue posible registrar el ingreso.'));
      },
    });
  }

  /** Resumes a paused session from the card; the rest of the account lives in the session page. */
  resumeSession(session: ServiceSessionRow): void {
    this.saving.set(true);
    this.stationsApi.pauseResumeSession(session.id, 'resume').subscribe({
      next: () => {
        this.saving.set(false);
        this.loadActiveSessions();
        this.toastService.success('Atención reanudada.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toastService.error(this.errorText(error, 'No fue posible actualizar el estado de la atención.'));
      },
    });
  }

  // Modal 4: Configure Station (Compatibility, Providers, QR)
  selectStationForConfig(station: ServiceStation): void {
    this.selectedStation.set(station);
    this.editName.set(station.name);
    this.editStationType.set(this.getStationType(station));
    this.editCapacity.set(1);
    this.editTrackTime.set(!!station.track_time);
    this.editTargetMinutes.set(station.target_minutes ?? null);
    this.editIntakeTemplateId.set(station.intake_template_id ?? 0);
    this.editTaxCategoryId.set(station.rental_tax_category_id ?? null);
    this.editTaxIsInclusive.set(station.rental_tax_is_inclusive !== false);
    this.editRules.set(stationRulesFrom(station));
    this.editRental.set(stationRentalFrom(station));
    this.loadIntakeTemplates();
    this.loadTaxOptions();
    this.selectedConfigTab.set('details');
    this.serviceIds.set(station.services?.map((s) => s.product_id) ?? []);
    this.providerIds.set(station.providers?.map((p) => p.provider_id) ?? []);
    this.showConfigModal.set(true);
  }

  saveStationDetails(): void {
    const station = this.selectedStation();
    if (!station) return;
    const name = this.editName().trim();
    if (!name) {
      this.toastService.error('El nombre es obligatorio.');
      return;
    }
    const rulesError = stationRulesError(this.editRules()) ?? stationRentalError(this.editRental());
    if (rulesError) {
      this.toastService.error(rulesError);
      return;
    }
    this.runSave(
      this.stationsApi.update(station.id, {
        name,
        capacity: 1,
        // Only sent when the person changed it, so older stations keep their derived type.
        ...(this.editStationType() !== this.getStationType(station) ? { station_type: this.editStationType() } : {}),
        track_time: this.editTrackTime(),
        target_minutes: this.editTrackTime() ? this.positiveMinutes(this.editTargetMinutes()) : null,
        rental_tax_category_id: this.editTaxCategoryId(),
        rental_tax_is_inclusive: this.editTaxIsInclusive(),
        ...stationRulesPayload(this.editRules()),
        ...stationRentalPayload(this.editRental()),
      }),
      'Datos guardados.',
      station.id,
    );
  }

  toggleStationStatus(): void {
    const station = this.selectedStation();
    if (!station) return;
    if (station.status !== 'active') {
      this.runSave(this.stationsApi.update(station.id, { status: 'active' }), 'Estación activada.', station.id);
      return;
    }
    const hasOpen = this.activeSessions().some(
      (s) => s.station_id === station.id && (s.status === 'open' || s.status === 'in_progress' || s.status === 'paused'),
    );
    if (hasOpen) {
      this.toastService.warning('Esta estación tiene una atención abierta. Ciérrala antes de desactivar.');
      return;
    }
    this.showDeactivateConfirm.set(true);
  }

  confirmDeactivateStation(): void {
    const station = this.selectedStation();
    this.showDeactivateConfirm.set(false);
    if (!station) return;
    this.runSave(this.stationsApi.deactivate(station.id), 'Estación desactivada.', station.id);
  }

  askDeleteStation(): void {
    const station = this.selectedStation();
    if (!station) return;
    const hasOpen = this.activeSessions().some(
      (s) => s.station_id === station.id && (s.status === 'open' || s.status === 'in_progress' || s.status === 'paused'),
    );
    if (hasOpen) {
      this.toastService.warning('Esta estación tiene una atención abierta. Ciérrala antes de eliminar.');
      return;
    }
    this.showDeleteConfirm.set(true);
  }

  confirmDeleteStation(): void {
    const station = this.selectedStation();
    this.showDeleteConfirm.set(false);
    if (!station) return;
    this.saving.set(true);
    this.stationsApi.deleteStation(station.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.showConfigModal.set(false);
        this.selectedStation.set(null);
        this.toastService.success('Estación eliminada.');
        this.loadStations();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toastService.error(this.errorText(error, 'No fue posible eliminar la estación.'));
      },
    });
  }

  toggleService(id: number): void {
    this.serviceIds.update((ids) => (ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]));
  }

  toggleProvider(id: number): void {
    this.providerIds.update((ids) => (ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]));
  }

  providerSupportsSelectedServices(provider: StationProviderOption): boolean {
    const item = this.reservationsApiProvider(provider.id);
    const selected = this.serviceIds();
    return selected.length > 0 && (item?.services ?? []).some((s) => selected.includes(s.product_id));
  }

  private reservationsApiProvider(id: number): ServiceProvider | undefined {
    return this.providerRecords().find((p) => p.id === id);
  }

  saveServices(): void {
    const station = this.selectedStation();
    if (!station) return;
    this.runSave(this.stationsApi.setServices(station.id, this.serviceIds()), 'Servicios guardados.', station.id);
  }

  saveProviders(): void {
    const station = this.selectedStation();
    if (!station) return;
    this.runSave(this.stationsApi.setProviders(station.id, this.providerIds()), 'Proveedores guardados.', station.id);
  }

  private runSave<T>(request: import('rxjs').Observable<T>, message: string, stationId: number): void {
    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.toastService.success(message);
        this.loadStations(stationId);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.toastService.error(this.errorText(error, 'No fue posible guardar los cambios.'));
      },
    });
  }

  private errorText(error: unknown, fallback: string): string {
    if (typeof error === 'string' && error.trim()) return error;
    return extractApiErrorMessage(error) || fallback;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
