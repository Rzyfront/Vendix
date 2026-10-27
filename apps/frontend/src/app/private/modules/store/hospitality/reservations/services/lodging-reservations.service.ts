import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError, ParsedApiError } from '../../../../../../core/utils/parse-api-error';
import {
  CancellationQuote,
  CheckInRequest,
  CreateInventoryBlockRequest,
  CreateReservationRequest,
  FrontDeskBoard,
  LodgingDepositRequest,
  LodgingDepositSummary,
  LodgingReservation,
  Rack,
  ReservationListQuery,
  ReservationListResult,
  ReservationQuote,
  ReservationQuoteRequest,
  ReservationStats,
  RoomChangeQuote,
  RoomChangeRequest,
} from '../interfaces/reservation.interface';
import { SellableRatePlan } from '../../rates/interfaces/rate-plan.interface';
import { LodgingGuest, LodgingGuestRequest } from '../interfaces/guest.interface';
import {
  FolioChargeRequest,
  FolioDetail,
  FolioPaymentRequest,
  InHouseRoom,
  RoomChargeRequest,
  RoomChargeResult,
  CheckOutRequest,
  CheckOutResult,
  SplitAccountInput,
  SplitConfirmRequest,
  SplitPaymentRequest,
  SplitResult,
  VatExemptServicesReport,
} from '../interfaces/folio.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: { total: number; page: number; totalPages: number };
}

