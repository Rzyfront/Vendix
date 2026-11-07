import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, from, switchMap } from 'rxjs';
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
import { CaptchaProof, solveCaptcha } from './workflow-captcha';
import { uploadInChunks } from './workflow-chunked-upload';
import {
  PublicFormDefinition,
  UploadAccess,
  WorkflowPublicFormService,
} from './workflow-public-form.service';

type PageState = 'loading' | 'form' | 'unavailable' | 'not_found' | 'done' | 'error';
type Values = Record<string, unknown>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** User fields cannot be filled by an anonymous person. */
const UNSUPPORTED = ['user'];
const DEFAULT_MAX_FILE_MB = 10;

interface UploadState {
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/**
 * Public request form opened from the link of a flow (`/flujos/:token`).
 * Mobile-first (360 px), no login. `submission_id` is generated once per page
 * load and reused on retry, so a double click never creates two requests.
 * Multi-step forms are presentational (the server validates the whole form);
 * files go up in chunks; when the link asks for it, a proof-of-work captcha is
 * solved before the first upload (later ones reuse the server grant) and on submit.
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
            @if (trackingUrl(); as link) {
              <div class="mt-5 rounded-xl bg-background p-3 text-left" data-testid="tracking">
                <p class="text-sm font-medium text-text-primary">Sigue tu solicitud con este enlace:</p>
                <a [href]="link" class="mt-1 block break-all text-sm text-primary underline">{{ link }}</a>
                <button
                  type="button"
                  class="mt-3 h-11 w-full rounded-xl border border-border text-sm font-semibold text-text-primary"
                  (click)="copyLink()"
                >
                  {{ copied() ? 'Enlace copiado' : 'Copiar enlace' }}
                </button>
              </div>
            }
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
              @if (steps().length > 1) {
                <div data-testid="step-indicator">
                  <p class="text-sm font-medium text-text-secondary">
                    Paso {{ stepIndex() + 1 }} de {{ steps().length }}
                  </p>
                  <h2 class="text-lg font-semibold text-text-primary">{{ currentStep().title }}</h2>
                  <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-background" aria-hidden="true">
                    <div class="h-full bg-primary transition-all"
                      [style.width.%]="((stepIndex() + 1) / steps().length) * 100"></div>
                  </div>
                </div>
              }
              @for (field of stepFields(); track field.key) {
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
                    @case ('file') {
                      <div class="flex flex-col gap-2">
                        <span class="text-sm font-medium text-text-primary">{{ labelOf(field) }}</span>
                        @if (field.help) {
                          <span class="text-xs text-text-secondary">{{ field.help }}</span>
                        }
                        @if (uploads()[field.key]; as up) {
                          <div class="rounded-xl border border-border p-3">
                            <p class="truncate text-sm text-text-primary">{{ up.name }}</p>
                            @if (up.status === 'uploading') {
                              <div class="mt-2 h-2 overflow-hidden rounded-full bg-background" role="progressbar"
                                aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="up.progress">
                                <div class="h-full bg-primary transition-all" [style.width.%]="up.progress"></div>
                              </div>
                              <p class="mt-1 text-xs text-text-secondary" role="status">Subiendo... {{ up.progress }}%</p>
                            } @else if (up.status === 'done') {
                              <p class="mt-1 text-xs text-[var(--color-success)]">Archivo listo</p>
                            } @else {
                              <p class="mt-1 text-xs text-error" role="alert">{{ up.error }}</p>
                            }
                            @if (up.status !== 'uploading') {
                              <button type="button" class="mt-2 h-10 text-sm font-medium text-primary underline"
                                (click)="removeFile(field.key)">Quitar archivo</button>
                            }
                          </div>
                        }
                        @if (uploads()[field.key]?.status !== 'uploading' && uploads()[field.key]?.status !== 'done') {
                          <label class="flex h-12 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-sm font-medium text-primary">
                            Elegir archivo
                            <input type="file" class="sr-only" [attr.accept]="acceptOf(field)"
                              (change)="onFile(field, $event)" />
                          </label>
                        }
                        @if (errors()[field.key]) {
                          <span class="text-xs text-error" role="alert">{{ errors()[field.key] }}</span>
                        }
                      </div>
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

              @if (isLast()) {
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
              }

              @if (verifying()) {
                <p class="text-sm text-text-secondary" role="status">Verificando que no eres un robot…</p>
              }
              @if (errorMessage()) {
                <p class="text-sm text-error" role="alert">{{ errorMessage() }}</p>
              }
              <div class="flex gap-3">
                @if (stepIndex() > 0) {
                  <button
                    type="button"
                    class="h-12 flex-1 rounded-xl border border-border px-4 text-base font-semibold text-text-primary disabled:opacity-60"
                    [disabled]="submitting()"
                    (click)="back()"
                  >
                    Atrás
                  </button>
                }
                @if (isLast()) {
                  <button
                    type="submit"
                    class="h-12 flex-[2] rounded-xl bg-primary px-4 text-base font-semibold text-white disabled:opacity-60"
                    [disabled]="submitting()"
                  >
                    {{ submitting() ? 'Enviando...' : 'Enviar solicitud' }}
                  </button>
                } @else {
                  <button
                    type="button"
                    class="h-12 flex-[2] rounded-xl bg-primary px-4 text-base font-semibold text-white"
                    (click)="next()"
                  >
                    Siguiente
                  </button>
                }
              </div>
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
  /** Short-lived grant the server returns on the first upload of a captcha link. */
  private uploadGrant: string | null = null;

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
  readonly trackingUrl = signal<string | null>(null);
  readonly copied = signal(false);
  readonly verifying = signal(false);
  readonly stepIndex = signal(0);
  readonly uploads = signal<Record<string, UploadState>>({});
  readonly uploading = computed(() =>
    Object.values(this.uploads()).some((u) => u.status === 'uploading'),
  );

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

