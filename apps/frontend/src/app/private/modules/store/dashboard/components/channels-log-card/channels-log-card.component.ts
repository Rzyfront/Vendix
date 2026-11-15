import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EChartsOption } from 'echarts';

import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import {
  InputButtonOption,
  InputButtonsComponent,
} from '../../../../../../shared/components/input-buttons/input-buttons.component';
import { RemindersLogComponent } from '../reminders-log/reminders-log.component';
import { AutoRotator, ROTATOR_TIMERS } from '../../utils/auto-rotator.util';

export type ChannelsCardView = 'channels' | 'log';

/** Rotation period of the Rosa / Bitácora selector. */
export const CHANNELS_CARD_ROTATION_MS = 5000;

/**
 * Dashboard "Ventas por Canal" card with a Rosa · Bitácora selector.
 *
 * Starts on Rosa and alternates every 5 s; the rotation pauses while the user
 * hovers/focuses the card, after a manual choice (until leaving the card) and
 * while a log form/confirmation is open. `?tab=bitacora` opens the log and
 * keeps it there.
 *
 * Both panels stay mounted and only their visibility toggles, so rotating does
 * not recreate the Bitácora (no new request, spinner or lost "show done"
 * choice every lap).
 */
@Component({
  selector: 'app-channels-log-card',
  standalone: true,
  imports: [
    ChartComponent,
    EmptyStateComponent,
    FormsModule,
    InputButtonsComponent,
    RemindersLogComponent,
  ],
  host: { class: 'block' },
  template: `
    <div
      class="h-full bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden flex flex-col"
      data-testid="channels-card"
      (mouseenter)="onEnter('hover')"
      (mouseleave)="onLeave('hover')"
      (focusin)="onEnter('focus')"
      (focusout)="onFocusOut($event)"
    >
      <div class="p-4 border-b border-border flex items-center justify-between gap-2">
        <div class="min-w-0">
          @if (view() === 'log') {
            <h3 class="font-semibold text-text-primary text-sm">Bitácora</h3>
            <p class="text-xs text-text-secondary">Recordatorios de la tienda</p>
          } @else {
            <h3 class="font-semibold text-text-primary text-sm">Ventas por Canal</h3>
            <p class="text-xs text-text-secondary">Distribución del período</p>
          }
        </div>
        <app-input-buttons
          [options]="options"
          [ngModel]="view()"
          (ngModelChange)="onSelect($event)"
          [hideLabelsOnMobile]="true"
          [equalWidth]="false"
          customWrapperClass="!w-auto !mt-0 shrink-0"
          customContainerClass="!h-9 !rounded-lg"
        ></app-input-buttons>
      </div>
      <div
        class="channels-card-panel p-4 flex-1 min-h-0 max-h-[400px] overflow-y-auto"
        data-testid="channels-card-log"
        [class.hidden]="view() !== 'log'"
      >
        <app-reminders-log />
      </div>
      <div
        class="channels-card-panel p-4 flex-1"
        data-testid="channels-card-channels"
        [class.hidden]="view() !== 'channels'"
      >
        @if (loading()) {
          <div class="h-56 flex items-center justify-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        } @else if (empty()) {
          <app-empty-state
            icon="pie-chart"
            title="No hay datos de canales"
            description="Realiza ventas para ver la distribución por canal"
            [showActionButton]="false"
            size="sm"
          />
        } @else {
          <app-chart [options]="chartOptions()" size="large"></app-chart>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .channels-card-panel {
        animation: channels-card-in 200ms ease-out;
      }

      @keyframes channels-card-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .channels-card-panel {
          animation: none;
        }
      }
    `,
  ],
})
export class ChannelsLogCardComponent {
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = input(false);
  readonly empty = input(false);
  readonly chartOptions = input<EChartsOption>({});

  readonly options: InputButtonOption[] = [
    { value: 'channels', label: 'Rosa', icon: 'pie-chart' },
    { value: 'log', label: 'Bitácora', icon: 'notebook-pen' },
  ];
  readonly view = signal<ChannelsCardView>('channels');

  private readonly remindersLog = viewChild(RemindersLogComponent);
  private readonly rotator = new AutoRotator<ChannelsCardView>(
    ['channels', 'log'],
    () => this.view(),
    (view) => this.view.set(view),
    CHANNELS_CARD_ROTATION_MS,
    inject(ROTATOR_TIMERS),
  );
  private hovered = false;
  private focused = false;

  constructor() {
    // `?tab=bitacora` (reminder notification deep link) opens the log, also
    // when the dashboard is already open.
    this.activatedRoute.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (params.get('tab') === 'bitacora') {
          this.view.set('log');
          this.rotator.setPaused('manual', true);
        }
      });

    // Never rotate away from the log while its form or a confirmation is open.
    effect(() => {
      const busy = this.remindersLog()?.busy() ?? false;
      untracked(() => this.rotator.setPaused('log-busy', busy));
    });

    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      this.rotator.start();
    }
    this.destroyRef.onDestroy(() => this.rotator.stop());
  }

  onSelect(view: ChannelsCardView): void {
    this.view.set(view);
    this.rotator.setPaused('manual', true);
  }

  onEnter(reason: 'hover' | 'focus'): void {
    if (reason === 'hover') this.hovered = true;
    else this.focused = true;
    this.rotator.setPaused(reason, true);
  }

  onLeave(reason: 'hover' | 'focus'): void {
    if (reason === 'hover') this.hovered = false;
    else this.focused = false;
    this.rotator.setPaused(reason, false);
    // A manual choice holds until the user has fully left the card.
    if (!this.hovered && !this.focused) {
      this.rotator.setPaused('manual', false);
    }
  }

  onFocusOut(event: FocusEvent): void {
    const card = event.currentTarget as HTMLElement | null;
    const next = event.relatedTarget as Node | null;
    if (card && next && card.contains(next)) return;
    this.onLeave('focus');
  }
}
