import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/**
 * Payload for `PATCH /store/dispatch-notes/:id/address`. Keys use the DTO
 * vocabulary (`address_line_1`, `address_line_2`, ...) with the underscore
 * suffix the backend DTO expects — NOT the `addresses` table column names
 * (address_line1, ...) that live in the persisted `customer_address` JSON.
 */
export interface DispatchNoteAddressPayload {
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state_province: string | null;
  country_code: string | null;
  postal_code: string | null;
  phone_number: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Minimal client for the dispatch-note address endpoint. Kept local to this
 * component's scope so it does not touch the shared `dispatch-notes.service`
 * (which is owned by another module). The backend endpoint is expected to
 * persist the payload as the `customer_address` JSON snapshot on the note.
 */
@Injectable({ providedIn: 'root' })
export class DispatchNoteAddressService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/dispatch-notes`;

  updateAddress(
    noteId: number,
    payload: DispatchNoteAddressPayload,
  ): Observable<unknown> {
    return this.http.patch<unknown>(`${this.apiUrl}/${noteId}/address`, payload);
  }
}