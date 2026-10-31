import { Component, computed, inject, model, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  StoreUserSelectComponent,
} from '../../../../../../shared/components';
import { CrmService } from '../shared/crm.service';
import { SegmentOperator } from '../shared/crm-segments.interface';
import {
  FieldDef,
  GroupDraft,
  RuleDraft,
  SEGMENT_FIELDS,
  SEGMENT_MAX_RULES,
  SelectOption,
  blankRule,
  countRules,
  fieldDef,
  newRule,
  nextUid,
  operatorLabel,
} from './segments.utils';

const CONTROL =
  'h-10 rounded-lg border border-[var(--color-border)] bg-surface px-3 text-sm text-[var(--color-text-primary)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

function mapGroup(group: GroupDraft, uid: number, fn: (g: GroupDraft) => GroupDraft): GroupDraft {
  if (group.uid === uid) return fn(group);
  return { ...group, groups: group.groups.map((child) => mapGroup(child, uid, fn)) };
}

/**
 * Rule builder of a segment: one top-level and/or group plus optional nested
 * groups of one level. Fields and operators come from the closed catalog of
 * `segments.utils.ts`; the draft is turned into the API filter by the parent.
 */
@Component({
  selector: 'app-crm-segment-builder',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, ButtonComponent, IconComponent, StoreUserSelectComponent],
  template: `
    <ng-template #groupTpl let-group let-child="child">
      <div
        class="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] p-3"
        [style.background]="child ? 'var(--color-background)' : 'var(--color-surface, transparent)'"
      >
        <div class="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <span>Cumplen</span>
          <select
            [class]="control"
            aria-label="Cómo combinar las reglas"
            [ngModel]="group.op"
            (ngModelChange)="setOp(group.uid, $event)"
          >
            <option value="and">todas las reglas</option>
            <option value="or">alguna de las reglas</option>
          </select>
          @if (child) {
            <app-button variant="ghost" size="sm" class="ml-auto" (clicked)="removeGroup(group.uid)">
              <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
              Quitar grupo
            </app-button>
          }
        </div>

        @for (rule of group.rules; track rule.uid) {
          @let def = defOf(rule);
          <div class="flex flex-col gap-2 rounded-xl bg-[var(--color-background)] p-2 md:flex-row md:flex-wrap md:items-center">
            <select
              [class]="control"
              aria-label="Campo"
              [ngModel]="rule.field"
              (ngModelChange)="setField(group.uid, rule.uid, $event)"
            >
              @for (field of fields; track field.key) {
                @if (isAvailable(field)) {
                  <option [value]="field.key">{{ field.label }}</option>
                }
              }
            </select>

            <select
              [class]="control"
              aria-label="Condición"
              [ngModel]="rule.cmp"
              (ngModelChange)="setCmp(group.uid, rule.uid, $event)"
            >
              @for (cmp of def.operators; track cmp) {
                <option [value]="cmp">{{ opLabel(def, cmp) }}</option>
              }
            </select>

            @switch (mode(rule)) {
              @case ('bool') {
                <select
                  [class]="control"
                  aria-label="Valor"
                  [ngModel]="rule.value"
                  (ngModelChange)="patch(group.uid, rule.uid, { value: $event })"
                >
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              }
              @case ('days') {
                <input
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  [class]="control + ' w-28'"
                  aria-label="Días"
                  [ngModel]="rule.value"
                  (ngModelChange)="patch(group.uid, rule.uid, { value: $event })"
                />
              }
              @case ('multi') {
                <div class="flex flex-wrap gap-1" role="group" aria-label="Valores">
                  @for (option of optionsOf(def); track option.value) {
                    <button
                      type="button"
                      class="rounded-full border px-3 py-1 text-xs"
                      [class]="
                        rule.multi.includes(option.value)
                          ? 'border-primary bg-primary text-white'
                          : 'border-[var(--color-border)] bg-surface text-[var(--color-text-secondary)]'
                      "
                      [attr.aria-pressed]="rule.multi.includes(option.value)"
                      (click)="toggleMulti(group.uid, rule, option.value)"
                    >
                      {{ option.label }}
                    </button>
                  } @empty {
                    <span class="text-xs text-[var(--color-text-muted)]">Sin opciones disponibles</span>
                  }
                </div>
              }
              @case ('between') {
                <div class="flex items-center gap-2">
                  <input
                    [type]="inputType(def)"
                    [class]="control + ' w-36'"
                    aria-label="Desde"
                    [ngModel]="rule.value"
                    (ngModelChange)="patch(group.uid, rule.uid, { value: $event })"
                  />
                  <span class="text-sm text-[var(--color-text-secondary)]">y</span>
                  <input
                    [type]="inputType(def)"
                    [class]="control + ' w-36'"
                    aria-label="Hasta"
                    [ngModel]="rule.value2"
                    (ngModelChange)="patch(group.uid, rule.uid, { value2: $event })"
                  />
                </div>
              }
              @default {
                @if (def.kind === 'owner') {
                  <div class="min-w-[220px]">
                    <app-store-user-select
                      placeholder="Buscar persona del equipo..."
                      lookupMode="staff"
                      [value]="rule.value ? +rule.value : null"
                      (valueChange)="patch(group.uid, rule.uid, { value: $event ? '' + $event : '' })"
                    ></app-store-user-select>
                  </div>
                } @else if (def.kind === 'date' || def.kind === 'int' || def.kind === 'amount') {
                  <input
                    [type]="inputType(def)"
                    [class]="control + ' w-40'"
                    aria-label="Valor"
                    [ngModel]="rule.value"
                    (ngModelChange)="patch(group.uid, rule.uid, { value: $event })"
                  />
                } @else {
                  <select
                    [class]="control"
                    aria-label="Valor"
                    [ngModel]="rule.value"
                    (ngModelChange)="patch(group.uid, rule.uid, { value: $event })"
                  >
                    <option value="">Elige una opción</option>
                    @for (option of optionsOf(def); track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                }
              }
            }

            <button
              type="button"
              class="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]"
              aria-label="Quitar regla"
              [disabled]="totalRules() <= 1"
              (click)="removeRule(group.uid, rule.uid)"
            >
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          </div>
        }

        <div class="flex flex-wrap gap-2">
          <app-button variant="outline" size="sm" [disabled]="!canAddRule()" (clicked)="addRule(group.uid)">
            <app-icon name="plus" [size]="14" slot="icon"></app-icon>
            Agregar regla
          </app-button>
          @if (!child) {
            <app-button variant="outline" size="sm" [disabled]="!canAddRule()" (clicked)="addGroup()">
              <app-icon name="layers" [size]="14" slot="icon"></app-icon>
              Agregar grupo
            </app-button>
          }
        </div>

        @if (!child) {
          @for (nested of group.groups; track nested.uid) {
            <ng-container
              [ngTemplateOutlet]="groupTpl"
              [ngTemplateOutletContext]="{ $implicit: nested, child: true }"
            ></ng-container>
          }
        }
      </div>
    </ng-template>

    <ng-container
      [ngTemplateOutlet]="groupTpl"
      [ngTemplateOutletContext]="{ $implicit: draft(), child: false }"
    ></ng-container>
    @if (!canAddRule()) {
      <p class="mt-2 text-xs text-[var(--color-text-muted)]">Máximo {{ maxRules }} reglas por segmento.</p>
    }
  `,
})
export class SegmentBuilderComponent {
  private readonly crm = inject(CrmService);

