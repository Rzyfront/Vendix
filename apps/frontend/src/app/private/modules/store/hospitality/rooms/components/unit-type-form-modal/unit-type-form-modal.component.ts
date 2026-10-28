import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, startWith } from 'rxjs/operators';
import { forkJoin, of } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  ImageSourceModalComponent,
  InputComponent,
  ModalComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { ImageUploadService } from '../../../../../../../shared/services/image-upload.service';
import { dataUrlToFile } from '../../../../../../../shared/utils/data-url.util';
import { TaxesService } from '../../../../products/services/taxes.service';
import {
  LodgingAmenity,
  UnitType,
  UnitTypePayload,
} from '../../interfaces/unit-type.interface';
import { UnitTypesService } from '../../services/unit-types.service';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';

/** H1.6 — only this permission (or the owner) changes the overbooking. */
const OVERBOOKING_PERMISSION = 'store:lodging:rates:write';

export const MAX_CAPACITY_MESSAGE =
  'La capacidad máxima debe ser mayor que cero';

const NO_TAX = 0;

/** Same cap as the backend DTO (`MAX_UNIT_TYPE_IMAGES`). */
const MAX_PHOTOS = 20;

type FormTab = 'data' | 'photos' | 'amenities';

/** A photo: the S3 key is saved, the signed URL is only for preview. */
interface Photo {
  key: string;
  url: string;
}

interface UnitTypeForm {
  name: FormControl<string>;
  base_occupancy: FormControl<number | null>;
  max_adults: FormControl<number | null>;
  max_children: FormControl<number | null>;
  bed_config: FormControl<string>;
  base_price: FormControl<number | null>;
  tax_category_id: FormControl<number>;
  overbooking_allowance: FormControl<number | null>;
}

/**
 * Hospitality Suite (H0.2) — create/edit a room type. Saving also creates or
 * updates its "Noche – {tipo}" service product on the backend.
 */
