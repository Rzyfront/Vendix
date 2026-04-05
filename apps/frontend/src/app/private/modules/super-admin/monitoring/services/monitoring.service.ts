import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  MonitoringOverview,
  Ec2MetricsResponse,
  RdsMetricsResponse,
  AppMetrics,
  ServerInfo,
  TimeRange,
} from '../interfaces';

@Injectable()
export class MonitoringService {
  private readonly baseUrl = `${environment.apiUrl}/superadmin/monitoring`;

  constructor(private readonly http: HttpClient) {}

  getOverview(): Observable<{ data: MonitoringOverview }> {
    return this.http.get<{ data: MonitoringOverview }>(
      `${this.baseUrl}/overview`,
    );
  }

  getEc2Metrics(
    period: TimeRange = '1h',
  ): Observable<{ data: Ec2MetricsResponse }> {
    const params = new HttpParams().set('period', period);
    return this.http.get<{ data: Ec2MetricsResponse }>(
      `${this.baseUrl}/ec2`,
      { params },
    );
  }

  getRdsMetrics(
    period: TimeRange = '1h',
  ): Observable<{ data: RdsMetricsResponse }> {
    const params = new HttpParams().set('period', period);
    return this.http.get<{ data: RdsMetricsResponse }>(
      `${this.baseUrl}/rds`,
      { params },
    );
  }

  getAppMetrics(): Observable<{ data: AppMetrics }> {
    return this.http.get<{ data: AppMetrics }>(`${this.baseUrl}/app`);
  }

  getServerInfo(): Observable<{ data: ServerInfo }> {
    return this.http.get<{ data: ServerInfo }>(`${this.baseUrl}/server`);
  }
}
