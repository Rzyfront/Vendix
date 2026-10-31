import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  CampaignContentInput,
  CampaignEstimate,
  CampaignRecipientStatus,
  CampaignRecipientsPage,
  CampaignRecipient,
  CampaignsPage,
  CreateCrmCampaign,
  CrmCampaign,
  CrmCampaignDetail,
  CrmCampaignWithEstimate,
  CrmSegment,
  SaveCrmSegment,
  SegmentCustomer,
  SegmentCustomersPage,
  SegmentGroup,
  SegmentPreview,
} from './crm-segments.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

interface PageMeta {
  total?: number;
  page?: number;
  totalPages?: number;
}

function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

function toPage<T>(r: ApiResponse<T[]>): { data: T[]; total: number; page: number; totalPages: number } {
  const meta = (r.meta ?? {}) as PageMeta;
  return {
    data: r.data,
    total: meta.total ?? r.data.length,
    page: meta.page ?? 1,
    totalPages: meta.totalPages ?? 1,
  };
}

/** HTTP client of CRM segments and marketing campaigns. */
@Injectable({ providedIn: 'root' })
export class CrmSegmentsService {
  private readonly http = inject(HttpClient);
  private readonly segmentsUrl = `${environment.apiUrl}/store/customers/crm/segments`;
  private readonly campaignsUrl = `${environment.apiUrl}/store/customers/crm/campaigns`;

  // ── Segments ──────────────────────────────────────────────
  segments(): Observable<CrmSegment[]> {
    return this.http.get<ApiResponse<CrmSegment[]>>(this.segmentsUrl).pipe(map((r) => r.data));
  }

  segment(id: number): Observable<CrmSegment> {
    return this.http
      .get<ApiResponse<CrmSegment>>(`${this.segmentsUrl}/${id}`)
      .pipe(map((r) => r.data));
  }

  previewSegment(filter: SegmentGroup): Observable<SegmentPreview> {
    return this.http
      .post<ApiResponse<SegmentPreview>>(`${this.segmentsUrl}/preview`, { filter })
      .pipe(map((r) => r.data));
  }

  createSegment(body: SaveCrmSegment): Observable<CrmSegment> {
    return this.http
      .post<ApiResponse<CrmSegment>>(this.segmentsUrl, body)
      .pipe(map((r) => r.data));
  }

  updateSegment(id: number, body: Partial<SaveCrmSegment>): Observable<CrmSegment> {
    return this.http
      .patch<ApiResponse<CrmSegment>>(`${this.segmentsUrl}/${id}`, body)
      .pipe(map((r) => r.data));
  }

  deleteSegment(id: number): Observable<{ id: number }> {
    return this.http
      .delete<ApiResponse<{ id: number }>>(`${this.segmentsUrl}/${id}`)
      .pipe(map((r) => r.data));
  }

  segmentCustomers(
    id: number,
    query: { page?: number; limit?: number },
  ): Observable<SegmentCustomersPage> {
    return this.http
      .get<ApiResponse<SegmentCustomer[]>>(`${this.segmentsUrl}/${id}/customers`, {
        params: toParams(query),
      })
      .pipe(map(toPage));
  }

  // ── Campaigns ─────────────────────────────────────────────
  estimateCampaign(body: CampaignContentInput): Observable<CampaignEstimate> {
    return this.http
      .post<ApiResponse<CampaignEstimate>>(`${this.campaignsUrl}/estimate`, body)
      .pipe(map((r) => r.data));
  }

  campaigns(query: { page?: number; limit?: number }): Observable<CampaignsPage> {
    return this.http
      .get<ApiResponse<CrmCampaign[]>>(this.campaignsUrl, { params: toParams(query) })
      .pipe(map(toPage));
  }

  createCampaign(body: CreateCrmCampaign): Observable<CrmCampaignWithEstimate> {
    return this.http
      .post<ApiResponse<CrmCampaignWithEstimate>>(this.campaignsUrl, body)
      .pipe(map((r) => r.data));
  }

  campaign(id: number): Observable<CrmCampaignDetail> {
    return this.http
      .get<ApiResponse<CrmCampaignDetail>>(`${this.campaignsUrl}/${id}`)
      .pipe(map((r) => r.data));
  }

  estimateSavedCampaign(id: number): Observable<CampaignEstimate> {
    return this.http
      .post<ApiResponse<CampaignEstimate>>(`${this.campaignsUrl}/${id}/estimate`, {})
      .pipe(map((r) => r.data));
  }

  sendCampaign(id: number, confirmEstimatedCost: number): Observable<CrmCampaignDetail> {
    return this.http
      .post<ApiResponse<CrmCampaignDetail>>(`${this.campaignsUrl}/${id}/send`, {
        confirm_estimated_cost: confirmEstimatedCost,
      })
      .pipe(map((r) => r.data));
  }

  cancelCampaign(id: number): Observable<CrmCampaignDetail> {
    return this.http
      .post<ApiResponse<CrmCampaignDetail>>(`${this.campaignsUrl}/${id}/cancel`, {})
      .pipe(map((r) => r.data));
  }

  campaignRecipients(
    id: number,
    query: { page?: number; limit?: number; status?: CampaignRecipientStatus },
  ): Observable<CampaignRecipientsPage> {
    return this.http
      .get<ApiResponse<CampaignRecipient[]>>(`${this.campaignsUrl}/${id}/recipients`, {
        params: toParams(query),
      })
      .pipe(map(toPage));
  }
}
