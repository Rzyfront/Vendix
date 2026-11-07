import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  WorkflowDefinitionV1,
  WorkflowFieldDef,
  WorkflowStageDef,
  WorkflowStageType,
} from '../../../../../shared/workflows/contract/workflow-contract';
import { validateWorkflowDefinition } from '../../../../../shared/workflows/contract/workflow-validator';
import {
  WorkflowDefinitionRow,
  WorkflowIssueView,
} from '../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';
import {
  EditorTab,
  STAGE_TYPE_LABEL,
  issueStageKey,
  moveItem,
  tabForIssue,
  uniqueKey,
} from './workflow-editor.utils';

export const AUTOSAVE_DELAY_MS = 3000;
export const GENERAL_BUCKET = '__general__';

/**
 * Signal store of the editor page (provided by the page, one per visit).
 * Holds the draft definition, selection, save state and validation results.
 * Every edit is an immutable update of `draft`; autosave runs 3 s after the
 * last change with the optimistic-lock token `draft_updated_at`.
 */
@Injectable()
export class WorkflowEditorStore {
  private readonly api = inject(WorkflowsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;

  readonly definitionId = signal<number | null>(null);
  readonly row = signal<WorkflowDefinitionRow | null>(null);
  readonly draft = signal<WorkflowDefinitionV1 | null>(null);
  readonly draftUpdatedAt = signal<string | null>(null);
  readonly selectedKey = signal<string | null>(null);
  readonly activeTab = signal<EditorTab>('general');
  readonly dirty = signal(false);
  readonly savingNow = signal(false);
  readonly lastSavedAt = signal<Date | null>(null);
  readonly conflict = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly backendIssues = signal<WorkflowIssueView[] | null>(null);
  readonly backendWarnings = signal<WorkflowIssueView[]>([]);

  readonly selectedStage = computed(() => {
    const key = this.selectedKey();
    return this.draft()?.stages.find((s) => s.key === key) ?? null;
  });

  readonly selectedIndex = computed(() => {
    const key = this.selectedKey();
    return this.draft()?.stages.findIndex((s) => s.key === key) ?? -1;
  });

  /** Structural check of the client contract (no store context). */
  readonly structural = computed(() => {
    const draft = this.draft();
    return draft ? validateWorkflowDefinition(draft) : null;
  });

  /** Errors from the last backend validation, else the structural ones. */
  readonly issues = computed<WorkflowIssueView[]>(() => {
    const backend = this.backendIssues();
    if (backend) return backend;
    return this.structural()?.errors ?? [];
  });

  readonly issuesByStage = computed(() => {
    const draft = this.draft();
    const map = new Map<string, WorkflowIssueView[]>();
    for (const issue of this.issues()) {
      const key = issueStageKey(issue, draft) ?? GENERAL_BUCKET;
      map.set(key, [...(map.get(key) ?? []), issue]);
    }
    return map;
  });

  readonly isPublished = computed(() => this.row()?.published_version != null);

  readonly statusText = computed(() => {
    const row = this.row();
    if (!row) return '';
    if (row.status === 'archived') return 'Archivado';
    if (row.published_version) {
      return this.hasUnpublished()
        ? `Cambios sin publicar (v${row.published_version.version})`
        : `Publicado v${row.published_version.version}`;
    }
    return 'Borrador';
  });

  readonly hasUnpublished = computed(() => {
    const row = this.row();
    return !!row && (this.dirty() || row.has_unpublished_changes);
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearTimer();
      // Flush pending edits when leaving the page before the debounce fires.
      if (this.dirty() && !this.conflict()) void this.saveNow();
    });
  }

  // ─── Loading / saving ──────────────────────────────────────────────

  load(id: number): void {
    this.definitionId.set(id);
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({ row: this.api.getDefinition(id), draft: this.api.getDraft(id) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: ({ row, draft }) => {
        this.row.set(row);
        this.applyDraft(draft.definition as WorkflowDefinitionV1, draft.draft_updated_at);
        this.loading.set(false);
      },
      error: (error) => {
        this.loadError.set(toWorkflowError(error).message);
        this.loading.set(false);
      },
    });
  }

