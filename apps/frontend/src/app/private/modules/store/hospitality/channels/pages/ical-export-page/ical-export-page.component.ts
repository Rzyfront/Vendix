import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  BadgeComponent,
  BadgeVariant,
  ButtonComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import {
  IcalExportUnit,
  IcalImport,
  IcalImportStatus,
} from '../../interfaces/ical-export.interface';
import { LodgingIcalExportService } from '../../services/ical-export.service';

/**
 * Hospitality Suite — Canales → iCal (H6.1). One export link per room: the
 * manager generates it, copies it into Airbnb or Booking and the nights sold
 * or blocked in Vendix show up blocked there. The link carries a secret
 * token; regenerating or revoking it stops the URL already pasted.
 *
 * H6.2 — "Importar": the manager pastes the iCal URL of an Airbnb/Booking
 * listing into a room; its reservations block the room in Vendix (rack),
 * synced every 15 minutes and with "Sincronizar ahora".
 */
@Component({
  selector: 'app-hospitality-ical-export-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    SpinnerComponent,
    InputComponent,
    SelectorComponent,
    ReactiveFormsModule,
    DatePipe,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Canales · iCal"
        subtitle="Calendarios de Airbnb y Booking: exportar e importar"
        icon="share-2"
        variant="glass"
      />

      <div class="flex flex-col gap-3 p-2 md:p-4">
        <app-card [responsive]="true">
          <h2 class="mb-1 font-semibold">Exportar</h2>
          <p class="mb-3 text-sm text-text-secondary">
            Copia el enlace de cada habitación y pégalo en Airbnb o Booking (importar
            calendario). Allá se bloquearán las noches vendidas o bloqueadas en Vendix. El
            calendario solo lleva fechas: sin precios ni datos del huésped, y el canal lo
            actualiza cada pocas horas.
          </p>

          @if (units() === null) {
            <div class="flex flex-col items-center gap-2 py-8">
              <app-spinner size="md" />
              <p class="text-sm text-text-secondary">Cargando habitaciones…</p>
            </div>
          } @else if (units()!.length === 0) {
            <app-empty-state
              icon="bed-double"
              title="Sin habitaciones"
              description="Crea las habitaciones en Hotelería → Habitaciones para publicar su calendario."
              [showActionButton]="false"
            />
          } @else {
            <div class="flex flex-col divide-y divide-border">
              @for (unit of units(); track unit.id) {
                <div
                  class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                  [attr.data-testid]="'ical-unit-' + unit.code"
                >
                  <div class="flex min-w-0 flex-col gap-1">
                    <div class="flex items-center gap-2">
                      <span class="font-semibold">Habitación {{ unit.code }}</span>
                      <span class="text-sm text-text-secondary">{{ unit.unit_type.name }}</span>
                      @if (!unit.is_active) {
                        <app-badge variant="neutral" size="sm">Inactiva</app-badge>
                      }
                    </div>
                    @if (unit.ical_export_token; as token) {
                      <code class="block truncate rounded bg-muted px-2 py-1 text-xs" [title]="url(token)">
                        {{ url(token) }}
                      </code>
                    } @else {
                      <span class="text-xs text-text-secondary">Sin enlace publicado</span>
                    }
                  </div>

                  <div class="flex shrink-0 flex-wrap gap-2">
                    @if (unit.ical_export_token; as token) {
                      <app-button variant="primary" size="sm" (clicked)="copy(token)">
                        Copiar URL
                      </app-button>
                      <app-button
                        variant="outline"
                        size="sm"
                        [loading]="saving() === unit.id"
                        [disabled]="saving() !== null"
                        (clicked)="regenerate(unit)"
                      >
                        Regenerar
                      </app-button>
                      <app-button
                        variant="outline"
                        size="sm"
                        [disabled]="saving() !== null"
                        (clicked)="revoke(unit)"
                      >
                        Revocar
                      </app-button>
                    } @else {
                      <app-button
                        variant="outline"
                        size="sm"
                        [loading]="saving() === unit.id"
                        [disabled]="saving() !== null"
                        (clicked)="generate(unit)"
                      >
                        Generar enlace
                      </app-button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </app-card>

        <!-- H6.2 — calendars imported from the channels -->
        <app-card [responsive]="true">
          <h2 class="mb-1 font-semibold">Importar</h2>
          <p class="mb-2 text-sm text-text-secondary">
            Pega el enlace iCal que Airbnb o Booking dan para el anuncio (exportar calendario).
            Sus reservas bloquean la habitación en Vendix y se ven en el rack con el nombre del
            canal. Se sincroniza cada 15 minutos y con «Sincronizar ahora».
          </p>
          <p
            class="mb-3 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
            data-testid="ical-import-warning"
          >
            iCal no trae el precio ni los datos del huésped: solo bloquea las fechas. Además, el
            canal publica su calendario con horas de retraso, así que una misma noche puede
            venderse en los dos lados antes de sincronizar (riesgo de doble venta). Si ves el
            aviso de doble venta, mueve la reserva de Vendix a otra habitación.
          </p>

          <form
            [formGroup]="importForm"
            class="grid grid-cols-1 gap-3 text-sm md:grid-cols-[1fr_1fr_2fr_auto] md:items-end"
            data-testid="ical-import-form"
            (ngSubmit)="addImport()"
          >
            <app-selector
              formControlName="unit_id"
              label="Habitación"
              placeholder="Selecciona"
              [options]="unitOptions()"
            />
            <app-input formControlName="name" label="Canal" placeholder="Airbnb" customWrapperClass="mt-0" />
            <app-input
              formControlName="url"
              label="URL iCal del canal"
              placeholder="https://www.airbnb.com/calendar/ical/….ics"
              customWrapperClass="mt-0"
            />
            <app-button
              variant="primary"
              size="sm"
              type="submit"
              [loading]="adding()"
              [disabled]="!canAdd() || adding()"
            >
              Importar
            </app-button>
          </form>

          @if (imports() === null) {
            <div class="flex justify-center py-6"><app-spinner size="sm" /></div>
          } @else if (imports()!.length === 0) {
            <p class="py-4 text-sm text-text-secondary">Aún no importas calendarios.</p>
          } @else {
            <div class="mt-3 flex flex-col divide-y divide-border">
              @for (item of imports(); track item.id) {
                <div
                  class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                  [attr.data-testid]="'ical-import-' + item.id"
                >
                  <div class="flex min-w-0 flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold">Habitación {{ item.unit.code }}</span>
                      <span class="text-sm text-text-secondary">· {{ item.name }}</span>
                      @if (item.last_sync_status; as status) {
                        <app-badge [variant]="statusVariant(status)" size="sm">
                          {{ statusLabel(status) }}
                        </app-badge>
                      }
                    </div>
                    <span class="truncate text-xs text-text-secondary" [title]="item.url">{{ host(item.url) }}</span>
                    @if (item.last_sync_message) {
                      <span
                        class="text-xs"
                        [class.text-error]="item.last_sync_status === 'error'"
                        [class.text-warning]="item.last_sync_status === 'warning'"
                        [attr.data-testid]="'ical-import-message-' + item.id"
                      >
                        {{ item.last_sync_message }}
                      </span>
                    }
                    <span class="text-xs text-text-secondary">
                      @if (item.last_synced_at) {
                        Última sincronización: {{ item.last_synced_at | date: 'dd/MM/yyyy HH:mm' }}
                      } @else {
                        Sin sincronizar
                      }
                    </span>
                  </div>
                  <div class="flex shrink-0 flex-wrap gap-2">
                    <app-button
                      variant="outline"
                      size="sm"
                      [loading]="syncing() === item.id"
                      [disabled]="syncing() !== null"
                      (clicked)="syncNow(item)"
                    >
                      Sincronizar ahora
                    </app-button>
                    <app-button
                      variant="outline"
                      size="sm"
                      [disabled]="syncing() !== null"
                      (clicked)="removeImport(item)"
                    >
                      Quitar
                    </app-button>
                  </div>
                </div>
              }
            </div>
          }
        </app-card>
      </div>
    </div>
  `,
})
export class HospitalityIcalExportPageComponent implements OnInit {
  private readonly icalService = inject(LodgingIcalExportService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly units = signal<IcalExportUnit[] | null>(null);
  /** Room whose link change is in flight (blocks a double click). */
  readonly saving = signal<number | null>(null);

  /** H6.2 — imported calendars; null while loading. */
  readonly imports = signal<IcalImport[] | null>(null);
  /** Import whose sync or removal is in flight. */
  readonly syncing = signal<number | null>(null);
  readonly adding = signal(false);

  readonly importForm = this.fb.group({
    unit_id: this.fb.control<number | null>(null),
    name: this.fb.nonNullable.control('Airbnb'),
    url: this.fb.nonNullable.control(''),
  });
  private readonly importValue = toSignal(this.importForm.valueChanges, {
    initialValue: this.importForm.getRawValue(),
  });
  readonly canAdd = computed(() => {
    const { unit_id, url } = this.importValue();
    return unit_id !== null && unit_id !== undefined && !!url?.trim();
  });
  readonly unitOptions = computed<SelectorOption[]>(() =>
    (this.units() ?? [])
      .filter((u) => u.is_active)
      .map((u) => ({ value: u.id, label: `${u.code} · ${u.unit_type.name}` })),
  );

  ngOnInit(): void {
    this.load();
    this.loadImports();
  }

  loadImports(): void {
    this.icalService
      .imports()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (imports) => this.imports.set(imports),
        error: (message: unknown) => {
          this.imports.set([]);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar los calendarios',
          );
        },
      });
  }

  addImport(): void {
    if (!this.canAdd() || this.adding()) return;
    const { unit_id, name, url } = this.importForm.getRawValue();
    this.adding.set(true);
    this.icalService
      .createImport({ unit_id: Number(unit_id), name: name.trim() || 'Airbnb', url: url.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (item) => {
          this.adding.set(false);
          this.imports.update((list) => [...(list ?? []), item]);
          this.importForm.reset({ unit_id: null, name: 'Airbnb', url: '' });
          this.toastSync(item, 'Calendario importado');
        },
        error: (message: unknown) => {
          this.adding.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo importar');
        },
      });
  }

  syncNow(item: IcalImport): void {
    if (this.syncing() !== null) return;
    this.syncing.set(item.id);
    this.icalService
      .syncImport(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.syncing.set(null);
          this.replaceImport(updated);
          this.toastSync(updated, 'Calendario sincronizado');
        },
        error: (message: unknown) => {
          this.syncing.set(null);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo sincronizar');
        },
      });
  }

  async removeImport(item: IcalImport): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Quitar calendario',
      message: `Las reservas de ${item.name} dejarán de bloquear la habitación ${item.unit.code} y sus fechas próximas vuelven a la venta en Vendix.`,
      confirmText: 'Quitar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed || this.syncing() !== null) return;
    this.syncing.set(item.id);
    this.icalService
      .removeImport(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.syncing.set(null);
          this.imports.update((list) => list && list.filter((i) => i.id !== item.id));
          this.toastService.success('Calendario quitado');
        },
        error: (message: unknown) => {
          this.syncing.set(null);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo quitar');
        },
      });
  }

  statusVariant(status: IcalImportStatus): BadgeVariant {
    return status === 'ok' ? 'success' : status === 'warning' ? 'warning' : 'error';
  }

  statusLabel(status: IcalImportStatus): string {
    return status === 'ok' ? 'Sincronizado' : status === 'warning' ? 'Posible doble venta' : 'Error';
  }

  /** Only the host: the rest of the URL is the channel's secret. */
  host(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  private replaceImport(updated: IcalImport): void {
    this.imports.update((list) => list && list.map((i) => (i.id === updated.id ? updated : i)));
  }

  private toastSync(item: IcalImport, done: string): void {
    if (item.last_sync_status === 'error') {
      this.toastService.error(item.last_sync_message || 'No se pudo leer el calendario', undefined, 6000);
    } else if (item.last_sync_status === 'warning') {
      this.toastService.warning(item.last_sync_message || 'Posible doble venta', undefined, 8000);
    } else {
      this.toastService.success(done);
    }
  }

  load(): void {
    this.icalService
      .units()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (units) => this.units.set(units),
        error: (message: unknown) => {
          this.units.set([]);
          this.toastService.error(
            typeof message === 'string' ? message : 'No se pudieron cargar las habitaciones',
          );
        },
      });
  }

  url(token: string): string {
    return this.icalService.feedUrl(token);
  }

  async copy(token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url(token));
      this.toastService.success('URL copiada');
    } catch {
      this.toastService.error('No se pudo copiar; selecciona la URL y cópiala a mano');
    }
  }

  generate(unit: IcalExportUnit): void {
    this.applyToken(unit, 'Enlace generado');
  }

  async regenerate(unit: IcalExportUnit): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Regenerar enlace',
      message: `El enlace actual de la habitación ${unit.code} dejará de funcionar. Tendrás que pegar el nuevo en Airbnb o Booking.`,
      confirmText: 'Regenerar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (confirmed) this.applyToken(unit, 'Enlace regenerado');
  }

  async revoke(unit: IcalExportUnit): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Revocar enlace',
      message: `El enlace de la habitación ${unit.code} dejará de funcionar y el canal no recibirá más fechas.`,
      confirmText: 'Revocar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed || this.saving() !== null) return;
    this.saving.set(unit.id);
    this.icalService
      .revoke(unit.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(null);
          this.setToken(unit.id, null);
          this.toastService.success('Enlace revocado');
        },
        error: (message: unknown) => this.fail(message),
      });
  }

  private applyToken(unit: IcalExportUnit, done: string): void {
    if (this.saving() !== null) return;
    this.saving.set(unit.id);
    this.icalService
      .rotate(unit.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(null);
          this.setToken(unit.id, result.ical_export_token);
          this.toastService.success(done);
        },
        error: (message: unknown) => this.fail(message),
      });
  }

  private setToken(unitId: number, token: string | null): void {
    this.units.update(
      (units) =>
        units && units.map((u) => (u.id === unitId ? { ...u, ical_export_token: token } : u)),
    );
  }

  private fail(message: unknown): void {
    this.saving.set(null);
    this.toastService.error(typeof message === 'string' ? message : 'No se pudo guardar');
  }
}
