import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import {
  AddressFormFieldsComponent,
  BadgeComponent,
  ButtonComponent,
  DialogService,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
  type AddressPayload,
} from '../../../../../../shared/components';
import { CustomersService, addressToLocationPayload } from '../../services/customers.service';
import {
  AddCustomerLocationResult,
  CustomerAddress,
} from '../../models/customer.model';
import { translateCustomerError } from '../../utils/customer-error.translator';

/** Mensaje del backend (400 de borrado en uso, validaciones) o fallback traducido. */
function backendMessage(err: unknown, fallback: string): string {
  const message = (err as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message.trim()
    ? message
    : translateCustomerError(err, fallback);
}

/**
 * Pestaña «Ubicaciones» del perfil del cliente: lista las sedes/direcciones
 * de envío del cliente y permite agregar, editar, eliminar y marcar la
 * principal. Cada ubicación es una fila de `addresses` (`type = shipping`).
 */
@Component({
  selector: 'app-customer-locations',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    AddressFormFieldsComponent,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-semibold text-text-primary">Ubicaciones</h3>
          <p class="text-xs text-text-secondary">
            Sedes y direcciones de envío de este cliente.
          </p>
        </div>
        @if (locations().length > 0) {
          <app-button variant="primary" size="sm" (clicked)="openAdd()">
            <app-icon slot="icon" name="plus" [size]="16"></app-icon>
            Agregar ubicación
          </app-button>
        }
      </div>

      @if (loading()) {
        <div class="flex justify-center py-12"><app-spinner></app-spinner></div>
      } @else if (loadError()) {
        <div class="p-4 rounded-xl border border-error/25 bg-error/10 text-error text-sm">
          {{ loadError() }}
        </div>
      } @else if (locations().length === 0) {
        <app-empty-state
          icon="map-pin"
          title="Este cliente aún no tiene ubicaciones"
          description="Agrega la dirección o sede donde le despachas o le prestas el servicio."
          actionButtonText="Agregar ubicación"
          (actionClick)="openAdd()"
        ></app-empty-state>
      } @else {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          @for (loc of locations(); track loc.id) {
            <article
              class="rounded-xl border bg-surface p-4 flex flex-col gap-3"
              [class.border-primary]="loc.is_primary"
              [class.border-border]="!loc.is_primary"
            >
              <header class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <app-icon name="map-pin" [size]="16"></app-icon>
                  <h4 class="text-sm font-semibold text-text-primary truncate">
                    {{ loc.label?.trim() || 'Sin nombre' }}
                  </h4>
                </div>
                @if (loc.is_primary) {
                  <app-badge variant="primary" size="xsm">Principal</app-badge>
                }
              </header>

              <div class="space-y-0.5">
                <p class="text-sm text-text-primary">
                  {{ loc.address_line1 }}{{ loc.address_line2 ? ', ' + loc.address_line2 : '' }}
                </p>
                <p class="text-sm text-text-secondary">
                  {{ loc.city }}{{ loc.state_province ? ', ' + loc.state_province : '' }}
                </p>
                @if (loc.phone_number) {
                  <p class="text-xs text-text-secondary">Tel: {{ loc.phone_number }}</p>
                }
              </div>

              <footer class="flex flex-wrap gap-2 pt-1">
                @if (!loc.is_primary) {
                  <app-button
                    variant="outline"
                    size="sm"
                    [disabled]="busyId() === loc.id"
                    (clicked)="markPrimary(loc)"
                  >
                    Marcar como principal
                  </app-button>
                }
                <app-button variant="ghost" size="sm" (clicked)="openEdit(loc)">
                  <app-icon slot="icon" name="pencil" [size]="14"></app-icon>
                  Editar
                </app-button>
                <app-button
                  variant="outline-danger"
                  size="sm"
                  [disabled]="busyId() === loc.id"
                  (clicked)="remove(loc)"
                >
                  <app-icon slot="icon" name="trash-2" [size]="14"></app-icon>
                  Eliminar
                </app-button>
              </footer>
            </article>
          }
        </div>
      }
    </div>

    <app-modal
      [isOpen]="isModalOpen()"
      (isOpenChange)="isModalOpen.set($event)"
      (cancel)="closeModal()"
      size="md"
      [title]="editing() ? 'Editar ubicación' : 'Agregar ubicación'"
      subtitle="Nombre de la sede y dirección de envío"
    >
      @if (isModalOpen()) {
        <div class="space-y-4">
          <app-input
            label="Nombre de la sede"
            placeholder="Ej: Sede Norte"
            [formControl]="labelControl"
            [maxlength]="120"
          ></app-input>
          <app-address-form-fields
            [initialAddress]="initialAddress()"
            [compact]="true"
            [showPhone]="true"
            [showErrors]="showErrors()"
            (addressChange)="addressPayload.set($event)"
            (validChange)="addressValid.set($event)"
          ></app-address-form-fields>
        </div>
      }
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (clicked)="closeModal()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="saving()"
          [disabled]="saving()"
          (clicked)="save()"
        >
          {{ editing() ? 'Guardar cambios' : 'Agregar ubicación' }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class CustomerLocationsComponent {
  private readonly customersService = inject(CustomersService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly customerId = input.required<number>();
  /** Emite cuando la lista cambió (alta, edición, borrado o principal). */
  readonly changed = output<void>();

  readonly locations = signal<CustomerAddress[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly busyId = signal<number | null>(null);

  readonly isModalOpen = signal(false);
  readonly editing = signal<CustomerAddress | null>(null);
  readonly saving = signal(false);
  readonly showErrors = signal(false);
  readonly addressPayload = signal<AddressPayload | null>(null);
  readonly addressValid = signal(false);

  readonly labelControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(120)],
  });

  readonly initialAddress = computed<AddressPayload | null>(() => {
    const loc = this.editing();
    if (!loc) return null;
    return {
      address_line1: loc.address_line1 ?? null,
      address_line2: loc.address_line2 ?? null,
      city: loc.city ?? null,
      state_province: loc.state_province ?? null,
      country_code: loc.country_code ?? null,
      postal_code: loc.postal_code ?? null,
      phone_number: loc.phone_number ?? null,
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null,
      municipality_code: loc.municipality_code ?? null,
    };
  });

  constructor() {
    effect(() => {
      const id = this.customerId();
      untracked(() => this.load(id));
    });
  }

  /** Recarga la lista desde el backend. */
  load(id: number = this.customerId()): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.customersService
      .listCustomerLocations(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (rows) => this.locations.set(rows ?? []),
        error: (err) =>
          this.loadError.set(
            translateCustomerError(err, 'No se pudieron cargar las ubicaciones'),
          ),
      });
  }

  openAdd(): void {
    this.editing.set(null);
    this.resetForm('');
    this.isModalOpen.set(true);
  }

  openEdit(loc: CustomerAddress): void {
    this.editing.set(loc);
    this.resetForm(loc.label ?? '');
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.editing.set(null);
  }

  private resetForm(label: string): void {
    this.labelControl.reset(label);
    this.addressPayload.set(null);
    this.addressValid.set(false);
    this.showErrors.set(false);
  }

  save(): void {
    const addr = this.addressPayload();
    if (!this.addressValid() || !addr || this.labelControl.invalid) {
      this.showErrors.set(true);
      this.labelControl.markAsTouched();
      return;
    }
    const label = this.labelControl.value.trim();
    const body = addressToLocationPayload(addr);

    const current = this.editing();
    this.saving.set(true);
    const request$: Observable<CustomerAddress | AddCustomerLocationResult> = current
      ? this.customersService.updateCustomerLocation(current.id, {
          ...body,
          // En edición '' limpia el nombre; en alta se omite.
          label,
        })
      : this.customersService.addCustomerLocation(this.customerId(), {
          ...body,
          label: label || undefined,
        });

    request$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (result) => {
          if (!current && 'created' in result && !result.created) {
            this.toast.info('La ubicación ya estaba registrada');
          } else {
            this.toast.success(
              current ? 'Ubicación actualizada' : 'Ubicación agregada',
            );
          }
          this.closeModal();
          this.load();
          this.changed.emit();
        },
        error: (err: unknown) =>
          this.toast.error(
            backendMessage(err, 'No se pudo guardar la ubicación'),
            'Error al guardar ubicación',
          ),
      });
  }

  markPrimary(loc: CustomerAddress): void {
    this.busyId.set(loc.id);
    this.customersService
      .setPrimaryLocation(loc.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe({
        next: () => {
          this.toast.success('Ubicación principal actualizada');
          this.load();
          this.changed.emit();
        },
        error: (err) =>
          this.toast.error(
            backendMessage(err, 'No se pudo marcar como principal'),
          ),
      });
  }

  async remove(loc: CustomerAddress): Promise<void> {
    const name = loc.label?.trim() || loc.address_line1 || 'esta ubicación';
    const confirmed = await this.dialog.confirm({
      title: '¿Eliminar ubicación?',
      message: `Se eliminará ${name}. Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.busyId.set(loc.id);
    this.customersService
      .deleteCustomerLocation(loc.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe({
        next: () => {
          this.toast.success('Ubicación eliminada');
          this.load();
          this.changed.emit();
        },
        error: (err) =>
          this.toast.error(
            backendMessage(err, 'No se pudo eliminar la ubicación'),
            'No se pudo eliminar',
          ),
      });
  }
}
