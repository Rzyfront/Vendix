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
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import { PosCustomer } from '../../../../pos/models/customer.model';
import { FolioLine, SplitAccountInput, SplitResult } from '../../interfaces/folio.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

const MAX_ACCOUNTS = 20;

interface DraftAccount {
  label: string;
  customerId: number | null;
  customerName: string | null;
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Hospitality Suite (H3.8) — "Dividir folio": assign each active line to an
 * account (e.g. nights to the company, the restaurant to the guest), preview
 * the total of every account and confirm. Each account is then collected and
 * invoiced on its own.
 */
@Component({
  selector: 'app-folio-split-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    PosCustomerSelectorComponent,
  ],
  template: `
    <app-modal [isOpen]="open()" (isOpenChange)="!$event && closed.emit()" title="Dividir folio" size="md">
      <div class="space-y-4 text-sm" data-testid="folio-split-modal">
        <div class="space-y-2">
          <p class="font-medium text-text-primary">Cuentas</p>
          @for (account of accounts(); track $index; let i = $index) {
            <div class="space-y-2 rounded-lg border border-border px-3 py-2" data-testid="split-account">
              <div class="flex items-end gap-2">
                <app-input
                  class="flex-1"
                  label="Nombre de la cuenta"
                  size="sm"
                  customWrapperClass="mt-0"
                  [maxlength]="60"
                  [ngModel]="account.label"
                  (ngModelChange)="setLabel(i, $event)"
                  data-testid="split-account-label"
                />
                @if (accounts().length > 2) {
                  <app-button variant="ghost" size="sm" ariaLabel="Quitar cuenta" (clicked)="removeAccount(i)">
                    <app-icon slot="icon" name="trash-2" [size]="14" />
                  </app-button>
                }
              </div>
              @if (pickingCustomer() === i) {
                <app-pos-customer-selector (customerSelected)="setCustomer(i, $event)" />
              } @else {
                <div class="flex items-center justify-between gap-2">
                  <span class="text-text-secondary">{{ account.customerName ?? 'Sin cliente asignado' }}</span>
                  <app-button variant="ghost" size="sm" (clicked)="pickingCustomer.set(i)">
                    {{ account.customerId ? 'Cambiar' : 'Elegir cliente' }}
                  </app-button>
                </div>
              }
            </div>
          }
          @if (accounts().length < 20) {
            <app-button variant="outline" size="sm" (clicked)="addAccount()" data-testid="split-add-account">
              <app-icon slot="icon" name="plus" [size]="14" />
              Agregar cuenta
            </app-button>
          }
        </div>

        <div class="space-y-2">
          <p class="font-medium text-text-primary">Ítems del folio</p>
          @for (line of activeLines(); track line.id) {
            <div class="grid grid-cols-[1fr_auto] items-center gap-2" data-testid="split-line">
              <div>
                <p class="font-medium">{{ line.description }}</p>
                <p class="text-xs text-text-secondary">
                  {{ line.origin ?? (line.kind === 'night' ? 'Alojamiento' : 'Cargo') }} · {{ money(line.total) }}
                </p>
              </div>
              <div class="w-40">
                <app-selector
                  [options]="accountOptions()"
                  [value]="assignment()[line.id] ?? 0"
                  (valueChange)="assign(line.id, $event)"
                />
              </div>
            </div>
          }
        </div>

        @if (preview(); as p) {
          <div class="space-y-1 rounded-lg border border-border px-3 py-2" data-testid="split-preview">
            @for (a of p.accounts; track a.id) {
              <div class="flex justify-between gap-2">
                <span>{{ a.label }}</span>
                <span class="font-medium">{{ money(a.grand_total) }}</span>
              </div>
            }
            <div class="flex justify-between gap-2 border-t border-border pt-1 font-semibold">
              <span>Total del folio</span>
              <span>{{ money(p.original_total) }}</span>
            </div>
            <p class="flex items-center gap-1 text-xs" [class.text-success]="totalsMatch()" [class.text-error]="!totalsMatch()">
              <app-icon [name]="totalsMatch() ? 'check-circle' : 'alert-circle'" [size]="14" />
              Total de las cuentas = total del folio
            </p>
          </div>
        }
      </div>

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        <app-button variant="ghost" (clicked)="closed.emit()">Volver</app-button>
        <app-button variant="outline" [loading]="busy()" (clicked)="runPreview()" data-testid="split-preview-btn">
          Vista previa
        </app-button>
        <app-button
          variant="primary"
          [loading]="busy()"
          [disabled]="!canConfirm()"
          (clicked)="confirm()"
          data-testid="split-confirm"
        >
          Confirmar división
        </app-button>
      </div>
    </app-modal>
  `,
})
export class FolioSplitModalComponent {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = input<boolean>(false);
  readonly reservationId = input.required<number>();
  /** Folio lines; cancelled ones are ignored. */
  readonly lines = input<FolioLine[]>([]);
  /** Reservation holder: default customer of the second account. */
  readonly holder = input<{ id: number; name: string } | null>(null);
  readonly closed = output<void>();
  /** Emitted once the split exists so the panel reloads folio and split. */
  readonly split = output<SplitResult>();

