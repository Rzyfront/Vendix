import {
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Observable, of, startWith } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../shared/components';
import {
  DOCUMENT_TYPES,
  isValidDocumentType,
} from '../../../../../../shared/constants/document-types';
import { computeDocumentFormatHint } from '../../utils/document-format-hint.util';
import { computePhoneFormatHint } from '../../utils/phone-format-hint.util';
import { PosCustomerService } from '../../services/pos-customer.service';
import {
  CreatePosCustomerRequest,
  PosCustomer,
} from '../../models/customer.model';

/**
 * Vistas internas del selector. QUI-723 eliminated the 'create' drill-in:
 * search + create became a single unified flow where the cashier types data
 * and the host's "Siguiente" calls `resolveIfNeeded()` to find-or-create.
 */
export type CustomerSelectorView = 'overview' | 'search';

/**
 * Selector de cliente reutilizable para flujos POS (pago, crear-orden, envío).
 *
 * QUI-723 — Vista unificada: ya no hay drill-in separado para "Crear cliente".
 * El cajero tipea email / cédula / nombre en el formulario del sub-step
 * "BUSCAR CLIENTE" y el botón "Siguiente" del anfitrión dispara
 * `resolveIfNeeded()`, que hace find-or-create en backend en un solo paso.
 *
 * Zoneless + Signals: todo el estado leído por el template es signal-based.
 */
