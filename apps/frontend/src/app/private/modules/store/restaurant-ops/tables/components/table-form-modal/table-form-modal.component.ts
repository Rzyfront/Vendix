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
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';
import {
  CreateTableDto,
  Table,
  TableStatus,
  UpdateTableDto,
} from '../../interfaces';
import { TablesService } from '../../services/tables.service';

const STATUS_OPTIONS: SelectorOption[] = [
  { value: 'available', label: 'Disponible' },
  { value: 'occupied', label: 'Ocupada' },
  { value: 'reserved', label: 'Reservada' },
  { value: 'cleaning', label: 'Limpieza' },
];

interface TableForm {
  name: FormControl<string>;
  zone: FormControl<string | null>;
  capacity: FormControl<number | null>;
  status: FormControl<TableStatus>;
  pos_x: FormControl<number | null>;
  pos_y: FormControl<number | null>;
}

/**
 * Modal de alta/edición de mesa (Restaurant Suite — Fase 1 alignment).
 *
 * - Si `table` es null → alta. Submit emite `saved` con CreateTableDto.
 * - Si `table` tiene valor → edición. Submit emite `saved` con
 *   UpdateTableDto (solo los campos modificados).
 *
 * Sigue el patrón model-based de `app-modal` (no usa *ngIf ni [hidden]).
 * Form tipado con strict null en los controles.
 */
@Component({
  selector: 'app-table-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
  ],
  templateUrl: './table-form-modal.component.html',
  styleUrl: './table-form-modal.component.scss',
})
export class TableFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly tablesService = inject(TablesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly table = input<Table | null>(null);
  readonly loadingInput = input(false, { alias: 'loading' });
  readonly internalLoading = signal(false);
  readonly loading = computed(
    () => this.loadingInput() || this.internalLoading(),
  );

  readonly isOpenChange = output<boolean>();
  readonly saved = output<CreateTableDto | UpdateTableDto>();

  readonly isEditMode = computed(() => this.table() != null);
  readonly title = computed(() =>
    this.isEditMode() ? `Editar mesa: ${this.table()?.name ?? ''}` : 'Nueva mesa',
  );

  readonly form: FormGroup<TableForm> = this.fb.group<TableForm>({
    name: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    zone: this.fb.control<string | null>(null),
    capacity: this.fb.control<number | null>(null, {
      validators: [Validators.min(1)],
    }),
    status: this.fb.nonNullable.control<TableStatus>('available'),
    pos_x: this.fb.control<number | null>(null),
    pos_y: this.fb.control<number | null>(null),
  });

  readonly statusOptions: SelectorOption[] = STATUS_OPTIONS;

  constructor() {
    // Sincroniza el form cada vez que la mesa a editar cambia (crear ↔ editar).
    // Resuelve el caso donde el modal ya está abierto y la mesa a editar
    // cambia de null (alta) a un valor (edición) o viceversa.
    effect(() => {
      this.table();
      this.syncFromTable();
    });
  }

  /**
   * Llamado por el template cada vez que se abre el modal o cambia
   * la mesa a editar. Reusa el form para evitar leaks de estado entre
   * modal-create y modal-edit.
   */
  syncFromTable(): void {
    const t = this.table();
    if (t) {
      this.form.reset({
        name: t.name,
        zone: t.zone,
        capacity: t.capacity,
        status: t.status,
        pos_x: t.pos_x,
        pos_y: t.pos_y,
      });
    } else {
      this.form.reset({
        name: '',
        zone: null,
        capacity: null,
        status: 'available',
        pos_x: null,
        pos_y: null,
      });
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const t = this.table();
    if (t) {
      const dto: UpdateTableDto = {
        name: raw.name,
        zone: raw.zone ?? undefined,
        capacity: raw.capacity ?? undefined,
        status: raw.status,
        pos_x: raw.pos_x ?? undefined,
        pos_y: raw.pos_y ?? undefined,
      };
      this.internalLoading.set(true);
      this.tablesService
        .update(t.id, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.internalLoading.set(false);
            this.toastService.success('Mesa actualizada');
            this.saved.emit(dto);
            this.isOpenChange.emit(false);
          },
          error: (err: unknown) => {
            this.internalLoading.set(false);
            this.toastService.error(
              typeof err === 'string' ? err : 'Error al actualizar la mesa',
            );
          },
        });
      return;
    }
    const dto: CreateTableDto = {
      name: raw.name,
      zone: raw.zone ?? undefined,
      capacity: raw.capacity ?? undefined,
      status: raw.status,
      pos_x: raw.pos_x ?? undefined,
      pos_y: raw.pos_y ?? undefined,
    };
    this.internalLoading.set(true);
    this.tablesService
      .create(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.internalLoading.set(false);
          this.toastService.success('Mesa creada');
          this.saved.emit(dto);
          this.isOpenChange.emit(false);
        },
        error: (err: unknown) => {
          this.internalLoading.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al crear la mesa',
          );
        },
      });
  }
}