  readonly accounts = signal<DraftAccount[]>([]);
  /** Line id → account index. */
  readonly assignment = signal<Record<number, number>>({});
  readonly preview = signal<SplitResult | null>(null);
  readonly pickingCustomer = signal<number | null>(null);
  readonly busy = signal(false);
  private requestId = newRequestId();

  readonly activeLines = computed(() => this.lines().filter((l) => !l.cancelled_at));
  readonly accountOptions = computed<SelectorOption[]>(() =>
    this.accounts().map((a, i) => ({ value: i, label: a.label.trim() || `Cuenta ${i + 1}` })),
  );
  readonly totalsMatch = computed(() => {
    const p = this.preview();
    if (!p) return false;
    const sum = p.accounts.reduce((acc, a) => acc + Number(a.grand_total), 0);
    return Math.abs(sum - Number(p.original_total)) < 0.01;
  });
  readonly canConfirm = computed(() => this.preview() !== null && this.totalsMatch() && !this.busy());

  constructor() {
    effect(() => {
      if (this.open()) untracked(() => this.reset());
    });
  }

  money(amount: number | string): string {
    return this.currency.format(Number(amount), 0);
  }

  setLabel(index: number, label: string): void {
    this.accounts.update((list) => list.map((a, i) => (i === index ? { ...a, label } : a)));
    this.preview.set(null);
  }

  setCustomer(index: number, customer: PosCustomer): void {
    const name = customer.legal_name || `${customer.first_name} ${customer.last_name ?? ''}`.trim();
    this.accounts.update((list) =>
      list.map((a, i) => (i === index ? { ...a, customerId: Number(customer.id), customerName: name } : a)),
    );
    this.pickingCustomer.set(null);
    this.preview.set(null);
  }

  addAccount(): void {
    if (this.accounts().length >= MAX_ACCOUNTS) return;
    this.accounts.update((list) => [
      ...list,
      { label: `Cuenta ${list.length + 1}`, customerId: null, customerName: null },
    ]);
    this.preview.set(null);
  }

  removeAccount(index: number): void {
    if (this.accounts().length <= 2) return;
    this.accounts.update((list) => list.filter((_, i) => i !== index));
    // Lines of the removed account move to the first one; later indexes shift down.
    this.assignment.update((map) =>
      Object.fromEntries(
        Object.entries(map).map(([id, i]) => [id, i === index ? 0 : i > index ? i - 1 : i]),
      ),
    );
    this.pickingCustomer.set(null);
    this.preview.set(null);
  }

  assign(lineId: number, account: string | number | null): void {
    this.assignment.update((map) => ({ ...map, [lineId]: Number(account ?? 0) }));
    this.preview.set(null);
  }

  runPreview(): void {
    const accounts = this.buildPayload();
    if (!accounts) return;
    this.busy.set(true);
    this.reservationsService
      .previewFolioSplit(this.reservationId(), accounts)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.preview.set(result);
        },
        error: (message: string) => {
          this.busy.set(false);
          this.toastService.error(message);
        },
      });
  }

  confirm(): void {
    const preview = this.preview();
    const accounts = this.buildPayload();
    if (!preview || !accounts || this.busy()) return;
    this.busy.set(true);
    this.reservationsService
      .confirmFolioSplit(this.reservationId(), {
        accounts,
        source_version: preview.source_version,
        request_id: this.requestId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.toastService.success('Folio dividido');
          this.split.emit(result);
        },
        error: (message: string) => {
          this.busy.set(false);
          this.toastService.error(message);
        },
      });
  }

  /** Every account needs at least one line; the backend validates the rest. */
  private buildPayload(): SplitAccountInput[] | null {
    const map = this.assignment();
    const accounts = this.accounts().map<SplitAccountInput>((a, i) => ({
      ...(a.label.trim() ? { label: a.label.trim() } : {}),
      ...(a.customerId ? { customer_id: a.customerId } : {}),
      order_item_ids: this.activeLines()
        .filter((l) => (map[l.id] ?? 0) === i)
        .map((l) => l.id),
    }));
    if (accounts.some((a) => a.order_item_ids.length === 0)) {
      this.toastService.error('Cada cuenta necesita al menos un ítem');
      return null;
    }
    return accounts;
  }

  /** Nights go to account 1 (company), charges to account 2 (guest). */
  private reset(): void {
    const holder = this.holder();
    this.accounts.set([
      { label: 'Empresa', customerId: null, customerName: null },
      { label: holder?.name ?? 'Huésped', customerId: holder?.id ?? null, customerName: holder?.name ?? null },
    ]);
    this.assignment.set(Object.fromEntries(this.activeLines().map((l) => [l.id, l.kind === 'night' ? 0 : 1])));
    this.preview.set(null);
    this.pickingCustomer.set(null);
    this.busy.set(false);
    this.requestId = newRequestId();
  }
}
