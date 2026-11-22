import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  AiVoicePreviewAudio,
  AiVoiceProfile,
  AiVoiceProfileWriteDto,
  AiVoiceSpeechConfig,
} from '../interfaces';

/** Responses may arrive as the raw payload or wrapped in `{ data }`. */
function unwrap<T>(response: unknown): T {
  const body = response as { data?: unknown } | null;
  return (body && typeof body === 'object' && 'data' in body
    ? body.data
    : response) as T;
}

@Injectable({ providedIn: 'root' })
export class AiVoicesService {
  private http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/superadmin/ai-engine/voices`;

  list(): Observable<AiVoiceProfile[]> {
    return this.http
      .get<unknown>(this.baseUrl)
      .pipe(map((r) => unwrap<AiVoiceProfile[]>(r) ?? []));
  }

  speechConfigs(): Observable<AiVoiceSpeechConfig[]> {
    return this.http
      .get<unknown>(`${this.baseUrl}/speech-configs`)
      .pipe(map((r) => unwrap<AiVoiceSpeechConfig[]>(r) ?? []));
  }

  create(dto: AiVoiceProfileWriteDto): Observable<AiVoiceProfile> {
    return this.http
      .post<unknown>(this.baseUrl, dto)
      .pipe(map((r) => unwrap<AiVoiceProfile>(r)));
  }

  update(id: number, dto: AiVoiceProfileWriteDto): Observable<AiVoiceProfile> {
    return this.http
      .patch<unknown>(`${this.baseUrl}/${id}`, dto)
      .pipe(map((r) => unwrap<AiVoiceProfile>(r)));
  }

  preview(id: number, text?: string): Observable<AiVoicePreviewAudio> {
    return this.http
      .post<unknown>(`${this.baseUrl}/${id}/preview`, text ? { text } : {})
      .pipe(map((r) => unwrap<AiVoicePreviewAudio>(r)));
  }
}
