import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { BackupStatus, SnapshotInfo } from '../interfaces';

@Injectable()
export class BackupService {
  private readonly baseUrl = `${environment.apiUrl}/superadmin/backups`;

  constructor(private readonly http: HttpClient) {}

  getStatus(): Observable<{ data: BackupStatus }> {
    return this.http.get<{ data: BackupStatus }>(`${this.baseUrl}/status`);
  }

  getSnapshots(): Observable<{ data: SnapshotInfo[] }> {
    return this.http.get<{ data: SnapshotInfo[] }>(
      `${this.baseUrl}/snapshots`,
    );
  }

  createSnapshot(name: string): Observable<{ data: SnapshotInfo }> {
    return this.http.post<{ data: SnapshotInfo }>(
      `${this.baseUrl}/snapshots`,
      { name },
    );
  }

  deleteSnapshot(id: string): Observable<{ data: null }> {
    return this.http.delete<{ data: null }>(
      `${this.baseUrl}/snapshots/${encodeURIComponent(id)}`,
    );
  }
}