  /** Discards local edits and reloads the server draft (after a conflict). */
  reload(): void {
    const id = this.definitionId();
    if (id === null) return;
    this.clearTimer();
    this.conflict.set(false);
    this.saveError.set(null);
    this.load(id);
  }

  private applyDraft(definition: WorkflowDefinitionV1, updatedAt: string | null): void {
    const draft: WorkflowDefinitionV1 = {
      ...definition,
      fields: definition?.fields ?? [],
      stages: definition?.stages ?? [],
    };
    this.draft.set(draft);
    this.draftUpdatedAt.set(updatedAt);
    this.dirty.set(false);
    this.backendIssues.set(null);
    const current = this.selectedKey();
    if (!current || !draft.stages.some((s) => s.key === current)) {
      this.selectedKey.set(draft.stages.find((s) => s.start)?.key ?? draft.stages[0]?.key ?? null);
    }
  }

  /** Replaces the whole draft (advanced JSON panel). */
  replaceDraft(definition: WorkflowDefinitionV1): void {
    this.commit(() => definition);
    const keys = definition.stages.map((s) => s.key);
    if (!keys.includes(this.selectedKey() ?? '')) this.selectedKey.set(keys[0] ?? null);
  }

  private commit(change: (draft: WorkflowDefinitionV1) => WorkflowDefinitionV1): void {
    const current = this.draft();
    if (!current) return;
    this.draft.set(change(current));
    this.dirty.set(true);
    this.backendIssues.set(null);
    this.scheduleSave();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleSave(): void {
    this.clearTimer();
    if (this.conflict()) return;
    this.timer = setTimeout(() => void this.saveNow(), AUTOSAVE_DELAY_MS);
  }

  /** Persists the draft now. Resolves true when the server holds the latest edit. */
  async saveNow(): Promise<boolean> {
    this.clearTimer();
    const id = this.definitionId();
    const draft = this.draft();
    if (id === null || !draft || this.conflict()) return false;
    if (this.saving) {
      this.scheduleSave();
      return false;
    }
    if (!this.dirty()) return true;
    this.saving = true;
    this.savingNow.set(true);
    try {
      const result = await firstValueFrom(
        this.api.saveDraft(id, draft, this.draftUpdatedAt()),
      );
      this.draftUpdatedAt.set(result.draft_updated_at);
      this.lastSavedAt.set(new Date());
      this.saveError.set(null);
      const changedMeanwhile = this.draft() !== draft;
      this.dirty.set(changedMeanwhile);
      if (changedMeanwhile) this.scheduleSave();
      return !changedMeanwhile;
    } catch (error) {
      const parsed = toWorkflowError(error);
      if (parsed.code === 'WORKFLOW_DRAFT_CONFLICT') this.conflict.set(true);
      this.saveError.set(parsed.message);
      return false;
    } finally {
      this.saving = false;
      this.savingNow.set(false);
    }
  }

  setRow(row: WorkflowDefinitionRow): void {
    this.row.set(row);
  }

  // ─── Selection ─────────────────────────────────────────────────────

  selectStage(key: string | null, tab?: EditorTab): void {
    this.selectedKey.set(key);
    if (tab) this.activeTab.set(tab);
  }

  goToIssue(issue: WorkflowIssueView): void {
    const key = issueStageKey(issue, this.draft());
    if (key) this.selectStage(key, tabForIssue(issue));
  }

  // ─── Definition-level edits ────────────────────────────────────────

  patchDefinition(patch: Partial<WorkflowDefinitionV1>): void {
    this.commit((d) => ({ ...d, ...patch }));
  }

  // ─── Stage edits ───────────────────────────────────────────────────

  updateStage(key: string, change: (stage: WorkflowStageDef) => WorkflowStageDef): void {
    this.commit((d) => ({
      ...d,
      stages: d.stages.map((s) => (s.key === key ? change(s) : s)),
    }));
  }

  addStage(type: WorkflowStageType): string {
    const draft = this.draft();
    if (!draft) return '';
    const key = uniqueKey(
      STAGE_TYPE_LABEL[type],
      draft.stages.map((s) => s.key),
      'etapa',
    );
    const stage: WorkflowStageDef = {
      key,
      name: STAGE_TYPE_LABEL[type],
      type,
      ...(type === 'end' ? { outcome: 'completed' as const } : {}),
      ...(type === 'automatic' || type === 'end'
        ? {}
        : { assignee: { kind: 'initiator' as const } }),
    };
    this.commit((d) => ({ ...d, stages: [...d.stages, stage] }));
    this.selectStage(key, 'general');
    return key;
  }

  duplicateStage(key: string): void {
    const draft = this.draft();
    const source = draft?.stages.find((s) => s.key === key);
    if (!draft || !source) return;
    const copyKey = uniqueKey(`${source.key}_copia`, draft.stages.map((s) => s.key), 'etapa');
    const copy: WorkflowStageDef = {
      ...JSON.parse(JSON.stringify(source)),
      key: copyKey,
      name: `${source.name} (copia)`,
    };
    delete copy.start;
    const index = draft.stages.findIndex((s) => s.key === key);
    this.commit((d) => ({
      ...d,
      stages: [...d.stages.slice(0, index + 1), copy, ...d.stages.slice(index + 1)],
    }));
    this.selectStage(copyKey, 'general');
  }

  /** Refuses (returns false) for the start stage. */
  deleteStage(key: string): boolean {
    const draft = this.draft();
    const stage = draft?.stages.find((s) => s.key === key);
    if (!draft || !stage || stage.start) return false;
    this.commit((d) => ({
      ...d,
      stages: d.stages
        .filter((s) => s.key !== key)
        .map((s) =>
          s.transitions?.some((t) => t.to === key)
            ? { ...s, transitions: s.transitions.filter((t) => t.to !== key) }
            : s,
        ),
    }));
    if (this.selectedKey() === key) {
      const rest = this.draft()?.stages ?? [];
      this.selectedKey.set(rest.find((s) => s.start)?.key ?? rest[0]?.key ?? null);
    }
    return true;
  }

  moveStage(from: number, to: number): void {
    this.commit((d) => ({ ...d, stages: moveItem(d.stages, from, to) }));
  }

  setStart(key: string): void {
    this.commit((d) => ({
      ...d,
      stages: d.stages.map((s) => {
        const { start: _start, ...rest } = s;
        return s.key === key ? { ...rest, start: true } : rest;
      }),
    }));
  }

  /** Renames a stage key and rewrites every transition that points to it. */
  renameStageKey(oldKey: string, newKey: string): boolean {
    const draft = this.draft();
    if (!draft || oldKey === newKey || draft.stages.some((s) => s.key === newKey)) return false;
    this.commit((d) => ({
      ...d,
      stages: d.stages.map((s) => {
        const renamed = s.key === oldKey ? { ...s, key: newKey } : s;
        return renamed.transitions
          ? {
              ...renamed,
              transitions: renamed.transitions.map((t) =>
                t.to === oldKey ? { ...t, to: newKey } : t,
              ),
            }
          : renamed;
      }),
    }));
    if (this.selectedKey() === oldKey) this.selectedKey.set(newKey);
    return true;
  }

  // ─── Field edits ───────────────────────────────────────────────────

  upsertField(field: WorkflowFieldDef, previousKey?: string): void {
    this.commit((d) => {
      const lookup = previousKey ?? field.key;
      const exists = d.fields.some((f) => f.key === lookup);
      const fields = exists
        ? d.fields.map((f) => (f.key === lookup ? field : f))
        : [...d.fields, field];
      if (!previousKey || previousKey === field.key) return { ...d, fields };
      return {
        ...d,
        fields,
        stages: d.stages.map((s) =>
          s.form ? { ...s, form: { fields: s.form.fields.map((k) => (k === previousKey ? field.key : k)) } } : s,
        ),
      };
    });
  }

  removeField(key: string): void {
    this.commit((d) => ({
      ...d,
      fields: d.fields.filter((f) => f.key !== key),
      stages: d.stages.map((s) =>
        s.form ? { ...s, form: { fields: s.form.fields.filter((k) => k !== key) } } : s,
      ),
    }));
  }
}
