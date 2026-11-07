import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  InputComponent,
  SelectorComponent,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { toWorkflowError } from '../../../utils/workflow-errors.util';
import {
  CollectionView,
  RecordDetail,
  RecordFieldDef,
  RecordValue,
} from '../../interfaces/records.interfaces';
import { RecordsApiService } from '../../services/records-api.service';
import { formFromValues, valuesFromForm } from '../../utils/records-ui.util';

type FormState = Record<string, string | boolean>;

/**
 * `/admin/workflows/records/collections/:collectionId/new` and
 * `/admin/workflows/records/:recordId/edit`: the form is generated from the
 * fields of the collection.
 */
@Component({
  selector: 'app-record-form-page',
  standalone: true,
  imports: [
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
    StickyHeaderComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        [title]="title()"
        [subtitle]="collection()?.name ?? ''"
        [icon]="collection()?.icon || 'folder-open'"
        variant="glass"
        [showBackButton]="true"
        [backRoute]="backRoute()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      @if (loadError()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ loadError() }}</app-alert-banner>
      } @else if (collection(); as c) {
        <div class="p-2 md:p-4">
          @if (formError()) {
            <app-alert-banner variant="danger" icon="alert-circle" data-testid="form-error">
              {{ formError() }}
            </app-alert-banner>
          }
          <app-card [responsive]="true">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              @for (f of c.fields; track f.key) {
                @switch (f.type) {
                  @case ('textarea') {
                    <div class="md:col-span-2">
                      <app-textarea
                        [label]="f.label"
                        [required]="f.required === true"
                        [rows]="3"
                        [error]="errors()[f.key]"
                        [ngModel]="text(f.key)"
                        (ngModelChange)="set(f.key, $event)"
                      />
                    </div>
                  }
                  @case ('boolean') {
                    <div class="flex items-end pb-2">
                      <app-toggle
                        [label]="f.label"
                        [checked]="flag(f.key)"
                        (toggled)="set(f.key, $event)"
                      />
                    </div>
                  }
                  @case ('select') {
                    <app-selector
                      [label]="f.label"
                      [required]="f.required === true"
                      [errorText]="errors()[f.key] || ''"
                      [options]="selectOptions(f)"
                      [value]="text(f.key)"
                      (valueChange)="set(f.key, $event === null ? '' : '' + $event)"
                    />
                  }
                  @case ('money') {
                    <app-input
                      type="text"
                      [currency]="true"
                      [label]="f.label"
                      [required]="f.required === true"
                      [error]="errors()[f.key]"
                      [ngModel]="text(f.key)"
                      (ngModelChange)="set(f.key, $event)"
                    />
                  }
                  @default {
                    <app-input
                      [type]="inputType(f)"
                      [label]="f.label"
                      [required]="f.required === true"
                      [error]="errors()[f.key]"
                      [ngModel]="text(f.key)"
                      (ngModelChange)="set(f.key, $event)"
                    />
                  }
                }
              }
            </div>
          </app-card>
          <div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <app-button variant="outline" (clicked)="cancel()">Cancelar</app-button>
            <app-button variant="primary" [loading]="saving()" (clicked)="save()">Guardar</app-button>
          </div>
        </div>
      } @else {
        <p class="py-8 text-center text-sm text-text-secondary" role="status">Cargando...</p>
      }
    </div>
  `,
})
export class RecordFormPageComponent implements OnInit {
  private readonly api = inject(RecordsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly collection = signal<CollectionView | RecordDetail['collection'] | null>(null);
  readonly recordId = signal<number | null>(null);
  readonly form = signal<FormState>({});
  readonly errors = signal<Record<string, string>>({});
  readonly loadError = signal('');
  readonly formError = signal('');
  readonly saving = signal(false);

  readonly title = computed(() => {
    const c = this.collection();
    if (!c) return 'Registro';
    return this.recordId() === null ? `Nuevo ${c.item_name.toLowerCase()}` : `Editar ${c.item_name.toLowerCase()}`;
  });

  readonly backRoute = computed(() => {
    const id = this.recordId();
    const c = this.collection();
    if (id !== null) return `/admin/workflows/records/${id}`;
    return c ? `/admin/workflows/records/collections/${c.id}` : '/admin/workflows/records';
  });

  readonly headerActions = computed(() => [
    {
      id: 'save',
      label: this.saving() ? 'Guardando...' : 'Guardar',
      icon: 'save',
      variant: 'primary' as const,
      disabled: this.saving(),
    },
  ]);

  ngOnInit(): void {
    const recordRaw = this.route.snapshot.paramMap.get('recordId');
    const collectionRaw = this.route.snapshot.paramMap.get('collectionId');
    const recordId = recordRaw === null ? null : Number(recordRaw);
    const collectionId = collectionRaw === null ? null : Number(collectionRaw);
    const valid = (n: number | null) => n === null || (Number.isInteger(n) && n > 0);
    if (!valid(recordId) || !valid(collectionId) || (recordId === null && collectionId === null)) {
      this.loadError.set('No se encontró el registro.');
      return;
    }
    if (recordId !== null) {
      this.recordId.set(recordId);
      this.api
        .getRecord(recordId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) => {
            this.collection.set(r.collection);
            this.form.set(formFromValues(r.collection.fields, r.values));
          },
          error: (error) => this.loadError.set(toWorkflowError(error).message),
        });
      return;
    }
    this.api
      .getCollection(collectionId as number)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.collection.set(c);
          this.form.set(formFromValues(c.fields, {}));
        },
        error: (error) => this.loadError.set(toWorkflowError(error).message),
      });
  }

  text(key: string): string {
    const v = this.form()[key];
    return typeof v === 'string' ? v : '';
  }

  flag(key: string): boolean {
    return this.form()[key] === true;
  }

  set(key: string, value: string | boolean | null): void {
    this.form.update((f) => ({ ...f, [key]: value === null ? '' : value }));
  }

  inputType(f: RecordFieldDef): 'text' | 'email' | 'tel' | 'number' | 'date' {
    switch (f.type) {
      case 'email':
        return 'email';
      case 'phone':
        return 'tel';
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      default:
        return 'text';
    }
  }

  selectOptions(f: RecordFieldDef): { value: string; label: string }[] {
    const options = f.options ?? [];
    return f.required ? options : [{ value: '', label: 'Sin elegir' }, ...options];
  }

  onHeaderAction(id: string): void {
    if (id === 'save') this.save();
  }

  cancel(): void {
    this.router.navigateByUrl(this.backRoute());
  }

  save(): void {
    const c = this.collection();
    if (!c || this.saving()) return;
    const missing: Record<string, string> = {};
    for (const f of c.fields) {
      if (!f.required || f.type === 'boolean') continue;
      if (this.text(f.key).trim() === '') missing[f.key] = `"${f.label}" es obligatorio.`;
    }
    this.errors.set(missing);
    this.formError.set('');
    if (Object.keys(missing).length > 0) {
      this.formError.set('Completa los campos obligatorios.');
      return;
    }
    const id = this.recordId();
    const values = valuesFromForm(c.fields, this.form(), id !== null);
    this.saving.set(true);
    const request =
      id === null
        ? this.api.createRecord(c.id, values as Record<string, RecordValue>)
        : this.api.updateRecord(id, values);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.toast.success(id === null ? 'Registro creado' : 'Registro actualizado');
        this.router.navigate(['/admin/workflows/records', saved.id]);
      },
      error: (error) => {
        this.saving.set(false);
        const parsed = toWorkflowError(error);
        const issues = (parsed.details as { errors?: { field: string; message: string }[] } | null)?.errors;
        if (issues?.length) {
          this.errors.set(Object.fromEntries(issues.map((i) => [i.field, i.message])));
        }
        this.formError.set(parsed.message);
      },
    });
  }
}