  readonly draft = model.required<GroupDraft>();

  protected readonly control = CONTROL;
  protected readonly maxRules = SEGMENT_MAX_RULES;
  protected readonly fields = SEGMENT_FIELDS;

  private readonly tags = signal<SelectOption[]>([]);
  private readonly stages = signal<SelectOption[]>([]);
  private readonly tagsLoaded = signal(false);
  private readonly stagesLoaded = signal(false);

  protected readonly totalRules = computed(() => countRules(this.draft()));
  protected readonly canAddRule = computed(() => this.totalRules() < SEGMENT_MAX_RULES);

  constructor() {
    void this.loadLookups();
  }

  protected defOf(rule: RuleDraft): FieldDef {
    return fieldDef(rule.field) ?? SEGMENT_FIELDS[0];
  }

  /** A field whose lookup failed (no permission, offline) is not offered. */
  protected isAvailable(field: FieldDef): boolean {
    if (field.kind === 'tag') return this.tagsLoaded();
    if (field.kind === 'stage') return this.stagesLoaded();
    return true;
  }

  protected opLabel(def: FieldDef, cmp: SegmentOperator): string {
    return operatorLabel(def.kind, cmp);
  }

  protected optionsOf(def: FieldDef): readonly SelectOption[] {
    if (def.kind === 'tag') return this.tags();
    if (def.kind === 'stage') return this.stages();
    return def.options ?? [];
  }

