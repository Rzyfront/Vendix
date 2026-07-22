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
import { startWith } from 'rxjs';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../shared/components';
import { DOCUMENT_TYPES } from '../../../../../../shared/constants/document-types';
import { PosCustomerService } from '../../services/pos-customer.service';
import {
  CreatePosCustomerRequest,
  PosCustomer,
} from '../../models/customer.model';

/** Vistas internas del selector con navegación drill-in (vista enfocada). */
export type CustomerSelectorView = 'overview' | 'search' | 'create';

/**
 * Selector de cliente reutilizable para flujos POS (pago, crear-orden, envío).
 *
 * Encapsula buscar + crear cliente con navegación drill-in: cada acción abre
 * una vista enfocada ('search' / 'create') con botón "Volver" que regresa
 * siempre a 'overview'. NO renderiza su propio modal; vive como panel inline
 * dentro del cuerpo de un modal anfitrión.
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

  // ── Internal signals ────────────────────────────────────────────────
  readonly results = signal<PosCustomer[]>([]);
  readonly isSearching = signal(false);
  readonly searchPerformed = signal(false);
  readonly creating = signal(false);
  /** Texto tipeado actual (para que Enter dispare búsqueda inmediata). */
  private readonly query = signal('');
  /** Última consulta efectiva, usada como prefill al crear desde búsqueda. */
  readonly lastQuery = signal('');

  // ── Top-suggestions (clientes más frecuentes) ───────────────────────
  /** Top-5 clientes por volumen de órdenes (carga on-init si showTopSuggestions). */
  readonly topCustomers = signal<PosCustomer[]>([]);
  readonly loadingTop = signal(false);
  /** Guard one-shot para la inicialización de vista + carga de top-5. */
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

  /** Opciones del selector de tipo de documento (single source of truth). */
  readonly documentTypeOptions: SelectorOption[] = DOCUMENT_TYPES.map(
    (opt) => ({ value: opt.code, label: opt.label }),
  );

  // ── Form (misma forma que el bloque duplicado del payment interface) ──
  readonly form: FormGroup = this.fb.group({
    email: ['', [Validators.email]],
    firstName: ['', [Validators.required, Validators.minLength(2)]],
    lastName: ['', [Validators.required, Validators.minLength(2)]],
    phone: [''],
    documentType: [''],
    documentNumber: ['', [Validators.required]],
  });

  /** Estado de validez del form como signal (Zoneless-safe). */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly canCreate = computed(
    () => this.formStatus() === 'VALID' && !this.creating(),
  );

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

  /** Carga perezosa e idempotente del top-5 (solo cuando showTopSuggestions). */
  private loadTopCustomers(): void {
    if (this.topCustomers().length > 0 || this.loadingTop()) return;
    this.loadingTop.set(true);
    this.customerService
      .topCustomers(5)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.topCustomers.set(list ?? []);
          this.loadingTop.set(false);
        },
        error: () => {
          this.topCustomers.set([]);
          this.loadingTop.set(false);
        },
      });
  }

  // ── Navegación drill-in ─────────────────────────────────────────────
  goToSearch(): void {
    this.view.set('search');
  }

  goToCreate(prefillName?: string): void {
    if (prefillName && prefillName.trim()) {
      // Prefill heurístico: primer token → nombre, resto → apellido.
      const parts = prefillName.trim().split(/\s+/);
      const firstName = parts.shift() ?? '';
      const lastName = parts.join(' ');
      this.form.patchValue({ firstName, lastName });
    }
    this.view.set('create');
  }

  back(): void {
    this.view.set('overview');
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

  // ── Creación ────────────────────────────────────────────────────────
  onCreate(): void {
    if (!this.form.valid) {
      this.markFormTouched();
      this.toastService.info('Por favor completa los campos requeridos');
      return;
    }

    const value = this.form.value;
    const request: CreatePosCustomerRequest = {
      email: value.email,
      first_name: value.firstName,
      last_name: value.lastName || undefined,
      phone: value.phone || undefined,
      document_type: value.documentType || undefined,
      document_number: value.documentNumber || undefined,
    };

    this.creating.set(true);

    // createQuickCustomer auto-selecciona el cliente en el service;
    // emitimos para que el anfitrión sincronice su propio estado.
    this.customerService
      .createQuickCustomer(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.creating.set(false);
          this.customerSelected.emit(created);
          this.view.set('overview');
          this.form.reset();
          this.toastService.success('Cliente creado correctamente');
        },
        error: (error: unknown) => {
          this.creating.set(false);
          this.toastService.error(this.resolveErrorMessage(error));
        },
      });
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
    return err?.error?.message || err?.message || 'Error al crear cliente';
  }

  /** Limpia el form, resultados y vuelve a 'overview'. Los anfitriones lo llaman al cerrar el modal. */
  reset(): void {
    this.form.reset();
    this.results.set([]);
    this.isSearching.set(false);
    this.searchPerformed.set(false);
    this.creating.set(false);
    this.query.set('');
    this.lastQuery.set('');
    this.view.set('overview');
  }
}
