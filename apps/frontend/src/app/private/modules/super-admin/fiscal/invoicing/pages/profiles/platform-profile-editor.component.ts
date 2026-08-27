import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { environment } from '../../../../../../../../environments/environment';

/**
 * Editor de perfil de facturación del riel plataforma (VENDIX_ADMIN).
 *
 * Mirror mínimo del editor de tienda: carga plantilla DIAN → crear o edita
 * un perfil existente. Las secciones detalladas (AIU, retenciones, etc.)
 * reutilizan los componentes en shared/components/invoice-sections/* con
 * context='platform' (P2.2) en F.5+; por ahora el editor crea con la
 * config que viene del template sin secciones adicionales (el operador
 * puede ajustar luego vía editor de tienda-style si necesita).
 */

interface PlatformProfileTemplate {
  key: string;
  label: string;
  description: string;
  operation_type: string;
  template_version: number;
  config: any;
}

@Component({
  selector: 'app-platform-profile-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    CardComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    IconComponent,
  ],
  template: `
    <div class="p-4 max-w-3xl mx-auto">
      <app-card [title]="editing() ? 'Editar perfil' : 'Nuevo perfil plataforma'" icon="file-stack">
        <form [formGroup]="form" class="flex flex-col gap-4">
          <app-input
            label="Nombre del perfil"
            placeholder="Ej: AIU obras civiles"
            formControlName="name"
          ></app-input>

          <app-selector
            label="Tipo de operación DIAN"
            formControlName="operation_type"
            [options]="operationTypeOptions"
          ></app-selector>

          @if (templates().length > 0) {
            <app-selector
              label="Plantilla DIAN inicial"
              formControlName="template_key"
              [options]="templateOptions()"
            ></app-selector>
          }

          <app-toggle
            label="Marcar como predeterminado"
            formControlName="is_default"
          ></app-toggle>

          <div class="flex justify-end gap-3 mt-4">
            <a routerLink="../">
              <app-button variant="secondary">Cancelar</app-button>
            </a>
            <app-button
              variant="primary"
              icon="check"
              [disabled]="form.invalid || saving()"
              (clicked)="onSave()"
            >
              {{ saving() ? 'Guardando…' : 'Guardar perfil' }}
            </app-button>
          </div>
        </form>
      </app-card>
    </div>
  `,
})
export class PlatformProfileEditorComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  readonly form: FormGroup;
  readonly templates = signal<PlatformProfileTemplate[]>([]);
  readonly saving = signal(false);
  readonly editing = signal(false);

  readonly operationTypeOptions = [
    { value: '10', label: '10 — Estándar' },
    { value: '09', label: '09 — AIU (E.T. art. 462-1)' },
    { value: '11', label: '11 — Mandato' },
    { value: '12', label: '12 — Consorcio' },
  ];

  readonly templateOptions = computed(() =>
    this.templates().map((t) => ({
      value: t.key,
      label: `${t.label} (op ${t.operation_type})`,
    })),
  );

  constructor() {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(1)]],
      operation_type: ['10', [Validators.required]],
      template_key: ['dian-standard'],
      is_default: [false],
    });
    this.loadTemplates();
    this.route.params.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      if (p['id']) {
        this.editing.set(true);
        this.loadExisting(Number(p['id']));
      }
    });
  }

  private loadTemplates() {
    firstValueFrom(
      this.http.get<{ data: PlatformProfileTemplate[] }>(
        `${environment.apiUrl}/superadmin/subscriptions/fiscal/profiles/templates`,
      ),
    )
      .then((r) => this.templates.set(r.data || []))
      .catch(() => this.templates.set([]));
  }

  private loadExisting(id: number) {
    firstValueFrom(
      this.http.get<{ data: any }>(
        `${environment.apiUrl}/superadmin/subscriptions/fiscal/profiles/${id}`,
      ),
    )
      .then((r) => {
        const p = r.data;
        this.form.patchValue({
          name: p.name,
          operation_type: p.operation_type,
          is_default: p.is_default,
        });
      })
      .catch((err: HttpErrorResponse) => {
        this.toast.error('Perfil no encontrado', err.error?.message || '');
        this.router.navigate(['profiles']);
      });
  }

  onSave() {
    if (this.form.invalid) return;
    this.saving.set(true);
    const v = this.form.value;
    const template = this.templates().find((t) => t.key === v.template_key);
    const body: any = {
      name: v.name?.trim(),
      operation_type: v.operation_type,
      is_default: v.is_default,
      config: template?.config ?? this.fallbackConfig(v.operation_type),
    };

    const url = `${environment.apiUrl}/superadmin/subscriptions/fiscal/profiles`;
    const op$ = this.editing()
      ? this.http.put(`${url}/${this.route.snapshot.params['id']}`, body)
      : this.http.post(url, body);

    op$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Perfil guardado', body.name);
        this.router.navigate(['profiles']);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        const code = (err.error as any)?.error_code || 'ERR';
        this.toast.error(`${code}: ${err.error?.message || 'Error al guardar'}`, '');
      },
    });
  }

  private fallbackConfig(op: string): any {
    return {
      config_version: 1,
      general: { description: null, internal_note: null },
      accounting: {
        revenue_account_by_bucket: { administracion: null, imprevistos: null, utilidad: null, costo: null },
        vat_payable_account: null,
        mapping_key_overrides: {},
      },
      model_lines: [],
      format: { template_id: null, template_key: null, show_aiu_breakdown: false, display_decimals: 2 },
      dian: { document_type: null, operation_type: op, contract_object: null },
    };
  }
}
