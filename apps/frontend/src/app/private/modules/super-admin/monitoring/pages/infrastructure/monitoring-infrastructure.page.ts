import { Component, inject, DestroyRef } from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { filter, map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  MetricChartComponent,
  TimeRangeSelectorComponent,
} from '../../components';
import { MonitoringService } from '../../services';
import {
  Ec2MetricsResponse,
  RdsMetricsResponse,
  TimeRange,
} from '../../interfaces';

@Component({
  selector: 'app-monitoring-infrastructure-page',
  standalone: true,
  imports: [IconComponent, MetricChartComponent, TimeRangeSelectorComponent],
  template: `
    <!-- EC2 Metrics Section -->
    <div class="space-y-6">
      <div
        class="rounded-card shadow-card"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div
          class="flex justify-between items-center p-6"
          style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(249,115,22,0.05) 0%, transparent 100%);"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center bg-orange-500/10"
            >
              <app-icon
                name="server"
                [size]="16"
                class="text-orange-500"
              ></app-icon>
            </div>
            <h3
              class="text-lg font-semibold"
              style="color: var(--color-text-primary);"
            >
              Metricas EC2
            </h3>
          </div>
          <app-time-range-selector
            [selected]="ec2TimeRange"
            (rangeChange)="onEc2TimeRangeChange($event)"
          ></app-time-range-selector>
        </div>
        <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <app-metric-chart
            label="CPU Utilization"
            [datapoints]="ec2Metrics?.cpu?.utilization?.datapoints ?? null"
            unit="%"
            color="#f97316"
            [loading]="loadingEc2"
          ></app-metric-chart>
          <app-metric-chart
            label="Network I/O"
            [datapoints]="ec2Metrics?.network?.bytesIn?.datapoints ?? null"
            unit="bytes"
            color="#3b82f6"
            [secondaryDatapoints]="
              ec2Metrics?.network?.bytesOut?.datapoints ?? null
            "
            secondaryLabel="Out"
            secondaryColor="#ef4444"
            [loading]="loadingEc2"
          ></app-metric-chart>
          <app-metric-chart
            label="Disk Read"
            [datapoints]="ec2Metrics?.disk?.readBytes?.datapoints ?? null"
            unit="bytes"
            color="#8b5cf6"
            [loading]="loadingEc2"
          ></app-metric-chart>
          <app-metric-chart
            label="Disk Write"
            [datapoints]="ec2Metrics?.disk?.writeBytes?.datapoints ?? null"
            unit="bytes"
            color="#ec4899"
            [loading]="loadingEc2"
          ></app-metric-chart>
        </div>
      </div>

      <!-- RDS Metrics Section -->
      <div
        class="rounded-card shadow-card"
        style="background: var(--color-surface); border: 1px solid var(--color-border);"
      >
        <div
          class="flex justify-between items-center p-6"
          style="border-bottom: 1px solid var(--color-border); background: linear-gradient(135deg, rgba(16,185,129,0.05) 0%, transparent 100%);"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10"
            >
              <app-icon
                name="database"
                [size]="16"
                class="text-emerald-500"
              ></app-icon>
            </div>
            <h3
              class="text-lg font-semibold"
              style="color: var(--color-text-primary);"
            >
              Metricas RDS (PostgreSQL)
            </h3>
          </div>
          <app-time-range-selector
            [selected]="rdsTimeRange"
            (rangeChange)="onRdsTimeRangeChange($event)"
          ></app-time-range-selector>
        </div>
        <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <app-metric-chart
            label="CPU Utilization"
            [datapoints]="rdsMetrics?.cpu?.utilization?.datapoints ?? null"
            unit="%"
            color="#10b981"
            [loading]="loadingRds"
          ></app-metric-chart>
          <app-metric-chart
            label="Conexiones Activas"
            [datapoints]="rdsMetrics?.connections?.active?.datapoints ?? null"
            unit=""
            color="#6366f1"
            [loading]="loadingRds"
          ></app-metric-chart>
          <app-metric-chart
            label="IOPS (Read/Write)"
            [datapoints]="rdsMetrics?.iops?.read?.datapoints ?? null"
            unit="ops"
            color="#3b82f6"
            [secondaryDatapoints]="rdsMetrics?.iops?.write?.datapoints ?? null"
            secondaryLabel="Write"
            secondaryColor="#f97316"
            [loading]="loadingRds"
          ></app-metric-chart>
          <app-metric-chart
            label="Latencia (Read/Write)"
            [datapoints]="rdsMetrics?.latency?.read?.datapoints ?? null"
            unit="ms"
            color="#14b8a6"
            [secondaryDatapoints]="
              rdsMetrics?.latency?.write?.datapoints ?? null
            "
            secondaryLabel="Write"
            secondaryColor="#f43f5e"
            [loading]="loadingRds"
          ></app-metric-chart>
        </div>
      </div>
    </div>
  `,
})
export class MonitoringInfrastructurePage {
  private readonly monitoringService = inject(MonitoringService);
  private readonly destroyRef = inject(DestroyRef);

  ec2Metrics: Ec2MetricsResponse | null = null;
  rdsMetrics: RdsMetricsResponse | null = null;
  loadingEc2 = true;
  loadingRds = true;
  ec2TimeRange: TimeRange = '1h';
  rdsTimeRange: TimeRange = '1h';

  private paused = false;
  private visibilityHandler = () => {
    this.paused = document.hidden;
  };

  constructor() {
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Poll every 120s
    timer(0, 120_000)
      .pipe(
        filter(() => !this.paused),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.fetchEc2Metrics();
        this.fetchRdsMetrics();
      });

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    });
  }

  onEc2TimeRangeChange(range: TimeRange): void {
    this.ec2TimeRange = range;
    this.fetchEc2Metrics();
  }

  onRdsTimeRangeChange(range: TimeRange): void {
    this.rdsTimeRange = range;
    this.fetchRdsMetrics();
  }

  private fetchEc2Metrics(): void {
    this.loadingEc2 = true;
    this.monitoringService
      .getEc2Metrics(this.ec2TimeRange)
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => {
        this.ec2Metrics = data;
        this.loadingEc2 = false;
      });
  }

  private fetchRdsMetrics(): void {
    this.loadingRds = true;
    this.monitoringService
      .getRdsMetrics(this.rdsTimeRange)
      .pipe(
        map((res) => res.data),
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => {
        this.rdsMetrics = data;
        this.loadingRds = false;
      });
  }
}
