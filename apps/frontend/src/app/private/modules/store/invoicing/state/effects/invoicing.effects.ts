import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Action, Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { map, switchMap, exhaustMap, catchError, withLatestFrom } from 'rxjs/operators';
import { InvoicingService } from '../../services/invoicing.service';
import * as InvoicingActions from '../actions/invoicing.actions';
import { selectInvoicingState } from '../selectors/invoicing.selectors';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { FiscalRequirementsService } from '../../../../../../shared/services/fiscal-requirements.service';
import {
  ApiFailure,
  DianRejection,
  blockingReasons,
  describeApiFailure,
  formatReason,
  readDianRejection,
} from '../../utils/invoicing-errors.util';

/**
 * NINGUN FALLO DE FACTURACION PUEDE SER INVISIBLE.
 *
 * Antes, la mitad de estos `catchError` se limitaba a meter un texto en
 * `state.error` — un campo que NADIE lee: `selectInvoicesError` no tiene un solo
 * consumidor. El resultado real para el usuario era el peor posible: el modal se
 * cerraba, no aparecia ningun mensaje, y la factura no existia. Creia haber
 * facturado.
 *
 * Ahora TODO fallo pasa por `fail()`, que es el unico punto de reporte:
 *
 *  1. Si el error es una restriccion fiscal reconocida (codigo curado en
 *     `FISCAL_RESTRICTION_MAP`), lo toma el modal de requisitos: motivo humano
 *     + CTA a la pantalla donde se arregla.
 *  2. Si es un rechazo de la DIAN (`INVOICING_PROVIDER_004`), el toast lleva el
 *     encabezado + el primer motivo REAL, y la lista completa se guarda en el
 *     state para pintarla en el detalle de la factura.
 *  3. En cualquier otro caso, toast con el copy en español del `error_code`.
 *
 * El mensaje que se muestra SIEMPRE sale de `ERROR_MESSAGES[error_code]`; el
 * `message` del backend es de desarrollador y no se muestra nunca.
 */