  protected inputType(def: FieldDef): string {
    return def.kind === 'date' ? 'date' : 'number';
  }

  protected mode(rule: RuleDraft): 'bool' | 'days' | 'multi' | 'between' | 'single' {
    switch (rule.cmp) {
      case 'exists':
        return 'bool';
      case 'within_days':
      case 'older_than_days':
        return 'days';
      case 'in':
        return 'multi';
      case 'between':
        return 'between';
      default:
        return 'single';
    }
  }

  protected setOp(groupUid: number, op: 'and' | 'or'): void {
    this.draft.update((root) => mapGroup(root, groupUid, (g) => ({ ...g, op })));
  }

  protected setField(groupUid: number, ruleUid: number, field: string): void {
    const def = fieldDef(field);
    if (!def) return;
    this.replaceRule(groupUid, ruleUid, (rule) => ({ ...blankRule(def), uid: rule.uid }));
  }

  protected setCmp(groupUid: number, ruleUid: number, cmp: SegmentOperator): void {
    this.replaceRule(groupUid, ruleUid, (rule) => ({
      ...rule,
      cmp,
      value: cmp === 'exists' ? 'true' : '',
      value2: '',
      multi: [],
    }));
  }

  protected patch(groupUid: number, ruleUid: number, changes: Partial<RuleDraft>): void {
    this.replaceRule(groupUid, ruleUid, (rule) => ({ ...rule, ...changes }));
  }

  protected toggleMulti(groupUid: number, rule: RuleDraft, value: string): void {
    const multi = rule.multi.includes(value)
      ? rule.multi.filter((item) => item !== value)
      : [...rule.multi, value];
    this.patch(groupUid, rule.uid, { multi });
  }

  protected addRule(groupUid: number): void {
    if (!this.canAddRule()) return;
    this.draft.update((root) =>
      mapGroup(root, groupUid, (g) => ({ ...g, rules: [...g.rules, newRule(this.firstField())] })),
    );
  }

  protected addGroup(): void {
    if (!this.canAddRule()) return;
    this.draft.update((root) => ({
      ...root,
      groups: [
        ...root.groups,
        { uid: nextUid(), op: 'or', rules: [newRule(this.firstField())], groups: [] },
      ],
    }));
  }

  protected removeRule(groupUid: number, ruleUid: number): void {
    if (this.totalRules() <= 1) return;
    this.draft.update((root) => {
      const next = mapGroup(root, groupUid, (g) => ({
        ...g,
        rules: g.rules.filter((rule) => rule.uid !== ruleUid),
      }));
      // An emptied nested group disappears with its last rule.
      return { ...next, groups: next.groups.filter((g) => g.rules.length > 0) };
    });
  }

  protected removeGroup(groupUid: number): void {
    this.draft.update((root) => {
      const groups = root.groups.filter((g) => g.uid !== groupUid);
      // Keep at least one rule somewhere.
      return root.rules.length || groups.length
        ? { ...root, groups }
        : { ...root, groups, rules: [newRule(this.firstField())] };
    });
  }

  private firstField(): string {
    return SEGMENT_FIELDS.find((field) => this.isAvailable(field))?.key ?? 'total_spent';
  }

  private replaceRule(
    groupUid: number,
    ruleUid: number,
    fn: (rule: RuleDraft) => RuleDraft,
  ): void {
    this.draft.update((root) =>
      mapGroup(root, groupUid, (g) => ({
        ...g,
        rules: g.rules.map((rule) => (rule.uid === ruleUid ? fn(rule) : rule)),
      })),
    );
  }

  private async loadLookups(): Promise<void> {
    try {
      const tags = await firstValueFrom(this.crm.tags());
      this.tags.set(tags.map((tag) => ({ value: String(tag.id), label: tag.name })));
      this.tagsLoaded.set(true);
    } catch {
      // The tag field stays hidden when tags cannot be listed.
    }
    try {
      const pipelines = await firstValueFrom(this.crm.pipelines());
      const multiple = pipelines.length > 1;
      this.stages.set(
        pipelines.flatMap((pipeline) =>
          pipeline.stages
            .filter((stage) => stage.is_active !== false)
            .map((stage) => ({
              value: String(stage.id),
              label: multiple ? `${pipeline.name} · ${stage.name}` : stage.name,
            })),
        ),
      );
      this.stagesLoaded.set(true);
    } catch {
      // Stages need the pipeline permission; without it the field is hidden.
    }
  }
}
