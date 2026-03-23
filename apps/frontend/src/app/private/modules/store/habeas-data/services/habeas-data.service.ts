import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class HabeasDataService {
  private http = inject(HttpClient);

  getStats(): Observable<any> {
    return this.http.get('/store/habeas-data/stats');
  }

  getUserConsents(userId: number): Observable<any> {
    return this.http.get(`/store/habeas-data/users/${userId}/consents`);
  }

  updateConsents(userId: number, consents: { consent_type: string; granted: boolean }[]): Observable<any> {
    return this.http.patch(`/store/habeas-data/users/${userId}/consents`, { consents });
  }

  requestExport(userId: number): Observable<any> {
    return this.http.post(`/store/habeas-data/users/${userId}/data-export`, {});
  }

  getMyExports(): Observable<any> {
    return this.http.get('/store/habeas-data/my-exports');
  }

  getExportStatus(requestId: number): Observable<any> {
    return this.http.get(`/store/habeas-data/data-exports/${requestId}`);
  }

  getExportDownloadUrl(requestId: number): Observable<any> {
    return this.http.get(`/store/habeas-data/exports/${requestId}/download`);
  }

  searchUsers(query: string): Observable<any> {
    return this.http.get(`/store/habeas-data/users/search`, { params: { q: query } });
  }

  requestAnonymization(userId: number, reason: string): Observable<any> {
    return this.http.post(`/store/habeas-data/users/${userId}/anonymize`, { reason });
  }

  confirmAnonymization(requestId: number): Observable<any> {
    return this.http.post(`/store/habeas-data/anonymize/${requestId}/confirm`, {});
  }
}
