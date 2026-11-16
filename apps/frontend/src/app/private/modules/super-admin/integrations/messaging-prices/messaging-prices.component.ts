import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components';
import {
  MessagingPriceSource,
  MessagingPriceTable,
  MessagingPricesView,
  UpdateMessagingPricesDto,
} from './interfaces/messaging-prices.interface';
import { MessagingPricesService } from './services/messaging-prices.service';

export type TableKey = 'sms_price_table' | 'whatsapp_price_table';
export type ScalarKey =
  | 'sms_max_price_usd'
  | 'sms_max_price_margin'
  | 'email_price_usd';
export type FieldKey = TableKey | ScalarKey;

export interface PriceRow {
  id: number;
  country: string;
  price: string;
}

export interface RowErrors {
  country?: string;
  price?: string;
}

const COUNTRY_RE = /^\d{1,4}$/;

export const SOURCE_LABELS: Record<MessagingPriceSource, string> = {
  platform_settings: 'Panel',
  environment: 'Entorno',
  default: 'Por defecto',
};

/** Parses a user-typed decimal ("0.0509" or "0,0509"); NaN when invalid or not finite. */
export function parseDecimal(raw: string): number {
  const text = raw.trim().replace(',', '.');
  if (!text || !/^\d*\.?\d+$|^\d+\.$/.test(text)) return NaN;
  const value = Number(text);
  // A huge digit string overflows to Infinity, which JSON sends as null ("use fallback").
  return Number.isFinite(value) ? value : NaN;
}