  /** Pages of the form; a page whose fields are all hidden by conditions is skipped. */
  readonly steps = computed(() => {
    const form = this.form();
    const declared = form?.steps?.length
      ? form.steps
      : [{ title: 'Datos', fields: (form?.fields ?? []).map((f) => f.key) }];
    const visible = new Set(this.visibleFields().map((f) => f.key));
    const pages = declared
      .map((s) => ({ title: s.title, fields: s.fields.filter((k) => visible.has(k)) }))
      .filter((s) => s.fields.length > 0);
    return pages.length > 0 ? pages : [{ title: 'Datos', fields: [] as string[] }];
  });
  readonly currentStep = computed(
    () => this.steps()[Math.min(this.stepIndex(), this.steps().length - 1)],
  );
  readonly isLast = computed(() => this.stepIndex() >= this.steps().length - 1);
  readonly stepFields = computed<WorkflowFieldDef[]>(() => {
    const keys = new Set(this.currentStep().fields);
    return this.visibleFields().filter((f) => keys.has(f.key));
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

  next(): void {
    if (this.uploading()) {
      this.errorMessage.set('Espera a que termine la carga del archivo.');
      return;
    }
    const errors: Record<string, string> = {};
    this.validateFields(this.stepFields(), {}, errors);
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) return;
    this.errorMessage.set('');
    this.stepIndex.update((i) => Math.min(i + 1, this.steps().length - 1));
  }

  back(): void {
    this.errorMessage.set('');
    this.stepIndex.update((i) => Math.max(i - 1, 0));
  }

  acceptOf(field: WorkflowFieldDef): string | null {
    return field.accept?.length ? field.accept.join(',') : null;
  }

  onFile(field: WorkflowFieldDef, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const key = field.key;
    const maxMb = field.max_size_mb ?? DEFAULT_MAX_FILE_MB;
    const fail = (error: string) => this.setUpload(key, { name: file.name, progress: 0, status: 'error', error });
    this.setValue(key, null);
    if (!file.type) return fail('No reconocemos el tipo de este archivo.');
    if (file.size > maxMb * 1024 * 1024) return fail(`El archivo supera el máximo de ${maxMb} MB.`);
    this.setUpload(key, { name: file.name, progress: 0, status: 'uploading' });
    uploadInChunks(file, this.api.uploader(this.token, key, this.uploadAccess), {
      onProgress: (progress) => this.setUpload(key, { name: file.name, progress, status: 'uploading' }),
    })
      .then((uploadId) => {
        this.setValue(key, uploadId);
        this.setUpload(key, { name: file.name, progress: 100, status: 'done' });
      })
      .catch((error: unknown) => {
        // A rejected or expired grant is dropped so the next attempt solves the captcha again.
        if (error instanceof HttpErrorResponse && error.status === 403) this.uploadGrant = null;
        fail(error instanceof HttpErrorResponse ? this.messageOf(error) : 'No pudimos subir el archivo.');
      });
  }

  /** Captcha links: the first upload solves the verification, later ones reuse its grant. */
  private readonly uploadAccess: UploadAccess = {
    credentials: async () => {
      if (!this.form()?.captcha_required) return {};
      if (this.uploadGrant) return { upload_grant: this.uploadGrant };
      this.verifying.set(true);
      try {
        const challenge = await firstValueFrom(this.api.captcha(this.token));
        return { captcha: await solveCaptcha(challenge) };
      } finally {
        this.verifying.set(false);
      }
    },
    remember: (grant) => {
      this.uploadGrant = grant;
    },
  };

  removeFile(key: string): void {
    this.uploads.update((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    this.setValue(key, null);
  }

  async copyLink(): Promise<void> {
    const url = this.trackingUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
    } catch {
      this.errorMessage.set('No pudimos copiar el enlace; selecciónalo y cópialo a mano.');
    }
  }

  submit(): void {
    if (this.submitting()) return;
    if (!this.isLast()) {
      this.next();
      return;
    }
    if (this.uploading()) {
      this.errorMessage.set('Espera a que termine la carga del archivo.');
      return;
    }
    const collected = this.collect();
    if (!collected) {
      this.goToFirstError();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set('');
    if (!this.form()?.captcha_required) {
      this.send(collected);
      return;
    }
    this.verifying.set(true);
    this.api
      .captcha(this.token)
      .pipe(
        switchMap((challenge) => from(solveCaptcha(challenge))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (proof) => {
          this.verifying.set(false);
          this.send(collected, proof);
        },
        error: (error: unknown) => {
          this.verifying.set(false);
          this.submitting.set(false);
          if (error instanceof HttpErrorResponse && error.status === 404) this.state.set('not_found');
          else {
            this.errorMessage.set(
              error instanceof HttpErrorResponse
                ? this.messageOf(error)
                : 'No pudimos completar la verificación. Intenta de nuevo.',
            );
          }
        },
      });
  }

  private send(values: Values, captcha?: CaptchaProof): void {
    this.api
      .submit(this.token, {
        submission_id: this.submissionId,
        values,
        contact: {
          name: this.name().trim(),
          ...(this.email().trim() ? { email: this.email().trim() } : {}),
          ...(this.phone().trim() ? { phone: this.phone().trim() } : {}),
        },
        accept_privacy: true,
        ...(captcha ? { captcha } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.reference.set(result.reference);
          this.trackingUrl.set(result.tracking_url ?? null);
          this.state.set('done');
        },
        error: (error: HttpErrorResponse) => {
          this.submitting.set(false);
          if (error.status === 404) this.state.set('not_found');
          else this.errorMessage.set(this.messageOf(error));
        },
      });
  }

  private setUpload(key: string, state: UploadState): void {
    this.uploads.update((current) => ({ ...current, [key]: state }));
  }

  /** After a failed validation, show the first page that has an error. */
  private goToFirstError(): void {
    const errors = this.errors();
    const index = this.steps().findIndex((s) => s.fields.some((k) => errors[k]));
    if (index >= 0) this.stepIndex.set(index);
  }

  /** Validates visible fields + contact; returns the values to send or `null`. */
  private collect(): Values | null {
    const errors: Record<string, string> = {};
    const out: Values = {};
    this.validateFields(this.visibleFields(), out, errors);
    if (!this.name().trim()) errors['__name'] = 'Escribe tu nombre.';
    if (this.email().trim() && !EMAIL.test(this.email().trim())) {
      errors['__email'] = 'Escribe un correo válido.';
    }
    if (!this.accepted()) errors['__privacy'] = 'Debes aceptar el aviso de privacidad.';
    this.errors.set(errors);
    return Object.keys(errors).length === 0 ? out : null;
  }

  private validateFields(
    fields: WorkflowFieldDef[],
    out: Values,
    errors: Record<string, string>,
  ): void {
    const raw = this.values();
    for (const field of fields) {
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
        if (field.required) {
          errors[field.key] =
            field.type === 'file'
              ? `Sube el archivo "${field.label}".`
              : `El campo "${field.label}" es obligatorio.`;
        }
      } else if (field.type === 'number' || field.type === 'money') {
        const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
        if (Number.isFinite(parsed)) out[field.key] = parsed;
        else errors[field.key] = `El campo "${field.label}" debe ser un número válido.`;
      } else {
        out[field.key] = typeof value === 'string' ? value.trim() : value;
      }
    }
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
    if (error.status === 429 && parseApiError(error).errorCode !== 'WORKFLOW_UPLOAD_TOO_MANY') {
      return 'Demasiados envíos; intenta en un minuto.';
    }
    if (error.status === 0) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    return parseApiError(error).userMessage;
  }
}
