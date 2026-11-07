import { Component, DestroyRef, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import {
  MigrationPreview,
  MigrationResult,
  WorkflowVersionRow,
} from '../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';

const NO_TARGET = '__none__';

/**
 * "Migrar solicitudes": moves the live requests of an old version to the
 * published one, choosing the destination stage of each old stage. The preview
 * shows how many move where before anything changes.
 */
@Component({
  selector: 'app-migration-modal',
  standalone: true,
  imports: [AlertBannerComponent, ButtonComponent, IconComponent, ModalComponent, SelectorComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      title="Migrar solicitudes"
      subtitle="Pasa las solicitudes en curso de una versión vieja a la publicada"
      size="lg"
    >
      @if (candidates().length === 0) {
        <p class="text-sm text-text-secondary">Aún no hay una versión anterior de la que migrar.</p>
      } @else {
        <div class="flex flex-col gap-4">
          <app-selector
            label="Migrar desde"
            [options]="versionOptions()"
            [value]="fromId()"
            (valueChange)="selectFrom($event)"
          />
          @if (loading()) {
            <p class="text-sm text-text-secondary" role="status">Cargando etapas…</p>
          } @else if (oldStages().length > 0) {
            <p class="text-xs text-text-secondary">
              Destino: versión {{ targetVersion() }} (la publicada). Elige a qué etapa pasa cada etapa vieja.
            </p>
            <ul class="flex flex-col gap-2" aria-label="Mapa de etapas">
              @for (stage of oldStages(); track stage.key) {
                <li class="grid grid-cols-1 items-end gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2" data-testid="map-row">
                  <p class="text-sm font-semibold text-text-primary">{{ stage.name }} <span class="text-xs font-normal text-text-secondary">({{ stage.key }})</span></p>
                  <app-selector
                    size="sm"
                    [options]="targetOptions()"
                    [value]="stageMap()[stage.key] ?? noTarget"
                    (valueChange)="setTarget(stage.key, $event)"
                  />
                </li>
              }
            </ul>
            <div>
              <app-button variant="outline" [loading]="previewing()" (clicked)="preview()">
                <app-icon name="eye" [size]="14" slot="icon" />
                Vista previa
              </app-button>
            </div>
          }

          @if (error(); as message) {
            <p class="text-sm text-error" role="alert">{{ message }}</p>
          }

          @if (previewData(); as p) {
            <div class="flex flex-col gap-2" data-testid="migration-preview">
              <p class="text-sm font-semibold text-text-primary">
                {{ p.total }} {{ p.total === 1 ? 'solicitud en curso' : 'solicitudes en curso' }} en v{{ p.from_version.version }}
              </p>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead>
                    <tr class="text-xs text-text-secondary">
                      <th class="py-1 pr-3 font-medium">Etapa vieja</th>
                      <th class="py-1 pr-3 font-medium">Solicitudes</th>
                      <th class="py-1 pr-3 font-medium">Pasan a</th>
                      <th class="py-1 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of p.stages; track row.from_stage_key) {
                      <tr class="border-t border-border">
                        <td class="py-1 pr-3 text-text-primary">{{ row.from_stage_name }}</td>
                        <td class="py-1 pr-3 text-text-primary">{{ row.count }}</td>
                        <td class="py-1 pr-3 text-text-primary">{{ row.to_stage_name ?? '—' }}</td>
                        <td class="py-1" [class]="row.ok ? 'text-success' : 'text-error'">
                          {{ row.ok ? 'Lista' : (row.reason ?? 'Falta destino') }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (!p.ready) {
                <app-alert-banner variant="warning" icon="alert-triangle">
                  Hay etapas con solicitudes sin un destino válido. Corrige el mapa y vuelve a pedir la vista previa.
                </app-alert-banner>
              }
            </div>
          }

          @if (result(); as r) {
            <div class="flex flex-col gap-1" data-testid="migration-result">
              <p class="text-sm font-semibold text-text-primary">Migradas: {{ r.migrated }}</p>
              @for (f of r.failed; track f.instance_id) {
                <p class="text-xs text-error">{{ f.reference }}: {{ f.error }}</p>
              }
            </div>
          }
        </div>
      }
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cerrar</app-button>
        <app-button variant="primary" [disabled]="!canMigrate()" [loading]="migrating()" (clicked)="migrate()">
          Migrar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class MigrationModalComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly definitionId = input.required<number>();
  readonly versions = input.required<WorkflowVersionRow[]>();

  readonly noTarget = NO_TARGET;
  readonly fromId = signal<number | null>(null);
  readonly oldStages = signal<WorkflowStageDef[]>([]);
  readonly newStages = signal<WorkflowStageDef[]>([]);
  readonly stageMap = signal<Record<string, string>>({});
  readonly loading = signal(false);
  readonly previewing = signal(false);
  readonly migrating = signal(false);
  readonly error = signal<string | null>(null);
  readonly previewData = signal<MigrationPreview | null>(null);
  readonly result = signal<MigrationResult | null>(null);

  /** The published version is the newest one; older ones are the candidates. */
  private readonly latest = computed(() =>
    this.versions().reduce<WorkflowVersionRow | null>((a, v) => (!a || v.version > a.version ? v : a), null),
  );
  readonly targetVersion = computed(() => this.latest()?.version ?? 0);
  readonly candidates = computed(() =>
    [...this.versions()].filter((v) => v.id !== this.latest()?.id).sort((a, b) => b.version - a.version),
  );
  readonly versionOptions = computed(() =>
    this.candidates().map((v) => ({ value: v.id, label: `Versión ${v.version}` })),
  );
  readonly targetOptions = computed(() => [
    { value: NO_TARGET, label: 'Sin destino' },
    ...this.newStages().map((s) => ({ value: s.key, label: s.name })),
  ]);
  readonly canMigrate = computed(() => this.previewData()?.ready === true && !this.migrating());

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      untracked(() => {
        this.reset();
        const first = this.candidates()[0];
        if (first) this.selectFrom(first.id);
      });
    });
  }

  private reset(): void {
    this.fromId.set(null);
    this.oldStages.set([]);
    this.newStages.set([]);
    this.stageMap.set({});
    this.error.set(null);
    this.previewData.set(null);
    this.result.set(null);
  }

  selectFrom(value: string | number | null): void {
    const row = this.candidates().find((v) => v.id === Number(value));
    const target = this.latest();
    if (!row || !target) return;
    this.fromId.set(row.id);
    this.previewData.set(null);
    this.result.set(null);
    this.error.set(null);
    this.loading.set(true);
    forkJoin({
      from: this.api.getVersion(this.definitionId(), row.version),
      to: this.api.getVersion(this.definitionId(), target.version),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ from, to }) => {
          const oldStages = (from.definition as WorkflowDefinitionV1).stages.filter((s) => s.type !== 'end');
          const newStages = (to.definition as WorkflowDefinitionV1).stages;
          this.oldStages.set(oldStages);
          this.newStages.set(newStages);
          // Default: the stage with the same key.
          this.stageMap.set(
            Object.fromEntries(
              oldStages.filter((s) => newStages.some((n) => n.key === s.key)).map((s) => [s.key, s.key]),
            ),
          );
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(toWorkflowError(e).message);
          this.loading.set(false);
        },
      });
  }

  setTarget(from: string, value: string | number | null): void {
    this.previewData.set(null);
    this.stageMap.update((current) => {
      const { [from]: _old, ...rest } = current;
      return value === null || value === NO_TARGET ? rest : { ...rest, [from]: String(value) };
    });
  }

  private body(): { from_version_id: number; stage_map: Record<string, string> } | null {
    const id = this.fromId();
    return id === null ? null : { from_version_id: id, stage_map: this.stageMap() };
  }

  preview(): void {
    const body = this.body();
    if (!body) return;
    this.error.set(null);
    this.previewing.set(true);
    this.api
      .previewMigration(this.definitionId(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.previewData.set(data);
          this.previewing.set(false);
        },
        error: (e) => {
          this.error.set(toWorkflowError(e).message);
          this.previewing.set(false);
        },
      });
  }

  migrate(): void {
    const body = this.body();
    if (!body || !this.canMigrate()) return;
    this.error.set(null);
    this.migrating.set(true);
    this.api
      .migrateInstances(this.definitionId(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.migrating.set(false);
          this.result.set(res);
          this.previewData.set(null);
          if (res.failed.length === 0) this.toast.success(`${res.migrated} solicitudes migradas`);
          else this.toast.warning(`${res.migrated} migradas y ${res.failed.length} con error`);
        },
        error: (e) => {
          this.migrating.set(false);
          this.error.set(toWorkflowError(e).message);
          this.toast.error(toWorkflowError(e).message);
        },
      });
  }
}
