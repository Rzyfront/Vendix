import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit,
  inject,
} from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { filter, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { DestroyRef } from '@angular/core';
import { StatsComponent } from '../../../../../../shared/components';

import {
  MetricChartComponent,
  TimeRangeSelectorComponent,
  SlowEndpointsComponent,
} from '../../components';
import { MonitoringService } from '../../services';
import {
  PerformanceSnapshot,
  PerformanceHistory,
  TimeRange,
  TimeSeriesPoint,
} from '../../interfaces';

@Component({
  selector: 'app-monitoring-performance-page',
  standalone: true,
  imports: [
    StatsComponent,
    MetricChartComponent,
    TimeRangeSelectorComponent,
    SlowEndpointsComponent
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Stats Cards + Time Range -->
      <div class="flex items-center justify-between flex-wrap gap-3">
        <h3
          class="text-lg font-semibold"
          style="color: var(--color-text-primary);"
          >
          Performance
          @if (performanceSnapshot) {
            <span
              class="text-xs font-mono px-2 py-0.5 rounded-full ml-2"
              style="background: var(--color-surface); color: var(--color-text-muted);"
              >
              {{ performanceSnapshot.totalRecorded }} requests tracked
            </span>
          }
        </h3>
        <app-time-range-selector
          [selected]="performanceTimeRange"
          (rangeChange)="onTimeRangeChange($event)"
        ></app-time-range-selector>
      </div>
    
      <!-- Performance Stats Cards -->
      <div class="stats-container">
        <app-stats
          title="Avg Response"
          [value]="avgResponseTime"
          [smallText]="
            performanceSnapshot
              ? 'p95: ' + performanceSnapshot.responseTime.p95.toFixed(0) + 'ms'
              : ''
          "
          iconName="timer"
          [iconBgColor]="avgResponseTimeIconBg"
          [iconColor]="avgResponseTimeIconColor"
          [loading]="loadingPerformance"
          />
        <app-stats
          title="Requests/seg"
          [value]="reqPerSec"
          [smallText]="
            performanceSnapshot
              ? performanceSnapshot.activeRequests + ' activos'
              : ''
          "
          iconName="activity"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loadingPerformance"
          />
        <app-stats
          title="Error Rate (5m)"
          [value]="errorRate"
          [smallText]="
            performanceSnapshot
              ? performanceSnapshot.errors.last5min.errors5xx + ' errores 5xx'
              : ''
          "
          iconName="alert-triangle"
          [iconBgColor]="errorRateIconBg"
          [iconColor]="errorRateIconColor"
          [loading]="loadingPerformance"
          />
        <app-stats
          title="Event Loop p99"
          [value]="eventLoopP99"
          [smallText]="
            performanceSnapshot?.eventLoop?.current?.mean != null
              ? 'mean: ' +
                (performanceSnapshot?.eventLoop?.current?.mean?.toFixed(1) ??
                  '0') +
                'ms'
              : ''
          "
          iconName="cpu"
          [iconBgColor]="eventLoopIconBg"
          [iconColor]="eventLoopIconColor"
          [loading]="loadingPerformance"
          />
      </div>
    
      <!-- Response Time & Throughput Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <app-metric-chart
          label="Response Time (ms)"
          [datapoints]="rtP50Points"
          unit="ms"
          color="#22c55e"
          [secondaryDatapoints]="rtP95Points"
          secondaryLabel="p95"
          secondaryColor="#eab308"
          [tertiaryDatapoints]="rtP99Points"
          tertiaryLabel="p99"
          tertiaryColor="#ef4444"
          [loading]="loadingPerformance"
        ></app-metric-chart>
        <app-metric-chart
          label="Throughput (req/s)"
          [datapoints]="throughputPoints"
          unit=""
          color="#3b82f6"
          [loading]="loadingPerformance"
        ></app-metric-chart>
      </div>
    
      <!-- Slow Endpoints - Own section -->
      <app-slow-endpoints
        [endpoints]="performanceSnapshot?.slowestEndpoints ?? null"
        [loading]="loadingPerformance"
      ></app-slow-endpoints>
    
      <!-- Error & Event Loop Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <app-metric-chart
          label="Errores por minuto"
          [datapoints]="errors4xxPoints"
          unit=""
          color="#eab308"
          [secondaryDatapoints]="errors5xxPoints"
          secondaryLabel="5xx"
          secondaryColor="#ef4444"
          [loading]="loadingPerformance"
        ></app-metric-chart>
        <app-metric-chart
          label="Event Loop Lag p99 (ms)"
          [datapoints]="eventLoopLagPoints"
          unit="ms"
          color="#a855f7"
          [loading]="loadingPerformance"
        ></app-metric-chart>
      </div>
    </div>
    `,
})
export class MonitoringPerformancePage implements OnInit {
  private readonly monitoringService = inject(MonitoringService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  performanceSnapshot: PerformanceSnapshot | null = null;
  performanceHistory: PerformanceHistory | null = null;
  loadingPerformance = true;
  performanceTimeRange: TimeRange = '1h';

  // Pre-computed stats
  avgResponseTime = '--';
  avgResponseTimeIconBg = 'bg-emerald-100';
  avgResponseTimeIconColor = 'text-emerald-500';
  reqPerSec = '--';
  errorRate = '--';
  errorRateIconBg = 'bg-emerald-100';
  errorRateIconColor = 'text-emerald-500';
  eventLoopP99 = '--';
  eventLoopIconBg = 'bg-emerald-100';
  eventLoopIconColor = 'text-emerald-500';

  // Pre-computed chart data (NOT getters!)
  rtP50Points: TimeSeriesPoint[] = [];
  rtP95Points: TimeSeriesPoint[] = [];
  rtP99Points: TimeSeriesPoint[] = [];
  throughputPoints: TimeSeriesPoint[] = [];
  errors4xxPoints: TimeSeriesPoint[] = [];
  errors5xxPoints: TimeSeriesPoint[] = [];
  eventLoopLagPoints: TimeSeriesPoint[] = [];

  private paused = false;
  private visibilityHandler = () => {
    this.paused = document.hidden;
  };

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.visibilityHandler);

    timer(0, 60_000)
      .pipe(
        filter(() => !this.paused),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.fetchPerformance();
        this.fetchPerformanceHistory();
      });
  }

  onTimeRangeChange(range: TimeRange): void {
    this.performanceTimeRange = range;
    this.fetchPerformanceHistory();
  }

  private fetchPerformance(): void {
    this.monitoringService
      .getPerformance()
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => {
        this.performanceSnapshot = data;
        this.loadingPerformance = false;
        this.computeSnapshotValues();
        this.cdr.markForCheck();
      });
  }

  private fetchPerformanceHistory(): void {
    this.monitoringService
      .getPerformanceHistory(this.performanceTimeRange)
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => {
        this.performanceHistory = data;
        this.computeHistoryPoints();
        this.cdr.markForCheck();
      });
  }

  private computeSnapshotValues(): void {
    if (!this.performanceSnapshot) return;
    const s = this.performanceSnapshot;

    this.avgResponseTime = `${s.responseTime.mean.toFixed(0)}ms`;
    const ms = s.responseTime.mean;
    this.avgResponseTimeIconBg =
      ms >= 500 ? 'bg-red-100' : ms >= 200 ? 'bg-amber-100' : 'bg-emerald-100';
    this.avgResponseTimeIconColor =
      ms >= 500
        ? 'text-red-500'
        : ms >= 200
          ? 'text-amber-500'
          : 'text-emerald-500';

    this.reqPerSec = `${s.throughput.current.toFixed(1)}`;

    const e = s.errors.last5min;
    if (e.total === 0) {
      this.errorRate = '0%';
    } else {
      this.errorRate = `${(((e.errors4xx + e.errors5xx) / e.total) * 100).toFixed(1)}%`;
    }
    const rate =
      e.total > 0 ? ((e.errors4xx + e.errors5xx) / e.total) * 100 : 0;
    this.errorRateIconBg =
      rate >= 5 ? 'bg-red-100' : rate >= 1 ? 'bg-amber-100' : 'bg-emerald-100';
    this.errorRateIconColor =
      rate >= 5
        ? 'text-red-500'
        : rate >= 1
          ? 'text-amber-500'
          : 'text-emerald-500';

    this.eventLoopP99 = s.eventLoop?.current
      ? `${s.eventLoop.current.p99.toFixed(1)}ms`
      : '--';
    const elMs = s.eventLoop?.current?.p99 ?? 0;
    this.eventLoopIconBg =
      elMs >= 100
        ? 'bg-red-100'
        : elMs >= 50
          ? 'bg-amber-100'
          : 'bg-emerald-100';
    this.eventLoopIconColor =
      elMs >= 100
        ? 'text-red-500'
        : elMs >= 50
          ? 'text-amber-500'
          : 'text-emerald-500';
  }

  private computeHistoryPoints(): void {
    if (!this.performanceHistory) return;
    const h = this.performanceHistory;

    this.rtP50Points =
      h.responseTimes?.map((r) => ({ timestamp: r.timestamp, value: r.p50 })) ||
      [];
    this.rtP95Points =
      h.responseTimes?.map((r) => ({ timestamp: r.timestamp, value: r.p95 })) ||
      [];
    this.rtP99Points =
      h.responseTimes?.map((r) => ({ timestamp: r.timestamp, value: r.p99 })) ||
      [];
    this.throughputPoints =
      h.throughput?.map((t) => ({
        timestamp: t.timestamp,
        value: t.requestsPerSecond,
      })) || [];
    this.errors4xxPoints =
      h.errors?.map((e) => ({ timestamp: e.timestamp, value: e.errors4xx })) ||
      [];
    this.errors5xxPoints =
      h.errors?.map((e) => ({ timestamp: e.timestamp, value: e.errors5xx })) ||
      [];
    this.eventLoopLagPoints =
      h.eventLoopLag?.map((e) => ({ timestamp: e.timestamp, value: e.p99 })) ||
      [];
  }
}
