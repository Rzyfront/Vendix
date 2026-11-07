import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { MultiSelectorComponent } from '../../../../shared/components/multi-selector/multi-selector.component';
import { SelectorComponent } from '../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { WorkflowFieldDef } from '../../../../shared/workflows/contract/workflow-contract';
import { applyComputedFields } from '../../../../shared/workflows/contract/workflow-expression';
import { evaluateCondition } from '../../../../shared/workflows/contract/workflow-runtime';
import { parseApiError } from '../../../../core/utils/parse-api-error';
import {
  PublicFormDefinition,
  WorkflowPublicFormService,
} from './workflow-public-form.service';

type PageState = 'loading' | 'form' | 'unavailable' | 'not_found' | 'done' | 'error';
type Values = Record<string, unknown>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** File and user fields cannot be filled by an anonymous person. */
const UNSUPPORTED = ['file', 'user'];

/**
 * Public request form opened from the link of a flow (`/flujos/:token`).
 * Mobile-first (360 px), no login. `submission_id` is generated once per page
 * load and reused on retry, so a double click never creates two requests.
 */
@Component({
  selector: 'app-workflow-public-form',
  standalone: true,
  imports: [
    FormsModule,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    MultiSelectorComponent,
    ToggleComponent,
  ],
  template: `
    <main class="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
      @switch (state()) {
        @case ('loading') {
          <p class="py-10 text-center text-text-secondary" role="status">Cargando formulario...</p>
        }
        @case ('not_found') {
          <h1 class="text-xl font-semibold text-text-primary">Este enlace no existe o fue desactivado</h1>
          <p class="mt-2 text-text-secondary">Pide a la tienda un enlace nuevo.</p>
        }
        @case ('unavailable') {
          <h1 class="text-xl font-semibold text-text-primary">Este formulario no está disponible por ahora</h1>
          <p class="mt-2 text-text-secondary">
            Intenta más tarde o contacta a {{ form()?.store?.name || 'la tienda' }}.
          </p>
        }
        @case ('error') {
          <h1 class="text-xl font-semibold text-text-primary">No pudimos cargar el formulario</h1>
          <p class="mt-2 text-text-secondary" role="alert">{{ errorMessage() }}</p>
        }
        @case ('done') {
          <div class="rounded-2xl border border-border bg-surface p-5 text-center" role="status">
            <h1 class="text-xl font-semibold text-text-primary">Recibimos tu solicitud</h1>
            <p class="mt-2 text-text-secondary">Guarda este número de referencia:</p>
            <p class="mt-2 break-all text-2xl font-bold text-primary" data-testid="reference">
              {{ reference() }}
            </p>
            <p class="mt-3 text-sm text-text-secondary">
              {{ form()?.store?.name }} se pondrá en contacto contigo.
            </p>
          </div>
        }
        @default {
          @if (form(); as f) {
            <p class="text-sm text-text-secondary">{{ f.store.name }}</p>
            <h1 class="mt-1 text-2xl font-semibold text-text-primary">{{ f.flow.name }}</h1>
            @if (f.flow.description) {
              <p class="mt-2 whitespace-pre-line text-text-secondary">{{ f.flow.description }}</p>
            }

            <form class="mt-6 flex flex-col gap-4" (ngSubmit)="submit()" novalidate>
              @for (field of visibleFields(); track field.key) {
                <div [attr.data-field]="field.key">
                  @switch (field.compute ? 'computed' : field.type) {
                    @case ('computed') {
                      <app-input [label]="field.label" [readonly]="true"
                        [helperText]="field.help || 'Se calcula solo.'"
                        [ngModel]="computedText(field)" [ngModelOptions]="{standalone: true}" />
                    }
                    @case ('textarea') {
                      <app-textarea [label]="labelOf(field)" [rows]="4" [helperText]="field.help"
                        [error]="errors()[field.key]" [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                    @case ('number') {
                      <app-input type="number" [label]="labelOf(field)" [helperText]="field.help ?? ''"
                        [error]="errors()[field.key]" [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                    @case ('money') {
                      <app-input [currency]="true" [label]="labelOf(field)" [helperText]="field.help ?? ''"
                        [error]="errors()[field.key]" [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                    @case ('date') {
                      <app-input type="date" [label]="labelOf(field)" [helperText]="field.help ?? ''"
                        [error]="errors()[field.key]" [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                    @case ('email') {
                      <app-input type="email" [label]="labelOf(field)" [helperText]="field.help ?? ''"
                        [error]="errors()[field.key]" [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                    @case ('phone') {
                      <app-input type="tel" [label]="labelOf(field)" [helperText]="field.help ?? ''"
                        [error]="errors()[field.key]" [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                    @case ('boolean') {
                      <app-toggle [label]="labelOf(field)" [checked]="raw(field.key) === true"
                        (toggled)="setValue(field.key, $event)" />
                      @if (field.help) {
                        <span class="text-xs text-text-secondary">{{ field.help }}</span>
                      }
                    }
                    @case ('select') {
                      <app-selector [label]="labelOf(field)" placeholder="Selecciona una opción"
                        [options]="field.options ?? []" [value]="selectValue(field.key)"
                        [errorText]="errors()[field.key] ?? ''" [helpText]="field.help ?? ''"
                        (valueChange)="setValue(field.key, $event)" />
                    }
                    @case ('multiselect') {
                      <app-multi-selector [label]="labelOf(field)" [options]="field.options ?? []"
                        [errorText]="errors()[field.key] ?? ''" [helpText]="field.help ?? ''"
                        [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                    @default {
                      <app-input [label]="labelOf(field)" [helperText]="field.help ?? ''"
                        [error]="errors()[field.key]" [ngModel]="raw(field.key)" [ngModelOptions]="{standalone: true}"
                        (ngModelChange)="setValue(field.key, $event)" />
                    }
                  }
                </div>
              }

              <fieldset class="flex flex-col gap-4 rounded-2xl border border-border p-4">
                <legend class="px-1 text-sm font-semibold text-text-primary">Tus datos de contacto</legend>
                <app-input label="Nombre *" [error]="errors()['__name']" [ngModel]="name()"
                  [ngModelOptions]="{standalone: true}" (ngModelChange)="setContact('name', $event)" />
                <app-input type="email" label="Correo" [error]="errors()['__email']" [ngModel]="email()"
                  [ngModelOptions]="{standalone: true}" (ngModelChange)="setContact('email', $event)" />
                <app-input type="tel" label="Teléfono" [ngModel]="phone()"
                  [ngModelOptions]="{standalone: true}" (ngModelChange)="setContact('phone', $event)" />
              </fieldset>

              <div class="flex flex-col gap-2">
                @if (f.privacy_notice) {
                  <p class="whitespace-pre-line rounded-xl bg-background p-3 text-xs text-text-secondary">
                    {{ f.privacy_notice }}
                  </p>
                }
                <label class="flex items-start gap-2 text-sm text-text-primary">
                  <input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [checked]="accepted()"
                    (change)="onAccept($event)" />
                  <span>Acepto el aviso de privacidad y el tratamiento de mis datos *</span>
                </label>
                @if (errors()['__privacy']) {
                  <span class="text-xs text-error" role="alert">{{ errors()['__privacy'] }}</span>
                }
              </div>

              @if (errorMessage()) {
                <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
              }
              <button
                type="submit"
                class="h-12 w-full rounded-xl bg-primary px-4 text-base font-semibold text-white disabled:opacity-60"
                [disabled]="submitting()"
              >
                {{ submitting() ? 'Enviando...' : 'Enviar solicitud' }}
              </button>
            </form>
          }
        }
      }
    </main>
  `,
})
export class WorkflowPublicFormComponent implements OnInit {
  private readonly api = inject(WorkflowPublicFormService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** One per page load; reused on retry (backend makes it idempotent). */
  private readonly submissionId = crypto.randomUUID();
  private token = '';

  readonly state = signal<PageState>('loading');
  readonly form = signal<PublicFormDefinition | null>(null);
  readonly values = signal<Values>({});
  readonly errors = signal<Partial<Record<string, string>>>({});
  readonly name = signal('');
  readonly email = signal('');
  readonly phone = signal('');
  readonly accepted = signal(false);
  readonly submitting = signal(false);
  readonly errorMessage = signal('');
  readonly reference = signal('');

  private readonly fields = computed(() =>
    (this.form()?.fields ?? []).filter((f) => !UNSUPPORTED.includes(f.type)),
  );
  /** P2.9: what the person typed plus the calculated fields, recomputed live. */
  readonly liveData = computed<Values>(() =>
    applyComputedFields({ fields: this.fields() }, this.values(), {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  );
  readonly visibleFields = computed<WorkflowFieldDef[]>(() => {
    const all = this.form()?.fields ?? [];
    const data = this.liveData();
    return this.fields().filter(
      (f) => !f.visible_when || evaluateCondition(f.visible_when, data, all),
    );
  });

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.api
      .get(this.token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (form) => {
          this.form.set(form);
          this.state.set(form.available ? 'form' : 'unavailable');
        },
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) this.state.set('not_found');
          else {
            this.errorMessage.set(this.messageOf(error));
            this.state.set('error');
          }
        },
      });
  }

  labelOf(field: WorkflowFieldDef): string {
    return field.required ? `${field.label} *` : field.label;
  }

  /** Calculated value as text for the read-only input ('' while it cannot be computed). */
  computedText(field: WorkflowFieldDef): string {
    const value = this.liveData()[field.key];
    if (value === undefined || value === null) return '';
    if (typeof value === 'number' && field.type === 'money') return value.toLocaleString('es-CO');
    return String(value);
  }

  raw(key: string): unknown {
    return this.values()[key] ?? null;
  }

  selectValue(key: string): string | number | null {
    const value = this.values()[key];
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  }

  setValue(key: string, value: unknown): void {
    this.values.update((current) => ({ ...current, [key]: value }));
    this.clearError(key);
  }

  setContact(kind: 'name' | 'email' | 'phone', value: string | null): void {
    const text = value ?? '';
    if (kind === 'name') this.name.set(text);
    else if (kind === 'email') this.email.set(text);
    else this.phone.set(text);
    this.clearError(`__${kind}`);
  }

  onAccept(event: Event): void {
    this.accepted.set((event.target as HTMLInputElement).checked);
    this.clearError('__privacy');
  }

  submit(): void {
    if (this.submitting()) return;
    const collected = this.collect();
    if (!collected) return;
    this.submitting.set(true);
    this.errorMessage.set('');
    this.api
      .submit(this.token, {
        submission_id: this.submissionId,
        values: collected,
        contact: {
          name: this.name().trim(),
          ...(this.email().trim() ? { email: this.email().trim() } : {}),
          ...(this.phone().trim() ? { phone: this.phone().trim() } : {}),
        },
        accept_privacy: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.reference.set(result.reference);
          this.state.set('done');
        },
        error: (error: HttpErrorResponse) => {
          this.submitting.set(false);
          if (error.status === 404) this.state.set('not_found');
          else this.errorMessage.set(this.messageOf(error));
        },
      });
  }

  /** Validates visible fields + contact; returns the values to send or `null`. */
  private collect(): Values | null {
    const errors: Record<string, string> = {};
    const out: Values = {};
    const raw = this.values();
    for (const field of this.visibleFields()) {
      // Calculated fields are read-only: the server computes them, never sent.
      if (field.compute) continue;
      const value = raw[field.key];
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (field.type === 'boolean') {
        out[field.key] = value === true;
      } else if (empty) {
        if (field.required) errors[field.key] = `El campo "${field.label}" es obligatorio.`;
      } else if (field.type === 'number' || field.type === 'money') {
        const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
        if (Number.isFinite(parsed)) out[field.key] = parsed;
        else errors[field.key] = `El campo "${field.label}" debe ser un número válido.`;
      } else {
        out[field.key] = typeof value === 'string' ? value.trim() : value;
      }
    }
    if (!this.name().trim()) errors['__name'] = 'Escribe tu nombre.';
    if (this.email().trim() && !EMAIL.test(this.email().trim())) {
      errors['__email'] = 'Escribe un correo válido.';
    }
    if (!this.accepted()) errors['__privacy'] = 'Debes aceptar el aviso de privacidad.';
    this.errors.set(errors);
    return Object.keys(errors).length === 0 ? out : null;
  }

  private clearError(key: string): void {
    if (!this.errors()[key]) return;
    this.errors.update((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  private messageOf(error: HttpErrorResponse): string {
    if (error.status === 429) return 'Demasiados envíos; intenta en un minuto.';
    if (error.status === 0) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    return parseApiError(error).userMessage;
  }
}
