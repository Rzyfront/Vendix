import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  DialogService,
  IconComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';
import { SIRE_STATUS_CHIPS } from '../../../shared/hospitality-status';
import { SireRecord, SireSheet } from '../../interfaces/sire.interface';
import { LodgingSireService } from '../../services/lodging-sire.service';

/** Fields of the SIRE form, in the order the portal asks them. */
const FIELDS: { key: keyof SireRecord; label: string }[] = [
  { key: 'tipo_movimiento', label: 'Tipo de movimiento' },
  { key: 'fecha_movimiento', label: 'Fecha del movimiento' },
  { key: 'tipo_documento', label: 'Tipo de documento' },
  { key: 'numero_documento', label: 'Número de documento' },
  { key: 'nacionalidad', label: 'Nacionalidad' },
  { key: 'primer_apellido', label: 'Primer apellido' },
  { key: 'segundo_apellido', label: 'Segundo apellido' },
  { key: 'nombres', label: 'Nombres' },
  { key: 'fecha_nacimiento', label: 'Fecha de nacimiento' },
  { key: 'procedencia', label: 'Procedencia' },
  { key: 'residencia', label: 'Residencia' },
  { key: 'habitacion', label: 'Habitación' },
  { key: 'permiso_ingreso', label: 'Permiso de ingreso' },
];

/** Portal of Migración Colombia where the desk reports each movement. */
export const SIRE_PORTAL_URL = 'https://apps.migracioncolombia.gov.co/sire/public/login.jsf';

/**
 * Hospitality Suite (H4.2) — copyable SIRE sheet of one movement: each field
 * with its copy button, "Copiar todo" and "Marcar reportado". Missing data is
 * an informative notice, never a block (D14).
 */
