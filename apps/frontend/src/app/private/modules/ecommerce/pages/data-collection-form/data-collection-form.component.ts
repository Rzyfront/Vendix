import {Component, OnInit, ChangeDetectionStrategy, signal, computed, inject, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../environments/environment';
import { DynamicFieldComponent } from './components/dynamic-field/dynamic-field.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { getItemWidth, getItemWidthClass, DEFAULT_TEMPLATE_ICON, DEFAULT_SECTION_ICON, DEFAULT_TAB_ICON } from '../../../store/data-collection/utils/item-width.util';

@Component({
  selector: 'app-data-collection-form',
  standalone: true,
  imports: [CommonModule, DynamicFieldComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Loading -->
    @if (loading()) {
      <div class="flex items-center justify-center min-h-[60vh]">
        <div class="text-center">
          <div
            class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"
          ></div>
          <p class="text-sm" style="color: var(--color-text-muted)">
            Cargando formulario...
          </p>
        </div>
      </div>
    }

    <!-- Already submitted -->
    @if (alreadySubmitted()) {
      <div
        class="min-h-screen flex items-center justify-center p-4"
        style="background: var(--color-background, #f4f4f4)"
      >
        <div
          class="w-full max-w-md text-center p-8 rounded-2xl shadow-sm"
          style="background: var(--color-surface, white)"
        >
          <div
            class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
            style="background: #dcfce7"
          >
            <svg
              class="w-8 h-8"
              style="color: #16a34a"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2
            class="text-xl font-bold mb-2"
            style="color: var(--color-text, #222)"
          >
            Formulario ya completado
          </h2>
          <p class="text-sm" style="color: var(--color-text-muted, #666)">
            Ya completaste este formulario de preconsulta. Gracias por tu
            información, nos ayudará a brindarte una mejor atención.
          </p>
        </div>
      </div>
    }

    <!-- Expired / invalid token -->
    @if (expired()) {
      <div
        class="min-h-screen flex items-center justify-center p-4"
        style="background: var(--color-background, #f4f4f4)"
      >
        <div
          class="w-full max-w-md text-center p-8 rounded-2xl shadow-sm"
          style="background: var(--color-surface, white)"
        >
          <div
            class="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
            style="background: #fee2e2"
          >
            <svg
              class="w-8 h-8"
              style="color: #dc2626"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2
            class="text-xl font-bold mb-2"
            style="color: var(--color-text, #222)"
          >
            Enlace no válido
          </h2>
          <p class="text-sm" style="color: var(--color-text-muted, #666)">
            Este enlace ha expirado o no es válido. Si necesitas completar tu
            formulario, contacta a la clínica para que te envíen uno nuevo.
          </p>
        </div>
      </div>
    }

    <!-- Error -->
    @if (error()) {
      <div class="flex items-center justify-center min-h-[60vh]">
        <div class="text-center max-w-md px-6">
          <div
            class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4"
          >
            <svg
              class="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 class="text-lg font-bold mb-2" style="color: var(--color-text)">
            {{ errorTitle() }}
          </h2>
          <p class="text-sm" style="color: var(--color-text-muted)">
            {{ error() }}
          </p>
        </div>
      </div>
    }

    <!-- Form -->
    @if (
      !loading() &&
      !error() &&
      !alreadySubmitted() &&
      !expired() &&
      submission() &&
      !submitted()
    ) {
      <div class="max-w-2xl mx-auto px-4 py-6">
        <!-- Header -->
        @if (submission()?.booking) {
          <div
            class="mb-6 p-4 rounded-lg"
            style="background: var(--color-surface-secondary); border: 1px solid var(--color-border)"
          >
            <h1 class="text-lg font-bold mb-1 flex items-center gap-2" style="color: var(--color-text)">
              <app-icon [name]="submission()?.template?.icon || DEFAULT_TEMPLATE_ICON" [size]="22" color="var(--color-primary)"></app-icon>
              {{ submission()?.template?.name || 'Formulario de Preconsulta' }}
            </h1>
            <div
              class="text-sm space-y-0.5"
              style="color: var(--color-text-muted)"
            >
              <p>
                <strong>Servicio:</strong>
                {{ submission()?.booking?.product?.name }}
              </p>
              <p>
                <strong>Fecha:</strong>
                {{ submission()?.booking?.date | date: 'mediumDate' }} a las
                {{ submission()?.booking?.start_time }}
              </p>
              @if (submission()?.booking?.provider) {
                <p>
                  <strong>Profesional:</strong>
                  {{ submission()?.booking?.provider?.display_name }}
                </p>
              }
            </div>
          </div>
        }

        <!-- Progress bar -->
        @if (totalSteps() > 1) {
          <div class="mb-6">
            <div class="flex items-center justify-between mb-2">
              <span
                class="text-xs font-medium"
                style="color: var(--color-text-muted)"
              >
                Paso {{ currentStep() + 1 }} de {{ totalSteps() }}
              </span>
              <span class="text-xs" style="color: var(--color-text-muted)">
                {{ currentStepData()?.title }}
              </span>
            </div>
            <div
              class="w-full h-1.5 rounded-full"
              style="background: var(--color-border)"
            >
              <div
                class="h-full rounded-full transition-all duration-300"
                style="background: var(--color-primary)"
                [style.width.%]="progressPercent()"
              ></div>
            </div>
          </div>
        }

        <!-- Step content: all sections in this step -->
        @for (section of currentStepData()?.sections; track section.id) {
          <div class="mb-6">
            <!-- Section title with optional icon -->
            <div class="mb-4">
              <h2
                class="text-base font-semibold flex items-center gap-2"
                style="color: var(--color-text)"
              >
                <app-icon
                  [name]="section.icon || DEFAULT_SECTION_ICON"
                  [size]="18"
                  color="var(--color-primary)"
                ></app-icon>
                {{ section.title }}
              </h2>
              @if (section.description) {
                <p class="text-sm mt-1" style="color: var(--color-text-muted)">
                  {{ section.description }}
                </p>
              }
            </div>

            <!-- Items with width layout -->
            <div class="flex flex-wrap gap-3">
              @for (item of sortItems(section.items); track item.id) {
                <div [class]="getItemWidthClass(item.width)">
                  <app-dynamic-field
                    [field]="item.metadata_field"
                    [value]="getFieldValue(item.metadata_field.id)"
                    [required]="item.is_required"
                    [placeholder]="item.placeholder || ''"
                    [helpText]="item.help_text || ''"
                    [icon]="item.icon || ''"
                    [uploadToken]="submission()?.token || ''"
                    (valueChange)="
                      onFieldChange(
                        item.metadata_field.id,
                        $event,
                        item.metadata_field.field_type
                      )
                    "
                  />
                </div>
              }
            </div>

            <!-- Child sections -->
            @for (child of section.child_sections || []; track child.id) {
              <div
                class="ml-4 mt-4 pl-4"
                style="border-left: 2px solid var(--color-border)"
              >
                <h3
                  class="text-sm font-semibold mb-3 flex items-center gap-2"
                  style="color: var(--color-text)"
                >
                  <app-icon
                    [name]="child.icon || DEFAULT_SECTION_ICON"
                    [size]="16"
                    color="var(--color-text-muted)"
                  ></app-icon>
                  {{ child.title }}
                </h3>
                @if (child.description) {
                  <p
                    class="text-xs mb-2"
                    style="color: var(--color-text-muted)"
                  >
                    {{ child.description }}
                  </p>
                }
                <div class="flex flex-wrap gap-3">
                  @for (item of sortItems(child.items); track item.id) {
                    <div [class]="getItemWidthClass(item.width)">
                      <app-dynamic-field
                        [field]="item.metadata_field"
                        [value]="getFieldValue(item.metadata_field.id)"
                        [required]="item.is_required"
                        [placeholder]="item.placeholder || ''"
                        [helpText]="item.help_text || ''"
                        [uploadToken]="submission()?.token || ''"
                        (valueChange)="
                          onFieldChange(
                            item.metadata_field.id,
                            $event,
                            item.metadata_field.field_type
                          )
                        "
                      />
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }

        <!-- Navigation buttons -->
        <div
          class="flex gap-3 mt-6 pt-4"
          style="border-top: 1px solid var(--color-border)"
        >
          @if (currentStep() > 0) {
            <button
              class="flex-1 px-4 py-2.5 border rounded-lg text-sm font-medium transition-colors"
              style="border-color: var(--color-border); color: var(--color-text)"
              (click)="prevStep()"
            >
              Anterior
            </button>
          }
          @if (currentStep() < totalSteps() - 1) {
            <button
              class="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
              style="background: var(--color-primary)"
              [disabled]="saving()"
              (click)="nextStep()"
            >
              {{ saving() ? 'Guardando...' : 'Siguiente' }}
            </button>
          } @else {
            <button
              class="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
              style="background: var(--color-primary)"
              [disabled]="submitting()"
              (click)="submit()"
            >
              {{ submitting() ? 'Enviando...' : 'Enviar formulario' }}
            </button>
          }
        </div>
      </div>
    }

    <!-- Success -->
    @if (submitted()) {
      <div class="flex items-center justify-center min-h-[60vh]">
        <div class="text-center max-w-md px-6">
          <div
            class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4"
          >
            <svg
              class="w-8 h-8 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 class="text-lg font-bold mb-2" style="color: var(--color-text)">
            Datos enviados correctamente
          </h2>
          <p class="text-sm" style="color: var(--color-text-muted)">
            Tu profesional revisara la informacion antes de la consulta. Gracias
            por completar el formulario.
          </p>
        </div>
      </div>
    }
  `,
})
export class DataCollectionFormComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);

  loading = signal(true);
  error = signal<string | null>(null);
  errorTitle = signal('Error');
  alreadySubmitted = signal(false);
  expired = signal(false);
  submission = signal<any>(null);
  currentStep = signal(0);
  saving = signal(false);
  submitting = signal(false);
  submitted = signal(false);
  fieldValues = signal<Map<number, any>>(new Map());

  // Steps: if template has tabs, each tab is a step. Otherwise each section is a step.
  steps = computed(() => {
    const t = this.submission()?.template;
    if (t?.tabs?.length) {
      return t.tabs.map((tab: any) => ({
        title: tab.title,
        icon: tab.icon,
        sections: tab.sections || [],
      }));
    }
    // Fallback: each section is a step (backward compatible)
    return (t?.sections ?? []).map((s: any) => ({
      title: s.title,
      icon: s.icon,
      sections: [s],
    }));
  });

  totalSteps = computed(() => this.steps().length);
  progressPercent = computed(
    () => ((this.currentStep() + 1) / this.totalSteps()) * 100,
  );

  // Current step data
  currentStepData = computed(() => this.steps()[this.currentStep()] || null);

  ngOnInit() {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.error.set('Token no proporcionado');
      this.loading.set(false);
      return;
    }
    this.loadSubmission(token);
  }

  private loadSubmission(token: string) {
    this.http
      .get<any>(`${environment.apiUrl}/ecommerce/data-collection/${token}`)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (res) => {
          const data = res.data;
          this.submission.set(data);
          this.currentStep.set(data.current_step ?? 0);

          // Pre-populate existing responses
          if (data.responses?.length) {
            const map = new Map<number, any>();
            for (const r of data.responses) {
              const val =
                r.value_text ??
                r.value_number ??
                r.value_bool ??
                r.value_date ??
                r.value_json;
              map.set(r.field_id, val);
            }
            this.fieldValues.set(map);
          }

          this.loading.set(false);
        },
        error: (err) => {
          const body = err?.error || err;
          const errorCode = body?.error_code;
          const msg = body?.message || 'No se pudo cargar el formulario';

          if (errorCode === 'DCOL_TOKEN_002') {
            this.alreadySubmitted.set(true);
          } else if (errorCode === 'DCOL_TOKEN_001' || err.status === 404) {
            this.expired.set(true);
          } else if (err.status === 400) {
            this.errorTitle.set('Formulario no disponible');
            this.error.set(msg);
          } else {
            this.errorTitle.set('Error');
            this.error.set(msg);
          }
          this.loading.set(false);
        },
      });
  }

  getFieldValue(fieldId: number): any {
    return this.fieldValues().get(fieldId) ?? '';
  }

  onFieldChange(fieldId: number, value: any, fieldType: string) {
    const map = new Map(this.fieldValues());
    map.set(fieldId, value);
    this.fieldValues.set(map);
  }

  nextStep() {
    this.saving.set(true);
    const token = this.submission()?.token;
    const responses = this.buildCurrentStepResponses();

    this.http
      .post<any>(
        `${environment.apiUrl}/ecommerce/data-collection/${token}/step/${this.currentStep()}`,
        {
          responses,
        },
      )
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.currentStep.update((s) => s + 1);
          this.saving.set(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        error: () => {
          this.saving.set(false);
        },
      });
  }

  prevStep() {
    this.currentStep.update((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  submit() {
    this.submitting.set(true);
    const token = this.submission()?.token;

    // Save last step first, then submit
    const responses = this.buildCurrentStepResponses();
    this.http
      .post<any>(
        `${environment.apiUrl}/ecommerce/data-collection/${token}/step/${this.currentStep()}`,
        {
          responses,
        },
      )
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.http
            .post<any>(
              `${environment.apiUrl}/ecommerce/data-collection/${token}/submit`,
              {},
            )
            .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
              next: () => {
                this.submitted.set(true);
                this.submitting.set(false);
              },
              error: () => {
                this.submitting.set(false);
              },
            });
        },
        error: () => {
          this.submitting.set(false);
        },
      });
  }

  getItemWidth = getItemWidth;
  getItemWidthClass = getItemWidthClass;
  DEFAULT_TEMPLATE_ICON = DEFAULT_TEMPLATE_ICON;
  DEFAULT_SECTION_ICON = DEFAULT_SECTION_ICON;
  DEFAULT_TAB_ICON = DEFAULT_TAB_ICON;

  sortItems(items: any[]): any[] {
    return [...(items || [])].sort((a, b) => a.sort_order - b.sort_order);
  }

  private buildCurrentStepResponses(): any[] {
    const stepData = this.currentStepData();
    if (!stepData) return [];

    const allItems: any[] = [];
    for (const section of stepData.sections) {
      allItems.push(...(section.items || []));
      for (const child of section.child_sections || []) {
        allItems.push(...(child.items || []));
      }
    }

    return allItems.map((item: any) => {
      const fieldId = item.metadata_field.id;
      const rawValue = this.fieldValues().get(fieldId);
      const fieldType = item.metadata_field.field_type;

      const response: any = { field_id: fieldId };

      if (fieldType === 'number') {
        response.value_number = rawValue ? parseFloat(rawValue) : null;
      } else if (fieldType === 'checkbox') {
        response.value_bool = rawValue === true || rawValue === 'true';
      } else if (fieldType === 'date') {
        response.value_date = rawValue || null;
      } else {
        response.value_text = rawValue?.toString() || null;
      }

      return response;
    });
  }
}
