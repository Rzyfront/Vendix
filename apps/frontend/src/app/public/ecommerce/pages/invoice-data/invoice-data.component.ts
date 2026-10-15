import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
} from '@angular/common/http';
import {
  Subscription,
  exhaustMap,
  startWith,
  take,
  takeWhile,
  timer,
} from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  CustomerBillingData,
  CustomerBillingFieldsComponent,
} from '../../../../shared/components/customer-billing-fields/customer-billing-fields.component';
import {
  DianDepartmentOption,
  DianMunicipalityOption,
} from '../../../../shared/services/dian-municipality-lookup.service';
import { parseApiError } from '../../../../core/utils/parse-api-error';
interface Progress {
  status?: string;
  phase?: string;
  run_status?: string;
  can_retry?: boolean;
  new_invoice_id?: number;
  operation_id?: number;
  message?: string;
}
interface PublicInfo extends Progress {
  store?: { name: string };
  order?: { order_number: string; grand_total: number; created_at: string };
}
interface Envelope<T> {
  data: T;
}
@Component({
  selector: 'app-invoice-data',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CustomerBillingFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <main class="invoice-page">
    <article>
      <header>
        <p>{{ storeName() || 'Vendix' }}</p>
        <h1>Factura a tu nombre</h1>
        <p>Cambia el titular de tu factura de consumidor final.</p>
      </header>
      @if (loading()) {
        <p role="status">Cargando información…</p>
      }
      @if (errorMessage()) {
        <p role="alert">{{ errorMessage() }}</p>
      }
      @if (!loading() && !fatalError()) {
        @if (orderInfo(); as order) {
          <section aria-label="Resumen de compra">
            <p>
              Orden #{{ order.order_number }} ·
              {{
                order.grand_total | currency: 'COP' : 'symbol-narrow' : '1.0-0'
              }}
            </p>
          </section>
        }
        @if (submitted()) {
          <section aria-live="polite">
            <h2>{{ completed() ? 'Factura emitida' : 'Datos recibidos' }}</h2>
            <p>{{ progressMessage() }}</p>
            @if (!completed()) {
              <button
                type="button"
                [disabled]="submitting()"
                (click)="refreshStatus()"
              >
                Actualizar estado
              </button>
            }
          </section>
        } @else {
          <p>
            Al enviar autorizas anular la factura original mediante nota crédito
            y emitir una nueva a este titular. La compra y sus valores no
            cambian.
          </p>
          <app-customer-billing-fields
            [initialValue]="prefill()"
            (changed)="identity.set($event)"
            (validChange)="identityValid.set($event)"
          />
          <button
            type="button"
            [disabled]="lookingUp() || !identity()?.document_number"
            (click)="lookup()"
          >
            {{
              lookingUp() ? 'Consultando…' : 'Consultar datos públicos / RUES'
            }}
          </button>
          @if (lookupMessage()) {
            <p role="status">{{ lookupMessage() }}</p>
          }
          <form [formGroup]="addressForm" (ngSubmit)="onSubmit()">
            <fieldset>
              <legend>Dirección fiscal</legend>
              <label
                >Departamento *<select
                  formControlName="department"
                  (change)="loadMunicipalities()"
                >
                  <option value="">Selecciona departamento</option>
                  @for (item of departments(); track item.code) {
                    <option [value]="item.code">{{ item.name }}</option>
                  }
                </select></label
              >
              <label
                >Municipio *<select formControlName="municipality_code">
                  <option value="">Selecciona municipio</option>
                  @for (item of municipalities(); track item.code) {
                    <option [value]="item.code">{{ item.name }}</option>
                  }
                </select></label
              >
              <label
                >Dirección *<input
                  formControlName="address_line1"
                  autocomplete="street-address"
                  required
                  maxlength="255"
              /></label>
              @if (catalogError()) {
                <p role="alert">{{ catalogError() }}</p>
                <button type="button" (click)="loadDepartments()">
                  Reintentar catálogo
                </button>
              }
            </fieldset>
            <button type="submit" [disabled]="!canSubmit()">
              {{ submitting() ? 'Enviando…' : 'Solicitar factura a mi nombre' }}
            </button>
          </form>
        }
      }
    </article>
  </main>`,
  styles: [
    `
      :host {
        display: block;
        color: var(--color-text-primary, #222);
      }
      .invoice-page {
        min-height: 100vh;
        padding: 1rem;
        box-sizing: border-box;
        background: var(--color-background, #f6f6f6);
      }
      article {
        max-width: 38rem;
        margin: 1rem auto;
        background: var(--color-surface, #fff);
        border: 1px solid var(--color-border, #ddd);
        border-radius: 1rem;
        padding: 1.25rem;
        overflow-wrap: anywhere;
      }
      h1 {
        font-size: 1.6rem;
      }
      h2 {
        font-size: 1.2rem;
      }
      header {
        border-bottom: 1px solid var(--color-border, #ddd);
        margin-bottom: 1rem;
      }
      fieldset {
        border: 0;
        padding: 1rem 0;
        display: grid;
        gap: 1rem;
        min-width: 0;
      }
      label {
        display: grid;
        gap: 0.4rem;
      }
      input,
      select,
      button {
        font: inherit;
        min-height: 44px;
        max-width: 100%;
        padding: 0.65rem;
        border: 1px solid var(--color-border, #aaa);
        border-radius: 0.5rem;
        background: var(--color-surface, #fff);
        color: inherit;
      }
      button {
        margin-top: 1rem;
        cursor: pointer;
      }
      button[type='submit'] {
        width: 100%;
        background: var(--color-primary, #2563eb);
        color: var(--color-on-primary, #fff);
      }
      button:disabled {
        opacity: 0.55;
        cursor: default;
      }
      input:focus-visible,
      select:focus-visible,
      button:focus-visible {
        outline: 2px solid var(--color-primary, #2563eb);
        outline-offset: 2px;
      }
      [role='alert'] {
        border-inline-start: 3px solid var(--color-primary, #2563eb);
        padding: 0.75rem;
      }
      p {
        line-height: 1.5;
      }
    `,
  ],
})
export class InvoiceDataComponent implements OnInit {
  // Capability-only requests deliberately bypass staff auth/tenant interceptors.
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/invoice-data`;
  private token = '';
  private polling?: Subscription;
  readonly loading = signal(true);
  readonly fatalError = signal(false);
  readonly errorMessage = signal('');
  readonly submitted = signal(false);
  readonly submitting = signal(false);
  readonly storeName = signal('');
  readonly orderInfo = signal<PublicInfo['order'] | null>(null);
  readonly progress = signal<Progress>({});
  readonly identity = signal<CustomerBillingData | null>(null);
  readonly prefill = signal<Partial<CustomerBillingData> | null>(null);
  readonly identityValid = signal(false);
  readonly lookingUp = signal(false);
  readonly lookupMessage = signal('');
  readonly catalogError = signal('');
  readonly departments = signal<DianDepartmentOption[]>([]);
  readonly municipalities = signal<DianMunicipalityOption[]>([]);
  readonly addressForm = new FormGroup({
    department: new FormControl('', {
      nonNullable: true,
      validators: Validators.required,
    }),
    municipality_code: new FormControl('', {
      nonNullable: true,
      validators: Validators.required,
    }),
    address_line1: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(5),
        Validators.maxLength(255),
      ],
    }),
  });
  private readonly addressStatus = toSignal(
    this.addressForm.statusChanges.pipe(startWith(this.addressForm.status)),
    { initialValue: this.addressForm.status },
  );
  readonly canSubmit = computed(
    () =>
      this.identityValid() &&
      this.addressStatus() === 'VALID' &&
      !this.submitting(),
  );
  readonly completed = computed(
    () =>
      this.progress().status === 'completed' ||
      this.progress().phase === 'completed',
  );
  readonly progressMessage = computed(() => {
    if (this.completed())
      return 'La DIAN aceptó tu nueva factura. Se enviará al correo indicado.';
    const p = this.progress();
    if (p.run_status === 'action_required' || p.status === 'failed')
      return (
        p.message ||
        'La solicitud requiere revisión del comercio. No envíes otra solicitud.'
      );
    if (p.phase?.includes('credit'))
      return 'Esperando la aceptación de la nota crédito por la DIAN. Aún no se ha emitido la nueva factura.';
    if (p.phase?.includes('invoice') || p.phase?.includes('replacement'))
      return 'Procesando la nueva factura. Esperamos la aceptación de la DIAN.';
    return (
      p.message ||
      'Estamos procesando tu solicitud. Puedes cerrar esta página y volver con el mismo enlace.'
    );
  });
  private get endpoint() {
    return `${this.apiUrl}/${encodeURIComponent(this.token)}`;
  }
  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.loading.set(false);
      this.fatalError.set(true);
      this.errorMessage.set('El enlace no es válido.');
      return;
    }
    this.http
      .get<Envelope<PublicInfo> | PublicInfo>(this.endpoint)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const d = this.unwrap(res);
          this.storeName.set(d.store?.name || '');
          this.orderInfo.set(d.order || null);
          this.applyProgress(d);
          this.loading.set(false);
          if (!this.submitted()) this.loadDepartments();
          else if (!this.completed()) this.startPolling();
        },
        error: (e) => this.handleError(e, true),
      });
  }
  private unwrap<T>(res: Envelope<T> | T): T {
    return res && typeof res === 'object' && 'data' in res
      ? (res as Envelope<T>).data
      : (res as T);
  }
  private applyProgress(p: Progress): void {
    this.progress.set(p);
    if ((p.status && p.status !== 'pending') || p.operation_id)
      this.submitted.set(true);
  }
  loadDepartments(): void {
    this.catalogError.set('');
    this.http
      .get<Envelope<DianDepartmentOption[]>>(
        `${this.endpoint}/dian/departments`,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => this.departments.set(r.data),
        error: () =>
          this.catalogError.set(
            'No pudimos cargar el catálogo DANE. Reintenta para seleccionar una dirección válida.',
          ),
      });
  }
  loadMunicipalities(): void {
    this.addressForm.controls.municipality_code.setValue('');
    this.municipalities.set([]);
    const code = this.addressForm.controls.department.value;
    if (!code) return;
    this.http
      .get<Envelope<DianMunicipalityOption[]>>(
        `${this.endpoint}/dian/municipalities`,
        { params: { department_code: code } },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          if (this.addressForm.controls.department.value === code)
            this.municipalities.set(r.data);
        },
        error: () =>
          this.catalogError.set(
            'No pudimos cargar los municipios. Selecciona de nuevo el departamento.',
          ),
      });
  }
  lookup(): void {
    const d = this.identity();
    if (!d?.document_number || this.lookingUp()) return;
    this.lookingUp.set(true);
    this.lookupMessage.set('');
    this.http
      .get<
        Envelope<{ found: boolean; identity?: Partial<CustomerBillingData> }>
      >(`${this.endpoint}/lookup/external`, {
        params: { document_number: d.document_number },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.lookingUp.set(false);
          if (r.data.found && r.data.identity) {
            this.prefill.set({
              ...d,
              ...Object.fromEntries(
                Object.entries(r.data.identity).filter(([, v]) => v != null),
              ),
            });
            this.lookupMessage.set(
              'Datos de fuente pública encontrados. Revísalos antes de enviar.',
            );
          } else
            this.lookupMessage.set(
              'No encontramos datos públicos. Puedes completar el formulario manualmente.',
            );
        },
        error: () => {
          this.lookingUp.set(false);
          this.lookupMessage.set(
            'La consulta no está disponible. Puedes completar los datos manualmente.',
          );
        },
      });
  }
  onSubmit(): void {
    this.addressForm.markAllAsTouched();
    const identity = this.identity();
    if (!this.canSubmit() || !identity) return;
    const municipality = this.municipalities().find(
      (m) => m.code === this.addressForm.controls.municipality_code.value,
    );
    if (!municipality) return;
    this.submitting.set(true);
    this.errorMessage.set('');
    const address = {
      address_line1: this.addressForm.controls.address_line1.value.trim(),
      city: municipality.name,
      state_province: municipality.department_name,
      country_code: 'CO',
      municipality_code: municipality.code,
    };
    this.http
      .post<Envelope<Progress> | Progress>(`${this.endpoint}/submit`, {
        ...identity,
        verification_digit:
          identity.document_type === 'NIT'
            ? identity.verification_digit
            : undefined,
        address,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.submitting.set(false);
          this.submitted.set(true);
          this.applyProgress(this.unwrap(r));
          if (!this.completed()) this.startPolling();
        },
        error: (e) => this.handleError(e, false),
      });
  }
  refreshStatus(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.http
      .get<Envelope<Progress> | Progress>(`${this.endpoint}/status`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.submitting.set(false);
          this.applyProgress(this.unwrap(r));
        },
        error: (e) => this.handleError(e, false),
      });
  }
  private startPolling(): void {
    this.polling?.unsubscribe();
    this.polling = timer(3000, 5000)
      .pipe(
        take(60),
        exhaustMap(() =>
          this.http.get<Envelope<Progress> | Progress>(
            `${this.endpoint}/status`,
          ),
        ),
        takeWhile(() => !this.completed(), true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (r) => this.applyProgress(this.unwrap(r)),
        error: (e) => this.handleError(e, false),
      });
  }
  private handleError(error: HttpErrorResponse, fatal: boolean): void {
    this.loading.set(false);
    this.submitting.set(false);
    this.fatalError.set(fatal);
    this.errorMessage.set(
      error.status === 410
        ? 'El enlace venció. Contacta al comercio para continuar.'
        : error.status === 404
          ? 'El enlace no es válido o ya no está disponible.'
          : parseApiError(error).userMessage,
    );
  }
}