@Injectable()
export class InvoicingEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private invoicingService = inject(InvoicingService);
  private toastService = inject(ToastService);
  /**
   * Modal de requisitos fiscales. Ante un 4xx fiscal en una operacion de
   * factura (validar, enviar a DIAN, aceptar/rechazar, anular, nota credito),
   * abre el modal compartido con el motivo + CTA a la config correcta. El host
   * del modal vive en InvoicingComponent, siempre montado cuando estas
   * operaciones se disparan desde el detalle de factura.
   */
  private fiscalReq = inject(FiscalRequirementsService);

  /**
   * Ultimo toast de error emitido. La pantalla de facturacion dispara cuatro
   * cargas en paralelo al montarse (facturas, stats, resoluciones, configs
   * DIAN): si la API esta caida, sin esto el usuario recibe cuatro veces el
   * mismo texto. Se colapsan los repetidos inmediatos, nunca los distintos.
   */
  private lastToast: { message: string; at: number } = { message: '', at: 0 };

  // ── Reporte de fallos (punto unico) ───────────────────────

  /**
   * Reporta un fallo y construye las acciones que lo dejan asentado en el state.
   *
   * @param error  El error crudo (se necesita entero: el modal fiscal y el
   *               detalle del rechazo viven en `details`).
   * @param build  Constructor de la accion de fallo del flujo que corresponda.
   */
  private fail(
    error: unknown,
    build: (failure: ApiFailure) => Action,
  ): Observable<Action> {
    const failure = describeApiFailure(error);
    const rejection = readDianRejection(failure);
    this.report(error, failure, rejection);

    return rejection
      ? of(build(failure), InvoicingActions.dianDocumentRejected({ rejection }))
      : of(build(failure));
  }

  /** Decide POR DONDE se le cuenta al usuario lo que fallo. */
  private report(
    error: unknown,
    failure: ApiFailure,
    rejection: DianRejection | null,
  ): void {
    // 1) Restriccion fiscal: el modal ya explica el motivo y ofrece el CTA a la
    //    pantalla de configuracion. Un toast encima seria ruido duplicado.
    if (this.fiscalReq.presentFiscalError(error)) {
      return;
    }

    // 2) Rechazo de la DIAN: el encabezado solo dice que paso; el motivo dice
    //    que corregir. Va el primero en el toast y la lista completa al panel
    //    del detalle, que es donde se puede leer con calma.
    if (rejection) {
      const first = blockingReasons(rejection)[0];
      const detail = first
        ? formatReason(first)
        : (rejection.statusDescription ?? '');
      const extra = Math.max(blockingReasons(rejection).length - 1, 0);
      this.toast(
        detail
          ? `${detail}${extra > 0 ? ` (+${extra} motivo(s) más en el detalle)` : ''}`
          : failure.message,
        'La DIAN rechazó el documento',
        6000,
      );
      return;
    }

    // 3) Resto: el copy en español del codigo.
    this.toast(failure.message);
  }

  private toast(message: string, title?: string, duration = 3000): void {
    const now = Date.now();
    if (message === this.lastToast.message && now - this.lastToast.at < 3000) {
      return;
    }
    this.lastToast = { message, at: now };
    this.toastService.error(message, title, duration);
  }

  // ── Invoices ──────────────────────────────────────────────

  // Load invoices using filter-as-state from store
  loadInvoices$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.loadInvoices),
      withLatestFrom(this.store.select(selectInvoicingState)),
      switchMap(([, state]) =>
        this.invoicingService.getInvoices({
          page: state.page,
          limit: state.limit,
          search: state.search || undefined,
          sort_by: state.sortBy,
          sort_order: state.sortOrder,
          status: state.statusFilter || undefined,
          invoice_type: state.typeFilter || undefined,
          date_from: state.dateFrom || undefined,
          date_to: state.dateTo || undefined,
        }).pipe(
          map((response) =>
            InvoicingActions.loadInvoicesSuccess({ invoices: response.data, meta: response.meta })
          ),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.loadInvoicesFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Cascade: any filter change dispatches loadInvoices
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        InvoicingActions.setSearch,
        InvoicingActions.setPage,
        InvoicingActions.setSort,
        InvoicingActions.setStatusFilter,
        InvoicingActions.setTypeFilter,
        InvoicingActions.setDateRange,
        InvoicingActions.clearFilters,
      ),
      map(() => InvoicingActions.loadInvoices())
    )
  );

  // After any mutation success, reload invoices + stats
  mutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        InvoicingActions.createInvoiceSuccess,
        InvoicingActions.createFromOrderSuccess,
        InvoicingActions.createFromSalesOrderSuccess,
        InvoicingActions.updateInvoiceSuccess,
        InvoicingActions.deleteInvoiceSuccess,
        InvoicingActions.validateInvoiceSuccess,
        InvoicingActions.sendInvoiceSuccess,
        InvoicingActions.createCreditNoteSuccess,
        InvoicingActions.createDebitNoteSuccess,
        InvoicingActions.acceptInvoiceSuccess,
        InvoicingActions.rejectInvoiceSuccess,
        InvoicingActions.cancelInvoiceSuccess,
        InvoicingActions.voidInvoiceSuccess,
      ),
      switchMap(() => [
        InvoicingActions.loadInvoices(),
        InvoicingActions.loadInvoiceStats(),
      ])
    )
  );

  // Load single invoice
  loadInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.loadInvoice),
      switchMap(({ id }) =>
        this.invoicingService.getInvoice(id).pipe(
          map((response) =>
            InvoicingActions.loadInvoiceSuccess({ invoice: response.data })
          ),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.loadInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Load stats
  loadStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.loadInvoiceStats),
      switchMap(() =>
        this.invoicingService.getStats().pipe(
          map((response) =>
            InvoicingActions.loadInvoiceStatsSuccess({ stats: response.data })
          ),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.loadInvoiceStatsFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Create invoice
  //
  // EL FALLO SILENCIOSO ORIGINAL VIVIA AQUI. El error se traducia a un texto que
  // solo llegaba a `state.error`, y el modal ya se habia cerrado antes de que la
  // respuesta existiera: la factura no se creaba y nadie se enteraba.
  createInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createInvoice),
      switchMap(({ invoice }) =>
        this.invoicingService.createInvoice(invoice).pipe(
          map((response) => {
            this.toastService.success('Factura creada');
            return InvoicingActions.createInvoiceSuccess({ invoice: response.data });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.createInvoiceFailure({
                error: f.message,
                errorCode: f.errorCode,
                details: f.details,
              }),
            ),
          )
        )
      )
    )
  );

  // Create from order
  createFromOrder$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createFromOrder),
      switchMap(({ orderId }) =>
        this.invoicingService.createFromOrder(orderId).pipe(
          map((response) => {
            this.toastService.success('Factura creada desde el pedido');
            return InvoicingActions.createFromOrderSuccess({ invoice: response.data });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.createFromOrderFailure({
                error: f.message,
                errorCode: f.errorCode,
                details: f.details,
              }),
            ),
          )
        )
      )
    )
  );

  // Create from sales order
  createFromSalesOrder$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createFromSalesOrder),
      switchMap(({ salesOrderId }) =>
        this.invoicingService.createFromSalesOrder(salesOrderId).pipe(
          map((response) => {
            this.toastService.success('Factura creada desde la orden de venta');
            return InvoicingActions.createFromSalesOrderSuccess({
              invoice: response.data,
            });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.createFromSalesOrderFailure({
                error: f.message,
                errorCode: f.errorCode,
                details: f.details,
              }),
            ),
          )
        )
      )
    )
  );

  // Update invoice
  updateInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.updateInvoice),
      switchMap(({ id, invoice }) =>
        this.invoicingService.updateInvoice(id, invoice).pipe(
          map((response) =>
            InvoicingActions.updateInvoiceSuccess({ invoice: response.data })
          ),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.updateInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Delete invoice
  deleteInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.deleteInvoice),
      switchMap(({ id }) =>
        this.invoicingService.deleteInvoice(id).pipe(
          map(() => InvoicingActions.deleteInvoiceSuccess({ id })),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.deleteInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Validate invoice
  validateInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.validateInvoice),
      switchMap(({ id }) =>
        this.invoicingService.validateInvoice(id).pipe(
          map((response) => InvoicingActions.validateInvoiceSuccess({ invoice: response.data })),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.validateInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Send invoice
  sendInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.sendInvoice),
      switchMap(({ id }) =>
        this.invoicingService.sendInvoice(id).pipe(
          map((response) => InvoicingActions.sendInvoiceSuccess({ invoice: response.data })),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.sendInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Accept invoice
  acceptInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.acceptInvoice),
      switchMap(({ id }) =>
        this.invoicingService.acceptInvoice(id).pipe(
          map((response) => InvoicingActions.acceptInvoiceSuccess({ invoice: response.data })),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.acceptInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Reject invoice
  rejectInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.rejectInvoice),
      switchMap(({ id }) =>
        this.invoicingService.rejectInvoice(id).pipe(
          map((response) => InvoicingActions.rejectInvoiceSuccess({ invoice: response.data })),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.rejectInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Cancel invoice
  cancelInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.cancelInvoice),
      switchMap(({ id }) =>
        this.invoicingService.cancelInvoice(id).pipe(
          map((response) => InvoicingActions.cancelInvoiceSuccess({ invoice: response.data })),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.cancelInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Void invoice
  voidInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.voidInvoice),
      switchMap(({ id }) =>
        this.invoicingService.voidInvoice(id).pipe(
          map((response) => InvoicingActions.voidInvoiceSuccess({ invoice: response.data })),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.voidInvoiceFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Create credit note
  createCreditNote$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createCreditNote),
      switchMap(({ dto }) =>
        this.invoicingService.createCreditNote(dto).pipe(
          map((response) => {
            this.toastService.success('Nota crédito creada');
            return InvoicingActions.createCreditNoteSuccess({ invoice: response.data });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.createCreditNoteFailure({
                error: f.message,
                errorCode: f.errorCode,
                details: f.details,
              }),
            ),
          )
        )
      )
    )
  );

  // Create debit note
  createDebitNote$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createDebitNote),
      switchMap(({ dto }) =>
        this.invoicingService.createDebitNote(dto).pipe(
          map((response) => {
            this.toastService.success('Nota débito creada');
            return InvoicingActions.createDebitNoteSuccess({ invoice: response.data });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.createDebitNoteFailure({
                error: f.message,
                errorCode: f.errorCode,
                details: f.details,
              }),
            ),
          )
        )
      )
    )
  );

  // ── Eventos RADIAN (Res. 000085/2022) ─────────────────────

  /**
   * `GET /store/invoicing/:id/events`. El backend los ordena de mas nuevo a mas
   * viejo; el orden cronologico lo arma el detalle, que es quien lo pinta.
   *
   * `switchMap` y no `exhaustMap`: abrir la factura B mientras carga la A tiene
   * que CANCELAR la A. Con `exhaustMap` la segunda apertura se ignoraria y el
   * usuario veria el panel vacio de una factura que si tiene eventos.
   */
  loadDianEvents$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.loadDianEvents),
      switchMap(({ invoiceId }) =>
        this.invoicingService.getDianEvents(invoiceId).pipe(
          map((response) =>
            InvoicingActions.loadDianEventsSuccess({
              invoiceId,
              events: response?.data ?? [],
            }),
          ),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.loadDianEventsFailure({
                invoiceId,
                error: f.message,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Regenerar PDF ─────────────────────────────────────────

  /**
   * `POST /store/invoicing/:id/pdf/regenerate`.
   *
   * `exhaustMap` DELIBERADO: cada llamada reconstruye el PDF y lo sube a S3
   * pisando el anterior. Un doble click con `switchMap` cancelaria la
   * suscripcion del frontend pero NO la escritura del backend — dos subidas
   * concurrentes sobre la misma llave. Con `exhaustMap` el segundo click se
   * ignora hasta que el primero termina.
   *
   * NO se despacha `loadInvoice` despues: el reducer de `loadInvoice` limpia
   * `dianRejection`, y regenerar un PDF no debe borrar de pantalla los motivos
   * por los que la DIAN rechazo el documento. La llave S3 (`pdf_url`) tampoco
   * cambia — el backend la reescribe con el mismo valor.
   */
  regenerateInvoicePdf$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.regenerateInvoicePdf),
      exhaustMap(({ id }) =>
        this.invoicingService.regenerateInvoicePdf(id).pipe(
          map((response) => {
            this.toastService.success('PDF regenerado');
            return InvoicingActions.regenerateInvoicePdfSuccess({
              id,
              url: response?.data?.url ?? null,
            });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.regenerateInvoicePdfFailure({
                id,
                error: f.message,
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Resolutions ───────────────────────────────────────────

  loadResolutions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.loadResolutions),
      exhaustMap(() =>
        this.invoicingService.getResolutions().pipe(
          map((response) =>
            InvoicingActions.loadResolutionsSuccess({ resolutions: response.data })
          ),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.loadResolutionsFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  createResolution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createResolution),
      switchMap(({ resolution }) =>
        this.invoicingService.createResolution(resolution).pipe(
          map((response) => {
            this.toastService.success('Resolución creada');
            return InvoicingActions.createResolutionSuccess({ resolution: response.data });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.createResolutionFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  updateResolution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.updateResolution),
      switchMap(({ id, resolution }) =>
        this.invoicingService.updateResolution(id, resolution).pipe(
          map((response) => {
            this.toastService.success('Resolución actualizada');
            return InvoicingActions.updateResolutionSuccess({ resolution: response.data });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.updateResolutionFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // Delete resolution
  //
  // Sin los toasts, un rechazo legítimo del backend (409: la resolución ya
  // numeró documentos) se veía exactamente igual que no hacer nada: la fila se
  // quedaba y el usuario concluía que borrar está roto.
  deleteResolution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.deleteResolution),
      switchMap(({ id }) =>
        this.invoicingService.deleteResolution(id).pipe(
          map(() => {
            this.toastService.success('Resolución eliminada');
            return InvoicingActions.deleteResolutionSuccess({ id });
          }),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.deleteResolutionFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );

  // ── DIAN configs (gate pre-factura) ───────────────────────

  loadDianConfigs$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.loadDianConfigs),
      switchMap(() =>
        this.invoicingService.getDianConfigs().pipe(
          map((response: any) =>
            InvoicingActions.loadDianConfigsSuccess({
              configs: response?.data ?? [],
            })
          ),
          catchError((error) =>
            this.fail(error, (f) =>
              InvoicingActions.loadDianConfigsFailure({ error: f.message }),
            ),
          )
        )
      )
    )
  );
}