/** USD with up to 4 decimals and es-CO separators (never store currency). */
export function formatUsd(value: number): string {
  return value.toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/**
 * Super admin page: Integraciones → Precios de mensajería.
 * Draft state lives in signals; native inputs avoid ReactiveForms state that
 * would not be reactive inside computed().
 */
@Component({
  selector: 'app-messaging-prices',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, ButtonComponent, IconComponent],
  templateUrl: './messaging-prices.component.html',
})
export class MessagingPricesComponent {
  private readonly service = inject(MessagingPricesService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  private nextRowId = 1;

  readonly sourceLabels = SOURCE_LABELS;
  readonly formatUsd = formatUsd;

  readonly tableSections: {
    key: TableKey;
    title: string;
    priceHeader: string;
    fallbackKey: 'sms_per_segment_usd' | 'whatsapp_per_message_usd';
    fallbackUnit: string;
  }[] = [
    {
      key: 'sms_price_table',
      title: 'Precio de SMS por país',
      priceHeader: 'USD por segmento',
      fallbackKey: 'sms_per_segment_usd',
      fallbackUnit: 'segmento',
    },
    {
      key: 'whatsapp_price_table',
      title: 'Precio de WhatsApp por país',
      priceHeader: 'USD por mensaje',
      fallbackKey: 'whatsapp_per_message_usd',
      fallbackUnit: 'mensaje',
    },
  ];

  readonly smsCapFields: { key: ScalarKey; label: string; hint: string }[] = [
    {
      key: 'sms_max_price_usd',
      label: 'Tope por SMS (USD)',
      hint: 'Máximo que se autoriza a AWS por cada SMS.',
    },
    {
      key: 'sms_max_price_margin',
      label: 'Margen del tope',
      hint: 'Multiplicador sobre el costo del SMS; mínimo 1.',
    },
  ];
  readonly emailFields: { key: ScalarKey; label: string; hint: string }[] = [
    {
      key: 'email_price_usd',
      label: 'USD por correo',
      hint: 'Precio de cada correo enviado en campañas.',
    },
  ];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly view = signal<MessagingPricesView | null>(null);

  readonly rows = {
    sms_price_table: signal<PriceRow[]>([]),
    whatsapp_price_table: signal<PriceRow[]>([]),
  };
  readonly scalars = signal<Record<ScalarKey, string>>({
    sms_max_price_usd: '',
    sms_max_price_margin: '',
    email_price_usd: '',
  });
  /** Fields the user marked "Usar respaldo": sent as null on save. */
  readonly cleared = signal<ReadonlySet<FieldKey>>(new Set());

  readonly canRead = computed(() => this.hasAccess('read'));
  readonly canWrite = computed(() => this.hasAccess('write'));

  readonly tableErrors = {
    sms_price_table: computed(() => this.validateRows(this.rows.sms_price_table())),
    whatsapp_price_table: computed(() =>
      this.validateRows(this.rows.whatsapp_price_table()),
    ),
  };

  readonly scalarErrors = computed(() => {
    const s = this.scalars();
    const cleared = this.cleared();
    const errors: Partial<Record<ScalarKey, string>> = {};
    const check = (key: ScalarKey, ok: (n: number) => boolean, msg: string) => {
      if (cleared.has(key)) return;
      if (!ok(parseDecimal(s[key]))) errors[key] = msg;
    };
    check('sms_max_price_usd', (n) => n > 0, 'Debe ser un número mayor que 0');
    check('sms_max_price_margin', (n) => n >= 1, 'Debe ser un número de 1 o más');
    check('email_price_usd', (n) => n > 0, 'Debe ser un número mayor que 0');
    return errors;
  });

  readonly hasErrors = computed(
    () =>
      Object.keys(this.scalarErrors()).length > 0 ||
      this.tableHasErrors(this.tableErrors.sms_price_table().errors) ||
      this.tableHasErrors(this.tableErrors.whatsapp_price_table().errors),
  );

  /** PATCH body with only the changed fields; empty when nothing changed. */
  readonly changes = computed<UpdateMessagingPricesDto>(() =>
    this.hasErrors() ? {} : this.buildChanges(),
  );
  readonly hasChanges = computed(() => Object.keys(this.changes()).length > 0);
  readonly canSave = computed(
    () =>
      this.canWrite() &&
      !this.saving() &&
      !this.hasErrors() &&
      this.hasChanges(),
  );

  constructor() {
    if (this.canRead()) {
      this.load();
    } else {
      this.loading.set(false);
    }
  }

  load(): void {
    this.loading.set(true);
    this.service
      .getPrices()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (view) => {
        this.applyView(view);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(parseApiError(err).userMessage);
      },
    });
  }

  valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  sourceOf(key: FieldKey): MessagingPriceSource | null {
    const v = this.view();
    return v ? v[key].source : null;
  }

  isPanel(key: FieldKey): boolean {
    return this.sourceOf(key) === 'platform_settings' && !this.cleared().has(key);
  }

  isCleared(key: FieldKey): boolean {
    return this.cleared().has(key);
  }

  addRow(key: TableKey): void {
    this.rows[key].update((rows) => [
      ...rows,
      { id: this.nextRowId++, country: '', price: '' },
    ]);
  }

  removeRow(key: TableKey, id: number): void {
    this.rows[key].update((rows) => rows.filter((r) => r.id !== id));
  }

  updateRow(key: TableKey, id: number, field: 'country' | 'price', value: string): void {
    this.rows[key].update((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );
    this.unmark(key);
  }

  /** Typed accessors: the scalar ng-template context (`let-field`) is untyped. */
  scalarValue(key: ScalarKey): string {
    return this.scalars()[key];
  }

  scalarError(key: ScalarKey): string | undefined {
    return this.scalarErrors()[key];
  }

  updateScalar(key: ScalarKey, value: string): void {
    this.scalars.update((s) => ({ ...s, [key]: value }));
    this.unmark(key);
  }

  /** "Usar respaldo": the field is removed from the panel on save. */
  useFallback(key: FieldKey): void {
    this.cleared.update((set) => new Set(set).add(key));
  }

  undoFallback(key: FieldKey): void {
    this.unmark(key);
  }

  save(): void {
    if (!this.canSave()) return;
    const dto = this.changes();
    this.saving.set(true);
    this.service
      .updatePrices(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (view) => {
        this.saving.set(false);
        this.applyView(view);
        this.toast.success('Precios de mensajería guardados');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(parseApiError(err).userMessage);
      },
    });
  }

  private unmark(key: FieldKey): void {
    if (!this.cleared().has(key)) return;
    this.cleared.update((set) => {
      const next = new Set(set);
      next.delete(key);
      return next;
    });
  }

  private tableHasErrors(errors: Record<number, RowErrors>): boolean {
    return Object.keys(errors).length > 0;
  }

  /** Per-row errors plus the parsed table (null when there are errors). */
  private validateRows(rows: PriceRow[]): {
    errors: Record<number, RowErrors>;
    table: MessagingPriceTable | null;
  } {
    const errors: Record<number, RowErrors> = {};
    const table: MessagingPriceTable = {};
    const seen = new Map<string, number>();

    for (const row of rows) {
      const country = row.country.trim().toLowerCase();
      const rowErrors: RowErrors = {};

      if (country !== 'default' && !COUNTRY_RE.test(country)) {
        rowErrors.country = 'Usa de 1 a 4 dígitos o "default"';
      } else if (seen.has(country)) {
        rowErrors.country = 'Código repetido';
        errors[seen.get(country) as number] = {
          ...errors[seen.get(country) as number],
          country: 'Código repetido',
        };
      } else {
        seen.set(country, row.id);
      }

      const price = parseDecimal(row.price);
      if (!(price > 0)) rowErrors.price = 'Debe ser mayor que 0';

      if (rowErrors.country || rowErrors.price) {
        errors[row.id] = { ...errors[row.id], ...rowErrors };
      } else {
        table[country] = price;
      }
    }

    return {
      errors,
      table: Object.keys(errors).length === 0 ? table : null,
    };
  }

  private buildChanges(): UpdateMessagingPricesDto {
    const view = this.view();
    const dto: UpdateMessagingPricesDto = {};
    if (!view) return dto;
    const cleared = this.cleared();

    for (const key of ['sms_price_table', 'whatsapp_price_table'] as TableKey[]) {
      if (cleared.has(key)) {
        dto[key] = null;
        continue;
      }
      const table = this.tableErrors[key]().table ?? {};
      if (!this.sameTable(table, view[key].value)) {
        dto[key] = Object.keys(table).length ? table : null;
      }
    }

    const s = this.scalars();
    for (const key of [
      'sms_max_price_usd',
      'sms_max_price_margin',
      'email_price_usd',
    ] as ScalarKey[]) {
      if (cleared.has(key)) {
        dto[key] = null;
        continue;
      }
      const n = parseDecimal(s[key]);
      if (n !== view[key].value) dto[key] = n;
    }
    return dto;
  }

  private sameTable(a: MessagingPriceTable, b: MessagingPriceTable): boolean {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
  }

  private toRows(table: MessagingPriceTable): PriceRow[] {
    return Object.entries(table).map(([country, price]) => ({
      id: this.nextRowId++,
      country,
      price: String(price),
    }));
  }

  private applyView(view: MessagingPricesView): void {
    this.view.set(view);
    this.rows.sms_price_table.set(this.toRows(view.sms_price_table.value));
    this.rows.whatsapp_price_table.set(this.toRows(view.whatsapp_price_table.value));
    this.scalars.set({
      sms_max_price_usd: String(view.sms_max_price_usd.value),
      sms_max_price_margin: String(view.sms_max_price_margin.value),
      email_price_usd: String(view.email_price_usd.value),
    });
    this.cleared.set(new Set());
  }

  private hasAccess(kind: 'read' | 'write'): boolean {
    return (
      this.auth.hasPermission(`superadmin:messaging:prices:${kind}`) ||
      this.auth.hasRole('super_admin')
    );
  }
}

