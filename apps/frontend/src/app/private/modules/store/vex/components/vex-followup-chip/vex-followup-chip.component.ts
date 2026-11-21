import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  formatStoreDateTime,
  toStoreWallClock,
} from '../../../../../../shared/utils/date.util';
import { VexFollowup, VexFollowupEdits } from '../../models/vex.models';
import { VEX_COPY } from '../../vex-copy';

/** Longest title the server accepts for a saved follow-up. */
export const FOLLOWUP_TITLE_MAX = 120;

/**
 * What the form sends when the person saves an edited card: only trimmed
 * text, and `null` for a cleared date (a dateless log entry).
 */
export function buildFollowupEdits(form: {
  title: string;
  remind_at: string;
}): VexFollowupEdits {
  return {
    title: form.title.trim(),
    remind_at: form.remind_at ? form.remind_at : null,
  };
}

/**
 * A follow-up Vex detected in the conversation («te aviso el martes»). Nothing
 * is written until the person presses «Guardar»; «Editar» lets them fix the
 * text or the date first, «No» closes it for good, and «No sugerir en este
 * chat» silences further suggestions in this conversation.
 */
@Component({
  selector: 'vendix-vex-followup-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonComponent, IconComponent, InputComponent],
  host: { class: 'block' },
  template: `
    @if (followup().status === 'saved') {
      <p
        class="inline-flex items-center gap-2 rounded-full border border-success/25 bg-success/10 px-3 py-1 text-xs font-semibold text-success"
        role="status"
      >
        <app-icon name="check" [size]="14"></app-icon>
        {{ savedLabel() }}
      </p>
    } @else if (followup().status === 'suggested') {
      <section
        class="rounded-2xl border border-primary/25 bg-primary/5 p-3 flex flex-col gap-3"
        [attr.aria-label]="copy.region_label"
      >
        <div class="flex items-start gap-2 min-w-0">
          <app-icon
            class="text-primary shrink-0 mt-0.5"
            [name]="followup().kind === 'reminder' ? 'bell' : 'notebook-pen'"
            [size]="16"
          ></app-icon>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-primary-on-tint">
              {{ followup().kind === 'reminder' ? copy.heading_reminder : copy.heading_log }}
            </p>
            @if (!editing()) {
              <p class="text-sm text-text-primary break-words">{{ followup().title }}</p>
              <p class="text-xs text-text-secondary">{{ whenLabel() }}</p>
            }
          </div>
        </div>

        @if (editing()) {
          <form class="flex flex-col gap-3" [formGroup]="form" (ngSubmit)="saveEdited()">
            <app-input
              [label]="copy.field_title"
              [required]="true"
              [maxlength]="titleMax"
              formControlName="title"
              [control]="form.controls.title"
              [error]="titleError()"
            />
            <app-input
              [label]="copy.field_when"
              type="datetime-local"
              [helperText]="copy.field_when_hint"
              formControlName="remind_at"
              [control]="form.controls.remind_at"
            />
            <div class="flex flex-wrap items-center gap-2">
              <app-button type="submit" size="sm" [loading]="busy()" [disabled]="busy()">
                {{ copy.save }}
              </app-button>
              <app-button
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                (clicked)="editing.set(false)"
              >
                {{ copy.cancel_edit }}
              </app-button>
            </div>
          </form>
        } @else {
          <div class="flex flex-wrap items-center gap-2">
            <app-button
              size="sm"
              [loading]="busy()"
              [disabled]="busy()"
              (clicked)="save.emit({})"
            >
              {{ copy.save }}
            </app-button>
            <app-button
              variant="outline"
              size="sm"
              [disabled]="busy()"
              (clicked)="startEditing()"
            >
              {{ copy.edit }}
            </app-button>
            <app-button
              variant="ghost"
              size="sm"
              [disabled]="busy()"
              [ariaLabel]="copy.dismiss_aria"
              (clicked)="dismiss.emit()"
            >
              {{ copy.dismiss }}
            </app-button>
            <app-button
              variant="ghost"
              size="sm"
              [disabled]="busy()"
              (clicked)="mute.emit()"
            >
              {{ copy.mute }}
            </app-button>
          </div>
        }
      </section>
    }
  `,
})
export class VexFollowupChipComponent {
  readonly followup = input.required<VexFollowup>();
  /** IANA zone of the store: dates are shown and edited in it. */
  readonly timezone = input.required<string>();
  readonly busy = input(false);

  readonly save = output<VexFollowupEdits>();
  readonly dismiss = output<void>();
  readonly mute = output<void>();

  protected readonly copy = VEX_COPY.followup;
  protected readonly titleMax = FOLLOWUP_TITLE_MAX;
  protected readonly editing = signal(false);
  protected readonly titleError = signal('');

  protected readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    remind_at: new FormControl('', { nonNullable: true }),
  });

  protected readonly whenLabel = computed(() => {
    const at = this.followup().remind_at;
    if (!at) return this.copy.no_date;
    return formatStoreDateTime(at, this.timezone(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });
  });

  protected readonly savedLabel = computed(() =>
    this.followup().kind === 'reminder' && this.followup().remind_at
      ? this.copy.saved_reminder
      : this.copy.saved_log,
  );

  protected startEditing(): void {
    const followup = this.followup();
    this.form.setValue({
      title: followup.title,
      remind_at: followup.remind_at
        ? toStoreWallClock(followup.remind_at, this.timezone())
        : '',
    });
    this.titleError.set('');
    this.editing.set(true);
  }

  protected saveEdited(): void {
    const edits = buildFollowupEdits(this.form.getRawValue());
    if (!edits.title) {
      this.titleError.set(this.copy.title_required);
      return;
    }
    this.titleError.set('');
    this.save.emit(edits);
  }
}