/** Hospitality Suite (H1.1/H1.2) — `/store/hospitality/reservations` client. */
@Injectable({ providedIn: 'root' })
export class LodgingReservationsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/reservations`;
  private readonly roomChargesUrl = `${environment.apiUrl}/store/hospitality/room-charges`;

  list(query: ReservationListQuery = {}): Observable<ReservationListResult> {
    return this.http
      .get<ApiResponse<LodgingReservation[]>>(this.baseUrl, { params: toParams(query) })
      .pipe(
        map((res) => ({
          data: res.data,
          total: res.meta?.total ?? res.data.length,
          page: res.meta?.page ?? 1,
          totalPages: res.meta?.totalPages ?? 1,
        })),
        catchError(this.handleError),
      );
  }

  stats(): Observable<ReservationStats> {
    return this.http
      .get<ApiResponse<ReservationStats>>(`${this.baseUrl}/stats`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.3 — front desk board of the store business day. */
  frontDesk(): Observable<FrontDeskBoard> {
    return this.http
      .get<ApiResponse<FrontDeskBoard>>(`${environment.apiUrl}/store/hospitality/front-desk`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  get(id: number): Observable<LodgingReservation> {
    return this.http
      .get<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  cancel(id: number, reason: string): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}/cancel`, { reason })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Cancels one room of a multi-room reservation; the others stay (H1.5). */
  cancelRoom(roomId: number, reason: string): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/rooms/${roomId}/cancel`, { reason })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H2.4 — penalty of cancelling now (null amount = free). */
  cancellationQuote(id: number): Observable<CancellationQuote> {
    return this.http
      .get<ApiResponse<CancellationQuote>>(
        `${this.baseUrl}/${id}/cancellation-quote`,
      )
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  markNoShow(id: number, reason?: string): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}/no-show`, { reason })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /**
   * H3.2 — check-in that opens the folio. Rejects with the parsed error so
   * the screen can tell a dirty room (asks to confirm) from other errors.
   */
  checkIn(id: number, request: CheckInRequest): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}/check-in`, request)
      .pipe(
        map((res) => res.data),
        catchError((error: unknown) => throwError((): ParsedApiError => parseApiError(error))),
      );
  }

  /** H2.1 — active rate plans with the room types each one prices. */
  sellableRatePlans(): Observable<SellableRatePlan[]> {
    return this.http
      .get<ApiResponse<SellableRatePlan[]>>(`${this.baseUrl}/rate-plans`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  quote(request: ReservationQuoteRequest): Observable<ReservationQuote> {
    return this.http
      .get<ApiResponse<ReservationQuote>>(`${this.baseUrl}/quote`, { params: toParams(request) })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(request: CreateReservationRequest): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(this.baseUrl, request)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Validates and prices a room change without applying it (H1.4). */
  changeQuote(roomId: number, change: RoomChangeRequest): Observable<RoomChangeQuote> {
    return this.http
      .get<ApiResponse<RoomChangeQuote>>(`${this.baseUrl}/rooms/${roomId}/change-quote`, {
        params: toParams(change),
      })
      .pipe(
        map((r) => r.data),
        catchError(this.handleError),
      );
  }

  /** Assigns, moves or resizes a reservation room (H1.4). */
  changeRoom(roomId: number, change: RoomChangeRequest): Observable<LodgingReservation> {
    return this.http
      .patch<ApiResponse<LodgingReservation>>(`${this.baseUrl}/rooms/${roomId}`, change)
      .pipe(
        map((r) => r.data),
        catchError(this.handleError),
      );
  }

  /** Occupancy rack of the nights `[from, to)` (H1.3). */
  rack(from: string, to: string): Observable<Rack> {
    return this.http
      .get<ApiResponse<Rack>>(`${environment.apiUrl}/store/hospitality/rack`, {
        params: toParams({ from, to }),
      })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H5.3 — takes a room out of sale (maintenance, owner use). */
  createBlock(request: CreateInventoryBlockRequest): Observable<void> {
    return this.http
      .post<ApiResponse<unknown>>(`${environment.apiUrl}/store/hospitality/blocks`, request)
      .pipe(
        map(() => undefined),
        catchError(this.handleError),
      );
  }

  /** H5.3 — closes the ticket: the room returns to sale. */
  releaseBlock(blockId: number): Observable<void> {
    return this.http
      .post<ApiResponse<unknown>>(`${environment.apiUrl}/store/hospitality/blocks/${blockId}/release`, {})
      .pipe(
        map(() => undefined),
        catchError(this.handleError),
      );
  }

  /** H3.1 — guest register of a reservation. */
  listGuests(reservationId: number): Observable<LodgingGuest[]> {
    return this.http
      .get<ApiResponse<LodgingGuest[]>>(`${this.baseUrl}/${reservationId}/guests`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  createGuest(reservationId: number, body: LodgingGuestRequest): Observable<LodgingGuest> {
    return this.http
      .post<ApiResponse<LodgingGuest>>(`${this.baseUrl}/${reservationId}/guests`, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  updateGuest(
    reservationId: number,
    guestId: number,
    body: LodgingGuestRequest,
  ): Observable<LodgingGuest> {
    return this.http
      .patch<ApiResponse<LodgingGuest>>(`${this.baseUrl}/${reservationId}/guests/${guestId}`, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  removeGuest(reservationId: number, guestId: number): Observable<{ id: number }> {
    return this.http
      .delete<ApiResponse<{ id: number }>>(`${this.baseUrl}/${reservationId}/guests/${guestId}`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.4 — guest folio of a checked-in reservation. */
  getFolio(reservationId: number): Observable<FolioDetail> {
    return this.http
      .get<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** "Cargar noche": charges the nights due up to today. */
  postFolioNights(reservationId: number): Observable<{ folio: FolioDetail; message: string }> {
    return this.http
      .post<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/nights`, {})
      .pipe(
        map((res) => ({ folio: res.data, message: res.message ?? 'Noches cargadas' })),
        catchError(this.handleError),
      );
  }

  addFolioCharge(reservationId: number, body: FolioChargeRequest): Observable<FolioDetail> {
    return this.http
      .post<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/charges`, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  voidFolioCharge(reservationId: number, lineId: number, reason: string): Observable<FolioDetail> {
    return this.http
      .post<ApiResponse<FolioDetail>>(
        `${this.baseUrl}/${reservationId}/folio/charges/${lineId}/void`,
        { reason },
      )
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  registerFolioPayment(reservationId: number, body: FolioPaymentRequest): Observable<FolioDetail> {
    return this.http
      .post<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/payments`, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.6 — "Cargos bloqueados" on or off for the POS and the tables. */
  setFolioChargesBlocked(reservationId: number, blocked: boolean): Observable<FolioDetail> {
    return this.http
      .patch<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/charges-blocked`, {
        blocked,
      })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.9 — "No residente – exento de IVA" on or off; the nights are re-priced. */
  setFolioVatExemption(reservationId: number, enabled: boolean): Observable<FolioDetail> {
    return this.http
      .patch<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/vat-exemption`, {
        enabled,
      })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.9 — "Servicios exentos": invoices with exempt lodging in the period. */
  vatExemptServices(from: string, to: string): Observable<VatExemptServicesReport> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<ApiResponse<VatExemptServicesReport>>(
        `${environment.apiUrl}/store/hospitality/reports/vat-exempt-services`,
        { params },
      )
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.6 — in-house rooms for "Cargo a habitación" (room number or guest). */
  getInHouseRooms(search = ''): Observable<InHouseRoom[]> {
    const params = search.trim() ? new HttpParams().set('search', search.trim()) : undefined;
    return this.http
      .get<ApiResponse<InHouseRoom[]>>(`${this.roomChargesUrl}/rooms`, { params })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.6 — moves a POS draft sale or a table bill to the room folio. */
  chargeToRoom(body: RoomChargeRequest): Observable<RoomChargeResult> {
    return this.http
      .post<ApiResponse<RoomChargeResult>>(this.roomChargesUrl, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.5 — deposit summary (wallet advance, never a folio payment). */
  getDeposits(reservationId: number): Observable<LodgingDepositSummary> {
    return this.http
      .get<ApiResponse<LodgingDepositSummary>>(`${this.baseUrl}/${reservationId}/deposits`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** "Cobrar depósito" in cash, card or transfer. */
  registerDeposit(
    reservationId: number,
    body: LodgingDepositRequest,
  ): Observable<{ summary: LodgingDepositSummary; message: string }> {
    return this.http
      .post<ApiResponse<LodgingDepositSummary>>(`${this.baseUrl}/${reservationId}/deposits`, body)
      .pipe(
        map((res) => ({ summary: res.data, message: res.message ?? 'Depósito registrado' })),
        catchError(this.handleError),
      );
  }

  /** "Cobrar depósito" with a Wompi payment link. */
  createDepositLink(
    reservationId: number,
    amount: number,
  ): Observable<{ summary: LodgingDepositSummary; message: string }> {
    return this.http
      .post<ApiResponse<LodgingDepositSummary>>(`${this.baseUrl}/${reservationId}/deposits/link`, {
        amount,
      })
      .pipe(
        map((res) => ({ summary: res.data, message: res.message ?? 'Link de pago creado' })),
        catchError(this.handleError),
      );
  }

  /** "Aplicar anticipo": moves the held deposit onto the folio. */
  applyFolioDeposit(reservationId: number): Observable<{ folio: FolioDetail; message: string }> {
    return this.http
      .post<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/deposit`, {})
      .pipe(
        map((res) => ({ folio: res.data, message: res.message ?? 'Anticipo aplicado' })),
        catchError(this.handleError),
      );
  }

  /** H3.7 / D11 — "Verificar folio" (permission store:lodging:folio:verify). */
  verifyFolio(reservationId: number): Observable<FolioDetail> {
    return this.http
      .post<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/verify`, {})
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.7 — check-out: pays the balance, closes the folio and emits the invoice. */
  checkOut(reservationId: number, body: CheckOutRequest): Observable<CheckOutResult> {
    return this.http
      .post<ApiResponse<CheckOutResult>>(`${this.baseUrl}/${reservationId}/check-out`, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.7 — signed URL of the folio invoice PDF (H3.8: of one account when split). */
  getFolioInvoicePdf(reservationId: number, accountId?: number): Observable<string> {
    const params = accountId !== undefined ? new HttpParams().set('account_id', accountId) : undefined;
    return this.http
      .get<ApiResponse<{ url: string }>>(`${this.baseUrl}/${reservationId}/folio/invoice/pdf`, { params })
      .pipe(map((res) => res.data.url), catchError(this.handleError));
  }

  /** H3.8 — current folio split, or null when the folio is a single account. */
  getFolioSplit(reservationId: number): Observable<SplitResult | null> {
    return this.http
      .get<ApiResponse<SplitResult | null>>(`${this.baseUrl}/${reservationId}/folio/split`)
      .pipe(map((res) => res.data ?? null), catchError(this.handleError));
  }

  /** H3.8 — "Vista previa": totals per account, nothing is saved. */
  previewFolioSplit(reservationId: number, accounts: SplitAccountInput[]): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(`${this.baseUrl}/${reservationId}/folio/split/preview`, { accounts })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.8 — "Confirmar división". */
  confirmFolioSplit(reservationId: number, body: SplitConfirmRequest): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(`${this.baseUrl}/${reservationId}/folio/split`, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.8 — "Quitar división": back to the single folio. */
  cancelFolioSplit(reservationId: number, sourceVersion: string): Observable<FolioDetail> {
    return this.http
      .post<ApiResponse<FolioDetail>>(`${this.baseUrl}/${reservationId}/folio/split/cancel`, {
        source_version: sourceVersion,
      })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H3.8 — "Cobrar" one account of the split folio. */
  payFolioSplitAccount(
    reservationId: number,
    accountId: number,
    body: SplitPaymentRequest,
  ): Observable<SplitResult> {
    return this.http
      .post<ApiResponse<SplitResult>>(
        `${this.baseUrl}/${reservationId}/folio/split/accounts/${accountId}/pay`,
        body,
      )
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can show it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}

/** Query object → HttpParams, skipping empty values. */
function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
