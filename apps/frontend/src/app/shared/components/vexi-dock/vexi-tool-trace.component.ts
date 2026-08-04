import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
} from '@angular/core';
import type { ToolStep } from '../../../core/store/vexi/vexi.actions';
import {
  STORE_MODULE_BY_KEY,
  resolveStoreModule,
} from '../../constants/store-module-catalog.constant';
import { IconComponent } from '../icon/icon.component';

/**
 * What a step actually touched. The distinction is not cosmetic: a data step
 * only *read* the database, while a UI step moved the user's screen. Someone
 * who looks away for five seconds and comes back to a different module has to
 * be able to read in the trace that Vexi navigated, not guess it.
 *
 * The backend marks client-side tools with the `ui_` prefix and refuses to
 * execute them server-side (`ai-engine/tools/domains/ui.tools.ts`), so the
 * prefix is the contract, not a naming coincidence.
 */
type StepKind = 'data' | 'ui';

const isUiStep = (name: string): boolean => name.startsWith('ui_');

/** Reads a string argument, tolerating the model sending a number. */
function argText(
  args: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = args?.[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Human label for a module key. Falls back to the free-text resolver because
 * the model sometimes passes "punto de venta" where the tool wants `pos`.
 */
function moduleLabel(args: Record<string, unknown> | undefined): string {
  const key = argText(args, 'module_key');
  if (!key) return 'ese módulo';
  return STORE_MODULE_BY_KEY[key]?.label ?? resolveStoreModule(key)?.label ?? key;
}

/**
 * Noun phrase each read tool works on. Kept as a phrase (not a verb) so the
 * tense lives in one place and "Consulto X" / "Consulté X" both read well.
 */
const DATA_SUBJECTS: Record<string, string> = {
  find_product: 'el producto',
  get_product: 'la ficha del producto',
  list_products: 'tu catálogo',
  get_product_pricing: 'los precios del producto',
  semantic_search: 'tu información',

  get_stock_levels: 'el stock',
  get_low_stock_alerts: 'las alertas de stock bajo',
  check_stock_availability: 'la disponibilidad',
  get_stock_movements: 'los movimientos de inventario',
  get_stock_adjustments: 'los ajustes de inventario',
  get_inventory_locations: 'tus ubicaciones',

  find_customer: 'el cliente',
  get_customer_history: 'el historial del cliente',
  get_customer_segments: 'tus segmentos de clientes',

  find_order: 'la orden',
  get_order: 'la orden',
  list_orders: 'tus órdenes',
  get_dispatch_status: 'el estado de despacho',

  get_sales_report: 'el informe de ventas',
  get_top_products: 'tus productos más vendidos',
  get_cash_session_status: 'la caja',
  get_business_snapshot: 'el pulso del negocio',
  get_store_profile: 'la ficha de la tienda',

  get_balance_sheet: 'el balance general',
  get_income_statement: 'el estado de resultados',
  get_trial_balance: 'la balanza de comprobación',
  get_account_ledger: 'el libro mayor',
  get_recent_journal_entries: 'los asientos recientes',
  find_puc_account: 'la cuenta PUC',
  get_vat_summary: 'el resumen de IVA',
  list_fiscal_periods: 'tus periodos fiscales',
};

/** `get_low_stock_alerts` → `low stock alerts`, for tools with no entry yet. */
function prettifyToolName(name: string): string {
  return name
    .replace(/^(get|list|find|check|create)_/, '')
    .replace(/_/g, ' ')
    .trim();
}

/**
 * One line of the trace, in the user's language.
 *
 * `running` is present tense and `done` is past tense on purpose: the same row
 * is reused as the step resolves, so the tense is the only thing that tells
 * the user whether Vexi is still working or already finished.
 */
function narrate(step: ToolStep): string {
  const running = step.status === 'running';
  const args = step.arguments;

  // A failed step must never be narrated in the past tense of success. The rows
  // below all read as accomplished facts ("Te llevé a Productos", "Ajusté la
  // pantalla"), and pairing one of those with a failure marker told the user
  // Vexi did something it did not do — seen with an invented tool name reported
  // as "Ajusté la pantalla (ui find product)".
  if (step.status === 'failed') {
    return `No pude usar ${prettifyToolName(step.name)}`;
  }

  if (isUiStep(step.name)) {
    switch (step.name) {
      case 'ui_navigate': {
        const label = moduleLabel(args);
        return running ? `Te llevo a ${label}` : `Te llevé a ${label}`;
      }
      case 'ui_pos_add_item': {
        const query = argText(args, 'query') || 'el producto';
        const qty = Number(args?.['quantity']);
        const what = Number.isFinite(qty) && qty > 1 ? `${qty} × ${query}` : query;
        return running ? `Agrego ${what} al carrito` : `Añadí ${what}`;
      }
      case 'ui_pos_remove_item': {
        const query = argText(args, 'query') || 'la línea';
        return running
          ? `Quito ${query} del carrito`
          : `Quité ${query} del carrito`;
      }
      case 'ui_pos_set_customer': {
        const query = argText(args, 'query');
        const who = query ? ` ${query}` : '';
        return running
          ? `Asigno el cliente${who} a la venta`
          : `Asigné el cliente${who} a la venta`;
      }
      case 'ui_pos_read_cart':
        return running ? 'Reviso el carrito' : 'Revisé el carrito';
      case 'ui_list_modules':
        return running
          ? 'Reviso qué módulos tienes'
          : 'Revisé qué módulos tienes';
      case 'ui_explain_module': {
        const label = moduleLabel(args);
        return running ? `Miro qué hace ${label}` : `Revisé qué hace ${label}`;
      }
      case 'ui_why_hidden': {
        const label = moduleLabel(args);
        return running
          ? `Averiguo por qué no ves ${label}`
          : `Averigüé por qué no ves ${label}`;
      }
      case 'ui_refresh':
        return running
          ? 'Actualizo lo que tienes en pantalla'
          : 'Actualicé lo que tienes en pantalla';
      default:
        return running
          ? `Ajusto la pantalla (${prettifyToolName(step.name)})`
          : `Ajusté la pantalla (${prettifyToolName(step.name)})`;
    }
  }

  if (step.name === 'create_stock_adjustment') {
    return running
      ? 'Preparo un ajuste de inventario'
      : 'Registré el ajuste de inventario';
  }

  const subject = DATA_SUBJECTS[step.name] ?? prettifyToolName(step.name);
  return running ? `Consulto ${subject}` : `Consulté ${subject}`;
}

interface TraceRow {
  id: string;
  kind: StepKind;
  status: ToolStep['status'];
  text: string;
  summary: string;
}

@Component({
  selector: 'app-vexi-tool-trace',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <div
        class="vexi-trace"
        [class.vexi-trace--running]="running()"
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          class="vexi-trace__toggle"
          (click)="expanded.set(!expanded())"
          [attr.aria-expanded]="expanded()"
        >
          @if (running()) {
            <app-icon name="loader-2" [size]="13" [spin]="true" />
          } @else {
            <app-icon name="sparkles" [size]="13" />
          }
          <span class="vexi-trace__summary">{{ summary() }}</span>
          <app-icon
            [name]="expanded() ? 'chevron-up' : 'chevron-down'"
            [size]="13"
          />
        </button>

        @if (expanded()) {
          <ol class="vexi-trace__list">
            @for (row of rows(); track row.id) {
              <li
                class="vexi-step"
                [class.vexi-step--ui]="row.kind === 'ui'"
                [class.vexi-step--failed]="row.status === 'failed'"
              >
                <span class="vexi-step__status" aria-hidden="true">
                  @switch (row.status) {
                    @case ('running') {
                      <app-icon name="loader-2" [size]="12" [spin]="true" />
                    }
                    @case ('failed') {
                      <app-icon name="x-circle" [size]="12" />
                    }
                    @default {
                      <app-icon name="check" [size]="12" />
                    }
                  }
                </span>

                <span class="vexi-step__kind" aria-hidden="true">
                  @if (row.kind === 'ui') {
                    <app-icon name="mouse-pointer-click" [size]="12" />
                  } @else {
                    <app-icon name="database" [size]="12" />
                  }
                </span>

                <span class="vexi-step__body">
                  <span class="vexi-step__text">
                    <span class="vexi-step__sr">{{
                      row.kind === 'ui' ? 'Acción en pantalla: ' : 'Consulta: '
                    }}</span>
                    {{ row.text }}
                    @if (row.status === 'failed') {
                      <span class="vexi-step__failed-tag">— no se pudo</span>
                    }
                  </span>
                  @if (row.summary) {
                    <span class="vexi-step__detail">{{ row.summary }}</span>
                  }
                </span>
              </li>
            }
          </ol>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .vexi-trace {
        border: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
        border-radius: 12px;
        background: var(--color-surface-secondary, rgba(0, 0, 0, 0.03));
        overflow: hidden;
      }

      .vexi-trace--running {
        border-color: rgba(var(--color-primary-rgb, 46, 204, 113), 0.35);
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.07);
      }

      .vexi-trace__toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-height: 32px;
        padding: 7px 10px;
        border: 0;
        background: transparent;
        color: var(--color-text-secondary, inherit);
        font-size: 0.75rem;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
      }

      .vexi-trace__toggle:hover {
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.08);
      }

      .vexi-trace__toggle:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.7);
        outline-offset: -2px;
      }

      .vexi-trace__summary {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vexi-trace__list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin: 0;
        padding: 2px 10px 9px;
        list-style: none;
      }

      .vexi-step {
        display: grid;
        grid-template-columns: 14px 14px 1fr;
        align-items: start;
        gap: 6px;
        font-size: 0.74rem;
        line-height: 1.35;
        color: var(--color-text-secondary, inherit);
      }

      .vexi-step__status,
      .vexi-step__kind {
        display: grid;
        place-items: center;
        padding-top: 1px;
        opacity: 0.75;
      }

      /* A screen action gets the tenant primary so it reads as "Vexi touched
         your screen" even at a glance; a read stays neutral. Colour is never
         the only signal — the kind icon and the prefixed screen-reader text
         carry the same information. */
      .vexi-step--ui {
        color: var(--color-text-primary, inherit);
      }

      .vexi-step--ui .vexi-step__kind {
        color: var(--color-primary, #2ecc71);
        opacity: 1;
      }

      .vexi-step--failed .vexi-step__status {
        color: var(--color-error, #ef4444);
        opacity: 1;
      }

      .vexi-step__body {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .vexi-step__failed-tag {
        color: var(--color-error, #ef4444);
      }

      .vexi-step__detail {
        font-size: 0.7rem;
        opacity: 0.65;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Visually hidden but announced: the kind prefix must reach screen
         readers, where the icon and the colour do not. */
      .vexi-step__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
})
export class VexiToolTraceComponent {
  readonly steps = input<ToolStep[]>([]);

  protected readonly running = computed(() =>
    this.steps().some((step) => step.status === 'running'),
  );

  /**
   * Open while Vexi works, collapsed the moment it stops.
   *
   * `linkedSignal` is what makes that automatic *and* overridable: the user can
   * expand a finished trace, and the next turn resets it — a plain `signal`
   * would keep the previous turn's choice, and a plain `computed` would refuse
   * the manual toggle altogether.
   */
  protected readonly expanded = linkedSignal(() => this.running());

  protected readonly rows = computed<TraceRow[]>(() =>
    this.steps().map((step) => ({
      id: step.id,
      kind: isUiStep(step.name) ? ('ui' as const) : ('data' as const),
      status: step.status,
      text: narrate(step),
      summary: step.status === 'running' ? '' : (step.summary ?? '').trim(),
    })),
  );

  protected readonly summary = computed(() => {
    const rows = this.rows();
    if (this.running()) {
      const current = rows.find((row) => row.status === 'running');
      return current ? current.text + '…' : 'Trabajando…';
    }

    // Failed steps are counted apart, never as work done. Otherwise a single
    // step that failed reads "Toqué la pantalla 1 vez · 1 no se pudo" — the
    // same event tallied twice, once as an accomplishment.
    const succeeded = rows.filter((row) => row.status !== 'failed');
    const ui = succeeded.filter((row) => row.kind === 'ui').length;
    const data = succeeded.length - ui;
    const failed = rows.length - succeeded.length;

    const parts: string[] = [];
    if (data) {
      parts.push(data === 1 ? 'consulté 1 dato' : `consulté ${data} datos`);
    }
    if (ui) {
      parts.push(
        ui === 1 ? 'toqué la pantalla 1 vez' : `toqué la pantalla ${ui} veces`,
      );
    }

    // Nothing succeeded: "Sin pasos · 1 no se pudo" contradicts itself, so the
    // failure count carries the whole sentence instead of qualifying one.
    if (!parts.length && failed) {
      return failed === 1 ? 'Un intento falló' : `${failed} intentos fallaron`;
    }

    const sentence = parts.length ? parts.join(' y ') : 'sin pasos';
    const text = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    if (!failed) return text;
    return failed === 1
      ? `${text} · 1 no se pudo`
      : `${text} · ${failed} no se pudieron`;
  });
}
