import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  ButtonComponent,
  ModalComponent,
  MultiSelectorComponent,
  MultiSelectorOption,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  WorkflowAccessDoc,
  WorkflowAccessGroup,
  WorkflowAccessView,
} from '../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';

interface GroupDraft {
  roles: string[];
  users: number[];
}

/** One editable section of the panel: "Quién diseña", "Quién ve" or a stage. */
interface Section {
  id: string;
  title: string;
  hint: string;
}

const DESIGN = 'design';
const VIEW = 'view';
const STAGE_PREFIX = 'stage:';

const EMPTY: GroupDraft = { roles: [], users: [] };

/** Drafts of the server document (what a section shows before any edit). */
export function draftsFromAccess(access: WorkflowAccessDoc | null): Record<string, GroupDraft> {
  const out: Record<string, GroupDraft> = {};
  const take = (id: string, group: WorkflowAccessGroup | undefined) => {
    if (group) out[id] = { roles: [...group.roles], users: [...group.user_ids] };
  };
  take(DESIGN, access?.design);
  take(VIEW, access?.view);
  for (const [key, stage] of Object.entries(access?.stages ?? {})) {
    take(STAGE_PREFIX + key, stage.act);
  }
  return out;
}

/** The document to save: empty sections are dropped, nothing left means `null` (open). */
export function accessFromDrafts(drafts: Record<string, GroupDraft>): WorkflowAccessDoc | null {
  const group = (id: string): WorkflowAccessGroup | undefined => {
    const d = drafts[id];
    return d && (d.roles.length || d.users.length)
      ? { roles: [...d.roles], user_ids: [...d.users] }
      : undefined;
  };
  const doc: WorkflowAccessDoc = {};
  const design = group(DESIGN);
  if (design) doc.design = design;
  const view = group(VIEW);
  if (view) doc.view = view;
  const stages: Record<string, { act: WorkflowAccessGroup }> = {};
  for (const id of Object.keys(drafts)) {
    if (!id.startsWith(STAGE_PREFIX)) continue;
    const act = group(id);
    if (act) stages[id.slice(STAGE_PREFIX.length)] = { act };
  }
  if (Object.keys(stages).length) doc.stages = stages;
  return Object.keys(doc).length ? doc : null;
}

/**
 * "Permisos" of a flow (P7.3): who designs it, who sees it and who decides each
 * stage, each as roles plus people. An empty section is open to everyone. Who
 * starts the flow is the `start_roles` of its published version, so it is only
 * shown here. Saving applies at once (no new version).
 */
@Component({
  selector: 'app-workflow-access-panel',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    AlertBannerComponent,
    MultiSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Permisos"
      [subtitle]="flowName()"
      size="lg"
    >
      @if (loading()) {
        <p class="py-6 text-center text-sm text-text-secondary" role="status">Cargando...</p>
      } @else if (view(); as v) {
        <p class="text-sm text-text-secondary">
          Elige qué roles o personas diseñan, ven y deciden en este flujo. Si dejas una sección
          vacía, queda abierta para todos. Dueño, administradores con permiso de gestión y
          superadmin siempre tienen acceso.
        </p>

        @for (section of sections(); track section.id) {
          <section class="mt-4 rounded-xl border border-border p-3" [attr.data-testid]="'section-' + section.id">
            <h3 class="text-sm font-semibold text-text-primary">{{ section.title }}</h3>
            <p class="mb-2 text-xs text-text-secondary">{{ section.hint }}</p>
            <div class="grid gap-3 sm:grid-cols-2">
              <app-multi-selector
                label="Roles"
                placeholder="Abierto"
                [options]="roleOptions()"
                [ngModel]="draftOf(section.id).roles"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="setRoles(section.id, $event)"
              />
              <app-multi-selector
                label="Personas"
                placeholder="Abierto"
                [options]="userOptions()"
                [ngModel]="draftOf(section.id).users"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="setUsers(section.id, $event)"
              />
            </div>
          </section>
        }

        <section class="mt-4 rounded-xl border border-border p-3" data-testid="section-start">
          <h3 class="text-sm font-semibold text-text-primary">Quién inicia</h3>
          <p class="text-xs text-text-secondary">
            Se define en los ajustes de inicio del flujo (roles que pueden iniciarlo) y se aplica
            al publicar. Aquí solo se muestra.
          </p>
          <p class="mt-2 text-sm text-text-primary">
            @if (v.start_roles.length) {
              {{ v.start_roles.join(', ') }}
            } @else {
              Abierto: cualquier persona con permiso de iniciar solicitudes.
            }
          </p>
        </section>

        @if (errorMessage()) {
          <app-alert-banner variant="danger" icon="alert-circle" class="mt-3">
            {{ errorMessage() }}
          </app-alert-banner>
        }
      } @else if (errorMessage()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ errorMessage() }}</app-alert-banner>
      }

      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="onOpenChange(false)">Cerrar</app-button>
        @if (view()) {
          <app-button variant="primary" [loading]="saving()" (clicked)="save()">
            Guardar permisos
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class WorkflowAccessPanelComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly definitionId = input<number | null>(null);
  readonly flowName = input<string>('');

  readonly view = signal<WorkflowAccessView | null>(null);
  readonly drafts = signal<Record<string, GroupDraft>>({});
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal('');

  readonly sections = computed<Section[]>(() => [
    {
      id: DESIGN,
      title: 'Quién diseña',
      hint: 'Pueden editar, publicar, archivar y cambiar los permisos del flujo.',
    },
    {
      id: VIEW,
      title: 'Quién ve',
      hint: 'Pueden ver el flujo en las listas. Quienes pueden iniciarlo también lo ven.',
    },
    ...(this.view()?.stages ?? []).map((stage) => ({
      id: STAGE_PREFIX + stage.key,
      title: `Quién decide: ${stage.name}`,
      hint: 'Solo ellos pueden completar o votar las tareas de esta etapa.',
    })),
  ]);
  readonly roleOptions = computed<MultiSelectorOption[]>(() =>
    (this.view()?.options.roles ?? []).map((role) => ({ value: role, label: role })),
  );
  readonly userOptions = computed<MultiSelectorOption[]>(() =>
    (this.view()?.options.users ?? []).map((user) => ({ value: user.id, label: user.name })),
  );

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const id = this.definitionId();
      untracked(() => {
        if (open && id) this.load(id);
      });
    });
  }

  onOpenChange(open: boolean): void {
    this.isOpen.set(open);
    if (!open) {
      this.view.set(null);
      this.errorMessage.set('');
    }
  }

  draftOf(id: string): GroupDraft {
    return this.drafts()[id] ?? EMPTY;
  }

  setRoles(id: string, value: (string | number)[] | null): void {
    this.patch(id, { roles: (value ?? []).map(String) });
  }

  setUsers(id: string, value: (string | number)[] | null): void {
    this.patch(id, { users: (value ?? []).map(Number) });
  }

  save(): void {
    const id = this.definitionId();
    if (!id || this.saving()) return;
    this.saving.set(true);
    this.errorMessage.set('');
    this.api
      .updateAccess(id, accessFromDrafts(this.drafts()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Permisos guardados');
          this.onOpenChange(false);
        },
        error: (error) => {
          this.saving.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }

  private patch(id: string, change: Partial<GroupDraft>): void {
    this.drafts.update((all) => ({ ...all, [id]: { ...(all[id] ?? EMPTY), ...change } }));
  }

  private load(id: number): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.api
      .getAccess(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (view) => {
          this.view.set(view);
          this.drafts.set(draftsFromAccess(view.access));
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(toWorkflowError(error).message);
        },
      });
  }
}