@Component({
  selector: 'app-pos-customer-selector',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    SelectorComponent,
  ],
  templateUrl: './pos-customer-selector.component.html',
  styleUrl: './pos-customer-selector.component.scss',
})
export class PosCustomerSelectorComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly customerService = inject(PosCustomerService);
  private readonly toastService = inject(ToastService);

  // ── Inputs ──────────────────────────────────────────────────────────
  readonly selectedCustomer = input<PosCustomer | null>(null);
  readonly allowAnonymous = input<boolean>(false);
  readonly searchLimit = input<number>(10);
  readonly compact = input<boolean>(true);
  readonly initialView = input<CustomerSelectorView>('overview');
  /**
   * When true, the 'search' view pre-shows the top customers (by order volume)
   * while the query is empty, and — on first render with no customer already
   * selected — the selector opens directly on the search view. Gated so other
   * hosts (open-table / assign-customer modals) keep the default overview.
   */
  readonly showTopSuggestions = input<boolean>(false);

  // ── Outputs ─────────────────────────────────────────────────────────
  readonly customerSelected = output<PosCustomer>();
  readonly customerCleared = output<void>();

  // ── View-state machine ──────────────────────────────────────────────
  readonly view = signal<CustomerSelectorView>('overview');
  /**
   * Segmented mode inside the `search` view — separates the two user intents
   * without stacking them on a shared scroll. `search` = compressed 3-item
   * lookup; `create` = isolated creation form that advances via wizard.
   */
  readonly activeTab = signal<'search' | 'create'>('search');

  // ── Internal signals ────────────────────────────────────────────────
  readonly results = signal<PosCustomer[]>([]);
  readonly isSearching = signal(false);
  readonly searchPerformed = signal(false);
  /** QUI-723: in-flight flag while the unified resolveCustomer call runs. */
  readonly resolving = signal(false);
  /** Texto tipeado actual (para que Enter dispare búsqueda inmediata). */
  private readonly query = signal('');
  /** Última consulta efectiva (reservada para futuros prefill heurísticos). */
  readonly lastQuery = signal('');

  // ── Top-suggestions (clientes más frecuentes) ───────────────────────
  /** Top-3 clientes por volumen de órdenes (carga on-init si showTopSuggestions). */
  readonly topCustomers = signal<PosCustomer[]>([]);
  readonly loadingTop = signal(false);
  /** Guard one-shot para la inicialización de vista + carga de top-3. */
  private topInitialized = false;

  /**
   * Muestra el bloque de sugeridos: pedido explícitamente, buscador vacío
   * (query < 2 chars) y sin una búsqueda en curso. Cuando el operador escribe
   * (≥2 chars) los resultados de búsqueda reemplazan a los sugeridos.
   */
  readonly showingSuggestions = computed(
    () =>
      this.showTopSuggestions() &&
      this.query().trim().length < 2 &&
      !this.isSearching(),
  );

  /** Compressed slices — enforce 3-item MAX without scroll. */
  readonly topCustomersSlice = computed(() => this.topCustomers().slice(0, 3));
  readonly resultsSlice = computed(() => this.results().slice(0, 3));
  readonly resultsOverflow = computed(() =>
    Math.max(0, this.results().length - this.resultsSlice().length),
  );

  /** Opciones del selector de tipo de documento (single source of truth). */
  readonly documentTypeOptions: SelectorOption[] = DOCUMENT_TYPES.map(
    (opt) => ({ value: opt.code, label: opt.label }),
  );

  /**
   * QUI-723 — Real-time hint for the document number input.
   *
   * Surfaces three things as the cashier types (dev lead's audio):
   *   1. How many digits they've entered.
   *   2. How many are still missing (or how many are over the max).
   *   3. The full min–max range for the selected document type.
   *
   * Three visual states:
   *   - Empty input            → null (no hint).
   *   - Below min or above max → "info" tone with shortfall / overflow.
   *   - Inside the range       → "ok" tone confirming the count is valid.
   *
   * Pure info: the submit gate `canResolve()` does NOT block on this.
   * Format-tolerant backend (ResolveCustomerDto) still accepts the input
   * even when it sits outside the standard range — the hint is purely a
   * cashier-side aid, matching the lead's "un mismo paso" intent.
   *
   * The pure logic lives in `utils/document-format-hint.util.ts` so it
   * can be unit-tested without TestBed.
   */
  readonly documentFormatHint = computed(() => {
    const v = this.formValues() as {
      documentType?: string | null;
      documentNumber?: string | null;
    };
    return computeDocumentFormatHint(
      v?.documentType ?? null,
      v?.documentNumber ?? null,
    );
  });

  /**
   * QUI-723 — Live counter for the phone input. Dev lead's spec:
   * "el número de teléfono son 10" — Colombian mobile numbers are
   * exactly 10 digits, no country prefix. Pure info — does NOT block
   * submit. Backend `CreateCustomerDto.phone` enforces exactly 10
   * digits on creation; the resolve endpoint stays lenient so the
   * cashier can find legacy customers with any format.
   */
  readonly phoneFormatHint = computed(() => {
    const v = this.formValues() as { phone?: string | null };
    return computePhoneFormatHint(v?.phone ?? null);
  });

  // ── Form ────────────────────────────────────────────────────────────
  // QUI-723 — All fields are optional: the cashier may submit the form with
  // just an email, just a document, or both. The backend resolves the match
  // priority (email first, then exact document) and creates a new row only
  // when no match is found. `canResolve` enforces "at least one identifier".
  readonly form: FormGroup = this.fb.group({
    email: ['', [Validators.email]],
    firstName: [''],
    lastName: [''],
    phone: [''],
    documentType: [''],
    documentNumber: [''],
  });

  /** Estado de validez del form como signal (Zoneless-safe). */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  /**
   * QUI-737/734 (B.4) — bridge reactivo del `form.value`. Leer `form.value`
   * directo dentro de un `computed()` lo congela (no es una señal): los hints
   * `documentFormatHint`/`phoneFormatHint` y `canResolve` se recalculaban solo
   * con el estado inicial. Este `valueChanges` bridged hace que cualquier
   * tecleo re-renderice el computed.
   */
  private readonly formValues = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.value)),
    { initialValue: this.form.value },
  );

  /**
   * Submit gate: form is submittable when the cashier provided at least one
   * identifier — a valid email OR (document_type + document_number) OR a name
   * (QUI-734, B.4 quick-sale por nombre). Format validation is intentionally
   * non-blocking: the dev lead's spec was "un mismo paso se va todo" (one step,
   * don't add friction), so even a non-canonical document number is submitted —
   * the lookup may still find a legacy customer, and the format-hint chip
   * already warns the cashier before they hit Siguiente.
   */
  readonly canResolve = computed(() => {
    if (this.resolving()) return false;
    const v = this.formValues() as {
      email?: string | null;
      documentType?: string | null;
      documentNumber?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    };
    const hasEmail = !!v.email?.trim() && this.formStatus() === 'VALID';
    const hasDocument = !!v.documentType && !!v.documentNumber?.trim();
    const hasName = !!v.firstName?.trim();
    return hasEmail || hasDocument || hasName;
  });

  constructor() {
    // One-shot: aplica la vista inicial e (si corresponde) arranca directo en
    // búsqueda con las sugerencias top-5. Un `effect` (no el constructor) porque
    // los inputs de señal se enlazan DESPUÉS de construir: leerlos aquí sí ve el
    // valor real que pasó el anfitrión. Escrituras dentro de `untracked`.
    effect(() => {
      const wantTop = this.showTopSuggestions();
      const initial = this.initialView();
      const hasCustomer = !!this.selectedCustomer();
      untracked(() => {
        if (this.topInitialized) return;
        this.topInitialized = true;
        if (initial !== 'overview') {
          this.view.set(initial);
        } else if (wantTop && !hasCustomer) {
          // Sin cliente aún → mostramos el buscador (con top-5) directamente.
          this.view.set('search');
        }
        if (wantTop) this.loadTopCustomers();
      });
    });
  }

  /** Carga perezosa e idempotente del top-3 comprimido (solo cuando showTopSuggestions). */
  private loadTopCustomers(): void {
    if (this.topCustomers().length > 0 || this.loadingTop()) return;
    this.loadingTop.set(true);
    this.customerService
      .topCustomers(3)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.topCustomers.set((list ?? []).slice(0, 3));
          this.loadingTop.set(false);
        },
        error: () => {
          this.topCustomers.set([]);
          this.loadingTop.set(false);
        },
      });
  }

  // ── Navegación ──────────────────────────────────────────────────────
  goToSearch(): void {
    this.activeTab.set('search');
    this.view.set('search');
  }

  back(): void {
    this.view.set('overview');
  }

  setActiveTab(tab: 'search' | 'create'): void {
    this.activeTab.set(tab);
  }

  // ── Búsqueda ────────────────────────────────────────────────────────
  /** (search) debounced del inputsearch: cada pulsación filtrada. */
  onSearch(query: string): void {
    this.query.set(query);
    this.runSearch(query);
  }

  /** (enter) del inputsearch: búsqueda inmediata del texto actual. */
  onSearchEnter(): void {
    this.runSearch(this.query());
  }

  onClear(): void {
    this.query.set('');
    this.results.set([]);
    this.searchPerformed.set(false);
  }

  private runSearch(rawQuery: string): void {
    const query = (rawQuery ?? '').trim();
    if (query.length < 2) {
      this.results.set([]);
      this.searchPerformed.set(false);
      this.isSearching.set(false);
      return;
    }

    this.lastQuery.set(query);
    this.isSearching.set(true);

    this.customerService
      .searchCustomers({ query, limit: this.searchLimit() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.results.set(response.data || []);
          this.searchPerformed.set(true);
          this.isSearching.set(false);
        },
        error: () => {
          this.results.set([]);
          this.searchPerformed.set(true);
          this.isSearching.set(false);
          this.toastService.error('Error al buscar clientes');
        },
      });
  }

  selectCustomer(customer: PosCustomer): void {
    this.customerSelected.emit(customer);
    this.view.set('overview');
  }

  clearCustomer(): void {
    this.customerCleared.emit();
    this.view.set('overview');
  }

  // ── Resolución unificada (QUI-723) ──────────────────────────────────
  /**
   * Public entry point used by the host's "Siguiente" button. Returns
   * `true` when the customer was resolved (existing or freshly created)
   * and emitted through `customerSelected`; `false` when the cashier has
   * not provided enough data to resolve (no email AND no document).
   *
   * - If a customer was already selected on the cart, this returns `true`
   *   without re-running the lookup — the cashier's edits to the form are
   *   ignored, matching the previous "no-op when already chosen" semantics.
   * - Otherwise, it calls `resolveCustomer` (find-or-create on the backend)
   *   and emits the resulting customer via `customerSelected`.
   *
   * The Observable completes synchronously in both paths so the host can
   * `await` (or subscribe-and-flag) without juggling timers.
   */
  resolveIfNeeded(): Observable<boolean> {
    if (this.selectedCustomer()) {
      return of(true);
    }
    if (!this.canResolve()) {
      this.markFormTouched();
      this.toastService.info(
        'Ingresa un email, un documento o un nombre para continuar',
      );
      return of(false);
    }

    const value = this.form.value;
    const hasEmail = !!value.email?.trim();
    const hasDocument = !!(value.documentType && value.documentNumber?.trim());
    const request: CreatePosCustomerRequest = {
      email: value.email?.trim() || undefined,
      first_name: value.firstName?.trim() || undefined,
      last_name: value.lastName?.trim() || undefined,
      phone: value.phone?.trim() || undefined,
      document_type: value.documentType || undefined,
      document_number: value.documentNumber?.trim() || undefined,
      // QUI-734 (B.4) — quick-sale por nombre: solo cuando NO hay email ni
      // documento (la prioridad de match es email → documento → nombre).
      name_only: !hasEmail && !hasDocument ? true : undefined,
    };

    this.resolving.set(true);

    return this.customerService.resolveCustomer(request).pipe(
      map(
        ({
          customer,
          was_created,
          was_updated,
        }): boolean => {
          this.customerSelected.emit(customer);
          this.view.set('overview');
          this.form.reset();
          this.resolving.set(false);
          if (was_created) {
            this.toastService.success('Cliente creado correctamente');
          } else if (was_updated) {
            this.toastService.success('Cliente actualizado con los nuevos datos');
          } else {
            // Match found but nothing to update — close the feedback loop so
            // the cashier sees confirmation that the existing customer was
            // reused (otherwise the wizard advances silently).
            const name =
              [customer.first_name, customer.last_name]
                .filter(Boolean)
                .join(' ')
                .trim() || customer.email || 'seleccionado';
            this.toastService.success(`Cliente encontrado: ${name}`);
          }
          return true;
        },
      ),
      catchError((error: unknown) => {
        this.resolving.set(false);
        this.toastService.error(this.resolveErrorMessage(error));
        return of(false);
      }),
    );
  }

  /**
   * Backward-compatible alias used by any hosts that still pass through the
   * form's `(ngSubmit)` event. New hosts should call `resolveIfNeeded()`
   * from their "Siguiente" handler.
   */
  onResolve(): void {
    this.resolveIfNeeded().subscribe();
  }

  private markFormTouched(): void {
    Object.keys(this.form.controls).forEach((key) =>
      this.form.get(key)?.markAsTouched(),
    );
  }

  private resolveErrorMessage(error: unknown): string {
    const err = error as
      | { error?: { message?: string }; message?: string }
      | undefined;
    return err?.error?.message || err?.message || 'Error al resolver cliente';
  }

  /** Limpia el form, resultados y vuelve a 'overview'. Los anfitriones lo llaman al cerrar el modal. */
  reset(): void {
    this.form.reset();
    this.results.set([]);
    this.isSearching.set(false);
    this.searchPerformed.set(false);
    this.resolving.set(false);
    this.query.set('');
    this.lastQuery.set('');
    this.activeTab.set('search');
    this.view.set('overview');
  }
}