@Component({
  selector: 'app-unit-type-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
    ScrollableTabsComponent,
    ImageSourceModalComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      (opened)="syncFromUnitType()"
      [size]="'md'"
      [dialog]="true"
      [title]="title()"
      subtitle="Capacidad, camas, precio, fotos y amenidades"
    >
      <app-scrollable-tabs
        [tabs]="tabs"
        [activeTab]="activeTab()"
        (tabChange)="activeTab.set($any($event))"
        size="sm"
        ariaLabel="Secciones del tipo de habitación"
      />

      <form
        [formGroup]="form"
        class="space-y-4 mt-4"
        [class.hidden]="activeTab() !== 'data'"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <app-input
            class="md:col-span-2"
            formControlName="name"
            label="Nombre"
            type="text"
            placeholder="Ej. Doble estándar, Suite, Cabaña"
            [required]="true"
            [control]="form.controls.name"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="base_occupancy"
            label="Ocupación base"
            type="number"
            [min]="1"
            [required]="true"
            helperText="Personas incluidas en el precio base."
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="max_adults"
            label="Máximo de adultos"
            type="number"
            [min]="1"
            [required]="true"
            [error]="maxAdultsError()"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="max_children"
            label="Máximo de niños"
            type="number"
            [min]="0"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="bed_config"
            label="Camas"
            type="text"
            placeholder="Ej. 1 doble + 1 sencilla"
            customWrapperClass="mt-0"
          />
          <app-input
            formControlName="base_price"
            label="Precio base por noche"
            [currency]="true"
            [required]="true"
            [control]="form.controls.base_price"
            helperText="Antes de impuestos."
            customWrapperClass="mt-0"
          />
          <app-selector
            formControlName="tax_category_id"
            label="Impuesto"
            [options]="taxOptions()"
          />
          <app-input
            formControlName="overbooking_allowance"
            label="Sobreventa permitida"
            type="number"
            [min]="0"
            [max]="99"
            [placeholder]="isEditMode() ? '0' : 'Valor de Ajustes → Hotelería'"
            [helperText]="overbookingHelp()"
            customWrapperClass="mt-0"
          />
        </div>
      </form>

      @if (activeTab() === 'photos') {
        <div class="mt-4 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm text-text-secondary">
              {{ photos().length }} de {{ maxPhotos }} fotos. La primera es la portada.
            </p>
            <app-button
              variant="outline"
              size="sm"
              [loading]="uploading()"
              [disabled]="photos().length >= maxPhotos"
              (clicked)="photoPickerOpen.set(true)"
            >
              <app-icon slot="icon" name="upload-cloud" [size]="16" />
              Subir fotos
            </app-button>
          </div>

          @if (photos().length === 0) {
            <p class="text-sm text-text-secondary py-6 text-center border border-dashed border-border rounded-lg">
              Aún no hay fotos de este tipo de habitación.
            </p>
          } @else {
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              @for (photo of photos(); track photo.key; let i = $index; let last = $last) {
                <div class="relative rounded-lg overflow-hidden border border-border bg-surface">
                  <img [src]="photo.url" [alt]="'Foto ' + (i + 1)" class="w-full aspect-[4/3] object-cover" />
                  <span class="absolute top-1 left-1 text-xs bg-black/60 text-white rounded px-1.5">{{ i + 1 }}</span>
                  <div class="flex justify-between p-1">
                    <div class="flex gap-1">
                      <app-button variant="ghost" size="xsm" [disabled]="i === 0" (clicked)="movePhoto(i, -1)" ariaLabel="Mover antes">
                        <app-icon slot="icon" name="arrow-left" [size]="14" />
                      </app-button>
                      <app-button variant="ghost" size="xsm" [disabled]="last" (clicked)="movePhoto(i, 1)" ariaLabel="Mover después">
                        <app-icon slot="icon" name="arrow-right" [size]="14" />
                      </app-button>
                    </div>
                    <app-button variant="ghost" size="xsm" (clicked)="removePhoto(i)" ariaLabel="Quitar foto">
                      <app-icon slot="icon" name="trash-2" [size]="14" />
                    </app-button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      @if (activeTab() === 'amenities') {
        <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          @for (amenity of amenityCatalog(); track amenity.code) {
            <div class="p-2 rounded-lg border border-border">
              <app-toggle
                [checked]="amenities().includes(amenity.code)"
                [label]="amenity.label"
                (changed)="toggleAmenity(amenity.code)"
              />
            </div>
          }
        </div>
      }

      <app-image-source-modal
        [(isOpen)]="photoPickerOpen"
        [remainingSlots]="maxPhotos - photos().length"
        defaultAspect="4:3"
        headerTitle="Fotos de la habitación"
        (imagesAdded)="onPhotosAdded($event)"
      />

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button variant="primary" [loading]="saving()" (clicked)="onSubmit()">
          <app-icon slot="icon" [name]="isEditMode() ? 'save' : 'plus'" [size]="16" />
          {{ isEditMode() ? 'Guardar cambios' : 'Crear tipo' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class UnitTypeFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly unitTypesService = inject(UnitTypesService);
  private readonly taxesService = inject(TaxesService);
  private readonly toastService = inject(ToastService);
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authFacade = inject(AuthFacade);

  readonly isOpen = input(false);
  readonly unitType = input<UnitType | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly saved = output<UnitType>();

  readonly saving = signal(false);

  readonly tabs: ScrollableTab[] = [
    { id: 'data', label: 'Datos', icon: 'bed-double' },
    { id: 'photos', label: 'Fotos', icon: 'image-plus' },
    { id: 'amenities', label: 'Amenidades', icon: 'wifi' },
  ];
  readonly activeTab = signal<FormTab>('data');
  readonly maxPhotos = MAX_PHOTOS;
  readonly photos = signal<Photo[]>([]);
  readonly uploading = signal(false);
  readonly photoPickerOpen = signal(false);
  readonly amenities = signal<string[]>([]);

  readonly amenityCatalog = toSignal(
    this.unitTypesService
      .amenities()
      .pipe(catchError(() => of<LodgingAmenity[]>([]))),
    { initialValue: [] as LodgingAmenity[] },
  );
  readonly isEditMode = computed(() => this.unitType() != null);
  readonly canEditOverbooking = computed(
    () =>
      this.authFacade.ownerFlag() ||
      this.authFacade.userPermissions().includes(OVERBOOKING_PERMISSION),
  );
  readonly overbookingHelp = computed(() =>
    this.canEditOverbooking()
      ? 'Reservas que se pueden vender por encima de las habitaciones de este tipo.'
      : 'Solo un usuario con permiso de tarifas puede cambiarla.',
  );
  readonly title = computed(() =>
    this.isEditMode()
      ? `Editar tipo: ${this.unitType()?.name ?? ''}`
      : 'Nuevo tipo de habitación',
  );

  readonly taxOptions = toSignal(
    this.taxesService.getTaxCategories().pipe(
      map((taxes): SelectorOption[] => [
        { value: NO_TAX, label: 'Sin impuesto' },
        ...taxes.map((t) => ({ value: t.id, label: t.name })),
      ]),
      catchError(() => of<SelectorOption[]>([{ value: NO_TAX, label: 'Sin impuesto' }])),
    ),
    { initialValue: [{ value: NO_TAX, label: 'Sin impuesto' }] as SelectorOption[] },
  );

  readonly form: FormGroup<UnitTypeForm> = this.fb.group<UnitTypeForm>({
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    base_occupancy: this.fb.control<number | null>(2, {
      validators: [Validators.required, Validators.min(1)],
    }),
    max_adults: this.fb.control<number | null>(2, {
      validators: [Validators.required, Validators.min(1)],
    }),
    max_children: this.fb.control<number | null>(0, {
      validators: [Validators.min(0)],
    }),
    bed_config: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(255)],
    }),
    base_price: this.fb.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
    tax_category_id: this.fb.nonNullable.control<number>(NO_TAX),
    overbooking_allowance: this.fb.control<number | null>(null, {
      validators: [Validators.min(0), Validators.max(99)],
    }),
  });

  // Form status is not a signal: bridge it so the error recomputes (zoneless).
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  private readonly touched = signal(false);

  readonly maxAdultsError = computed(() => {
    this.formStatus();
    const control = this.form.controls.max_adults;
    if (!this.touched() && !control.dirty) return '';
    if (control.hasError('min')) return MAX_CAPACITY_MESSAGE;
    if (control.hasError('required')) return 'Este campo es requerido.';
    return '';
  });

  constructor() {
    effect(() => {
      this.unitType();
      this.syncFromUnitType();
    });
    effect(() => {
      const control = this.form.controls.overbooking_allowance;
      if (this.canEditOverbooking()) control.enable({ emitEvent: false });
      else control.disable({ emitEvent: false });
    });
  }

  syncFromUnitType(): void {
    const u = this.unitType();
    this.touched.set(false);
    this.activeTab.set('data');
    this.photos.set(
      (u?.images ?? []).map((key, i) => ({ key, url: u?.image_urls[i] ?? '' })),
    );
    this.amenities.set([...(u?.amenities ?? [])]);
    this.form.reset({
      name: u?.name ?? '',
      base_occupancy: u?.base_occupancy ?? 2,
      max_adults: u?.max_adults ?? 2,
      max_children: u?.max_children ?? 0,
      bed_config: u?.bed_config ?? '',
      base_price:
        u && u.product.base_price !== null ? Number(u.product.base_price) : null,
      tax_category_id:
        u?.product.product_tax_assignments[0]?.tax_categories.id ?? NO_TAX,
      overbooking_allowance: u ? u.overbooking_allowance : null,
    });
  }

  onPhotosAdded(dataUrls: string[]): void {
    if (dataUrls.length === 0) return;
    this.uploading.set(true);
    forkJoin(
      dataUrls.map((dataUrl, i) =>
        this.imageUploadService.uploadFile(
          dataUrlToFile(dataUrl, `habitacion-${Date.now()}-${i}.jpg`),
          'lodging',
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          this.uploading.set(false);
          this.photos.update((current) =>
            [...current, ...results.map((r) => ({ key: r.key, url: r.url }))].slice(
              0,
              MAX_PHOTOS,
            ),
          );
        },
        error: () => {
          this.uploading.set(false);
          this.toastService.error('No se pudieron subir las fotos');
        },
      });
  }

  movePhoto(index: number, delta: -1 | 1): void {
    this.photos.update((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  removePhoto(index: number): void {
    this.photos.update((current) => current.filter((_, i) => i !== index));
  }

  toggleAmenity(code: string): void {
    this.amenities.update((current) =>
      current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code],
    );
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.activeTab.set('data');
      this.touched.set(true);
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: UnitTypePayload = {
      name: raw.name.trim(),
      base_occupancy: raw.base_occupancy ?? 1,
      max_adults: raw.max_adults ?? 0,
      max_children: raw.max_children ?? 0,
      bed_config: raw.bed_config.trim() || undefined,
      base_price: raw.base_price ?? 0,
      images: this.photos().map((p) => p.key),
      amenities: this.amenities(),
      // Empty on a new type = the store default; never sent without permission.
      ...(this.canEditOverbooking() &&
        String(raw.overbooking_allowance ?? '').trim() !== '' && {
          overbooking_allowance: Number(raw.overbooking_allowance),
        }),
    };
    const current = this.unitType();
    // The form edits one tax: send it only when it changed, so a second tax
    // added from Productos is not wiped by saving the room type.
    const initialTax =
      current?.product.product_tax_assignments[0]?.tax_categories.id ?? NO_TAX;
    if (!current || raw.tax_category_id !== initialTax) {
      payload.tax_category_ids = raw.tax_category_id
        ? [raw.tax_category_id]
        : [];
    }
    const request$ = current
      ? this.unitTypesService.update(current.id, payload)
      : this.unitTypesService.create(payload);

    this.saving.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toastService.success(
          current ? 'Tipo de habitación actualizado' : 'Tipo de habitación creado',
        );
        this.saved.emit(result);
        this.isOpenChange.emit(false);
      },
      error: (message: unknown) => {
        this.saving.set(false);
        this.toastService.error(
          typeof message === 'string' ? message : 'No se pudo guardar el tipo de habitación',
        );
      },
    });
  }
}
