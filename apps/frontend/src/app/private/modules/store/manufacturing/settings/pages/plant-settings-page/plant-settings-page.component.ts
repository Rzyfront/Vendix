import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';

import {
  CardComponent,
  SelectorComponent,
  SelectorOption,
  SettingToggleComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

import {
  ManufacturingCostMethod,
  ManufacturingSettings,
} from '../../../interfaces';
import { ManufacturingSettingsService } from '../../../services';
import { InventoryService } from '../../../../inventory/services/inventory.service';

interface SettingsFormShape {
  default_input_location_id: FormControl<number | null>;
  default_output_location_id: FormControl<number | null>;
  cost_method: FormControl<ManufacturingCostMethod>;
  lot_required: FormControl<boolean>;
}

@Component({
  selector: 'app-plant-settings-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    SelectorComponent,
    SettingToggleComponent,
  ],
  templateUrl: './plant-settings-page.component.html',
})
export class PlantSettingsPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly settingsService = inject(ManufacturingSettingsService);
  private readonly inventoryService = inject(InventoryService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly locationOptions = signal<SelectorOption[]>([]);

  readonly costMethodOptions: SelectorOption[] = [
    {
      value: 'fifo',
      label: 'PEPS (FIFO)',
      description: 'Consume primero las capas de costo más antiguas',
    },
    {
      value: 'cpp',
      label: 'Costo promedio ponderado (CPP)',
      description: 'Usa el costo promedio vigente de cada insumo',
    },
  ];

  readonly form = this.fb.nonNullable.group<SettingsFormShape>({
    default_input_location_id: this.fb.nonNullable.control<number | null>(null),
    default_output_location_id: this.fb.nonNullable.control<number | null>(null),
    cost_method: this.fb.nonNullable.control<ManufacturingCostMethod>('fifo'),
    lot_required: this.fb.nonNullable.control(false),
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'save',
      label: 'Guardar cambios',
      icon: 'save',
      variant: 'primary',
      loading: this.isSaving(),
      disabled: this.isSaving() || this.isLoading(),
    },
  ]);

  ngOnInit(): void {
    this.loadLocations();
    this.loadSettings();
  }

  private loadLocations(): void {
    this.inventoryService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) =>
          this.locationOptions.set(
            (res.data ?? []).map((l) => ({
              value: l.id,
              label: l.name + (l.code ? ` (${l.code})` : ''),
            })),
          ),
        error: () => this.toastService.error('No se pudieron cargar las bodegas'),
      });
  }

  private loadSettings(): void {
    this.isLoading.set(true);
    this.settingsService
      .get()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.patch(s);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'No se pudo cargar la configuración',
          );
          this.isLoading.set(false);
        },
      });
  }

  private patch(s: ManufacturingSettings): void {
    this.form.reset({
      default_input_location_id: s.default_input_location_id ?? null,
      default_output_location_id: s.default_output_location_id ?? null,
      cost_method: s.cost_method ?? 'fifo',
      lot_required: !!s.lot_required,
    });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'save') this.save();
  }

  save(): void {
    if (this.isSaving()) return;
    const raw = this.form.getRawValue();
    this.isSaving.set(true);
    this.settingsService
      .update({
        default_input_location_id:
          raw.default_input_location_id != null ? Number(raw.default_input_location_id) : null,
        default_output_location_id:
          raw.default_output_location_id != null ? Number(raw.default_output_location_id) : null,
        cost_method: raw.cost_method,
        lot_required: raw.lot_required,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.patch(s);
          this.isSaving.set(false);
          this.toastService.success('Configuración de planta guardada');
        },
        error: (error) => {
          this.isSaving.set(false);
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al guardar la configuración',
          );
        },
      });
  }
}
