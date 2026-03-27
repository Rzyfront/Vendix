import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import { IconComponent, SpinnerComponent } from '../../../../../../shared/components';
import { WeeklyScheduleEditorComponent } from './weekly-schedule-editor/weekly-schedule-editor.component';
import { ExceptionsManagerComponent } from './exceptions-manager/exceptions-manager.component';

interface BookableService {
  id: number;
  name: string;
  service_duration_minutes?: number;
  image_url?: string;
  base_price?: number;
}

@Component({
  selector: 'app-schedule-management',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    IconComponent,
    SpinnerComponent,
    WeeklyScheduleEditorComponent,
    ExceptionsManagerComponent,
  ],
  templateUrl: './schedule-management.component.html',
  styleUrls: ['./schedule-management.component.scss'],
})
export class ScheduleManagementComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private destroy$ = new Subject<void>();

  services = signal<BookableService[]>([]);
  selectedService = signal<BookableService | null>(null);
  loading = signal(false);

  ngOnInit(): void {
    this.loadServices();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadServices(): void {
    this.loading.set(true);
    const params = new HttpParams()
      .set('product_type', 'service')
      .set('requires_booking', 'true')
      .set('limit', '100');

    this.http
      .get<any>(`${environment.apiUrl}/store/products`, { params })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.services.set(res?.data || []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  selectService(service: BookableService): void {
    this.selectedService.set(service);
  }

  formatDuration(minutes?: number): string {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
}
