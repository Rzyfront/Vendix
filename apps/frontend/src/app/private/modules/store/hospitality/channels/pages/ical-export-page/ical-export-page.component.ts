import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { IcalExportUnit } from '../../interfaces/ical-export.interface';
import { LodgingIcalExportService } from '../../services/ical-export.service';

/**
 * Hospitality Suite — Canales → iCal (H6.1). One export link per room: the
 * manager generates it, copies it into Airbnb or Booking and the nights sold
 * or blocked in Vendix show up blocked there. The link carries a secret
 * token; regenerating or revoking it stops the URL already pasted.
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
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Canales · iCal"
        subtitle="Enlaces de calendario para Airbnb y Booking"
        icon="share-2"
        variant="glass"
      />

      <div class="flex flex-col gap-3 p-2 md:p-4">
        <app-card [responsive]="true">
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
      </div>
    </div>
  `,
})
export class HospitalityIcalExportPageComponent implements OnInit {
  private readonly icalService = inject(LodgingIcalExportService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly units = signal<IcalExportUnit[] | null>(null);
  /** Room whose link change is in flight (blocks a double click). */
  readonly saving = signal<number | null>(null);

  ngOnInit(): void {
    this.load();
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