@Component({
  selector: 'app-sire-sheet-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
    SpinnerComponent,
    HospitalityLoadErrorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="sireId() !== null"
      (isOpenChange)="!$event && closed.emit()"
      (cancel)="closed.emit()"
      [size]="'md'"
      [fullScreenOnMobile]="true"
      [title]="title()"
      [subtitle]="subtitle()"
    >
      @if (loadError(); as message) {
        <app-hospitality-load-error what="la ficha SIRE" [message]="message" (retry)="load()" />
      } @else if (!sheet()) {
        <div class="p-4">
          <app-spinner [center]="true" text="Cargando ficha…" />
        </div>
      } @else {
        @let s = sheet()!;
        <div class="space-y-3" data-testid="sire-sheet">
          <div class="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <app-badge [variant]="chip().variant" size="sm">{{ chip().label }}</app-badge>
            @if (s.status === 'manual') {
              <span>
                Reportado
                @if (s.reported_by_name) { por {{ s.reported_by_name }} }
                · {{ reportedAt() }}
              </span>
            } @else {
              <span>Sin reportar hace {{ age(s.age_hours) }}</span>
            }
          </div>

          @if (s.missing.length > 0) {
            <p role="status" class="flex items-start gap-1.5 text-sm font-medium text-warning" data-testid="sire-missing">
              <app-icon name="alert-triangle" [size]="16" class="mt-0.5 shrink-0" />
              Faltan datos del huésped: {{ s.missing.join(', ') }}. Puedes completarlos en la reserva o
              directamente en el portal.
            </p>
          }

          @if (s.record; as record) {
            <dl class="divide-y divide-border rounded-lg border border-border">
              @for (field of fields; track field.key) {
                <div class="flex min-h-11 items-center justify-between gap-2 px-3 py-1.5">
                  <div class="min-w-0">
                    <dt class="text-xs text-text-secondary">{{ field.label }}</dt>
                    <dd class="truncate text-sm font-medium text-text-primary" [title]="record[field.key]">
                      {{ record[field.key] || '—' }}
                    </dd>
                  </div>
                  @if (record[field.key]) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      customClasses="!h-11 !w-11 !px-0"
                      [ariaLabel]="'Copiar ' + field.label.toLowerCase()"
                      (clicked)="copy(record[field.key], field.label)"
                    >
                      <app-icon slot="icon" name="copy" [size]="16" />
                    </app-button>
                  }
                </div>
              }
            </dl>
          }

          <p class="text-xs text-text-secondary">
            Repórtalo en el
            <a [href]="portalUrl" target="_blank" rel="noopener noreferrer" class="font-medium text-primary underline">portal SIRE de Migración Colombia</a>
            y luego márcalo como reportado.
          </p>
        </div>
      }

      <div slot="footer" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="ghost" (clicked)="closed.emit()">Cerrar</app-button>
        @if (sheet()?.record) {
          <app-button variant="outline" (clicked)="copyAll()" data-testid="sire-copy-all">
            <app-icon slot="icon" name="copy" [size]="16" />
            Copiar todo
          </app-button>
        }
        @if (canOperate() && sheet()?.status === 'pending') {
          <app-button
            variant="primary"
            [loading]="marking()"
            [disabled]="marking()"
            (clicked)="markReported()"
            data-testid="sire-sheet-mark"
          >
            <app-icon slot="icon" name="check-check" [size]="16" />
            Marcar reportado
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class SireSheetModalComponent {
  private readonly sireService = inject(LodgingSireService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly sireId = input<number | null>(null);
  readonly canOperate = input(false);
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly fields = FIELDS;
  readonly portalUrl = SIRE_PORTAL_URL;
  readonly sheet = signal<SireSheet | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly marking = signal(false);

  readonly chip = computed(() => {
    const s = this.sheet();
    if (!s || s.status === 'manual') return SIRE_STATUS_CHIPS.manual;
    return s.overdue ? SIRE_STATUS_CHIPS.overdue : SIRE_STATUS_CHIPS.pending;
  });

  readonly title = computed(() => {
    const s = this.sheet();
    return s ? `Ficha SIRE · ${s.guest_name}` : 'Ficha SIRE';
  });

  readonly subtitle = computed(() => {
    const s = this.sheet();
    if (!s) return 'Planilla de viajeros (Migración Colombia)';
    return `${s.event === 'check_in' ? 'Entrada' : 'Salida'} · Reserva ${s.reservation_number}`;
  });

  readonly reportedAt = computed(() => {
    const sent = this.sheet()?.sent_at;
    return sent
      ? new Date(sent).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      : '';
  });

  constructor() {
    effect(() => {
      const id = this.sireId();
      untracked(() => {
        this.sheet.set(null);
        this.loadError.set(null);
        if (id !== null) this.load();
      });
    });
  }

  load(): void {
    const id = this.sireId();
    if (id === null) return;
    this.loadError.set(null);
    this.sireService
      .sheet(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sheet) => this.sheet.set(sheet),
        error: (message: unknown) =>
          this.loadError.set(typeof message === 'string' ? message : 'Error de conexión'),
      });
  }

  age(hours: number): string {
    return sireAge(hours);
  }

  copy(value: string, label: string): void {
    this.writeClipboard(value, `${label} copiado`);
  }

  /** One line per field ("Campo: valor"), ready to paste next to the portal. */
  copyAll(): void {
    const record = this.sheet()?.record;
    if (!record) return;
    const text = FIELDS.map((field) => `${field.label}: ${record[field.key] || ''}`).join('\n');
    this.writeClipboard(text, 'Ficha copiada');
  }

  async markReported(): Promise<void> {
    const s = this.sheet();
    if (!s || this.marking()) return;
    const confirmed = await this.dialogService.confirm({
      title: 'Marcar como reportado en el SIRE',
      message:
        `Confirma que ya reportaste la ${s.event === 'check_in' ? 'entrada' : 'salida'} de ${s.guest_name} ` +
        `(reserva ${s.reservation_number}) en el portal de Migración Colombia. Quedará tu nombre y la hora.`,
      confirmText: 'Marcar reportado',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;
    this.marking.set(true);
    this.sireService
      .markReported([s.id])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.marking.set(false);
          this.toastService.success('Marcado como reportado en el SIRE');
          this.changed.emit();
          this.load();
        },
        error: (message: unknown) => {
          this.marking.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo marcar el registro');
        },
      });
  }

  private writeClipboard(text: string, success: string): void {
    if (!globalThis.navigator?.clipboard) {
      this.toastService.error('Tu navegador no permite copiar');
      return;
    }
    globalThis.navigator.clipboard.writeText(text).then(
      () => this.toastService.success(success),
      () => this.toastService.error('No se pudo copiar'),
    );
  }
}

/** 5 → "5 h"; 50 → "2 d 2 h"; 0 → "menos de 1 h". */
export function sireAge(hours: number): string {
  if (hours < 1) return 'menos de 1 h';
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}
