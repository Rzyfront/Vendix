import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, exhaustMap, catchError, withLatestFrom } from 'rxjs/operators';
import { InvoicingService } from '../../services/invoicing.service';
import * as InvoicingActions from '../actions/invoicing.actions';
import { selectInvoicingState } from '../selectors/invoicing.selectors';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

@Injectable()
export class InvoicingEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private invoicingService = inject(InvoicingService);
  private toastService = inject(ToastService);

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
            of(InvoicingActions.loadInvoicesFailure({
              error: error.error?.message || error.message || 'Error loading invoices'
            }))
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
            of(InvoicingActions.loadInvoiceFailure({
              error: error.error?.message || error.message || 'Error loading invoice'
            }))
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
            of(InvoicingActions.loadInvoiceStatsFailure({
              error: error.error?.message || error.message || 'Error loading stats'
            }))
          )
        )
      )
    )
  );

  // Create invoice
  createInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createInvoice),
      switchMap(({ invoice }) =>
        this.invoicingService.createInvoice(invoice).pipe(
          map((response) =>
            InvoicingActions.createInvoiceSuccess({ invoice: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.createInvoiceFailure({
              error: error.error?.message || error.message || 'Error creating invoice'
            }))
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
          map((response) =>
            InvoicingActions.createFromOrderSuccess({ invoice: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.createFromOrderFailure({
              error: error.error?.message || error.message || 'Error creating invoice from order'
            }))
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
          map((response) =>
            InvoicingActions.createFromSalesOrderSuccess({ invoice: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.createFromSalesOrderFailure({
              error: error.error?.message || error.message || 'Error creating invoice from sales order'
            }))
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
            of(InvoicingActions.updateInvoiceFailure({
              error: error.error?.message || error.message || 'Error updating invoice'
            }))
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
            of(InvoicingActions.deleteInvoiceFailure({
              error: error.error?.message || error.message || 'Error deleting invoice'
            }))
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
            of(InvoicingActions.validateInvoiceFailure({
              error: error.error?.message || error.message || 'Error validating invoice'
            }))
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
            of(InvoicingActions.sendInvoiceFailure({
              error: error.error?.message || error.message || 'Error sending invoice'
            }))
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
            of(InvoicingActions.acceptInvoiceFailure({
              error: error.error?.message || error.message || 'Error accepting invoice'
            }))
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
            of(InvoicingActions.rejectInvoiceFailure({
              error: error.error?.message || error.message || 'Error rejecting invoice'
            }))
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
            of(InvoicingActions.cancelInvoiceFailure({
              error: error.error?.message || error.message || 'Error cancelling invoice'
            }))
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
            of(InvoicingActions.voidInvoiceFailure({
              error: error.error?.message || error.message || 'Error voiding invoice'
            }))
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
          map((response) =>
            InvoicingActions.createCreditNoteSuccess({ invoice: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.createCreditNoteFailure({
              error: error.error?.message || error.message || 'Error creating credit note'
            }))
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
          map((response) =>
            InvoicingActions.createDebitNoteSuccess({ invoice: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.createDebitNoteFailure({
              error: error.error?.message || error.message || 'Error creating debit note'
            }))
          )
        )
      )
    )
  );

  // Load resolutions
  loadResolutions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.loadResolutions),
      exhaustMap(() =>
        this.invoicingService.getResolutions().pipe(
          map((response) =>
            InvoicingActions.loadResolutionsSuccess({ resolutions: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.loadResolutionsFailure({
              error: error.error?.message || error.message || 'Error loading resolutions'
            }))
          )
        )
      )
    )
  );

  // Create resolution
  createResolution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.createResolution),
      switchMap(({ resolution }) =>
        this.invoicingService.createResolution(resolution).pipe(
          map((response) =>
            InvoicingActions.createResolutionSuccess({ resolution: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.createResolutionFailure({
              error: error.error?.message || error.message || 'Error creating resolution'
            }))
          )
        )
      )
    )
  );

  // Update resolution
  updateResolution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.updateResolution),
      switchMap(({ id, resolution }) =>
        this.invoicingService.updateResolution(id, resolution).pipe(
          map((response) =>
            InvoicingActions.updateResolutionSuccess({ resolution: response.data })
          ),
          catchError((error) =>
            of(InvoicingActions.updateResolutionFailure({
              error: error.error?.message || error.message || 'Error updating resolution'
            }))
          )
        )
      )
    )
  );

  // Load DIAN configs (gate pre-factura)
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
          catchError((error) => {
            const msg = extractApiErrorMessage(error);
            this.toastService.error(msg);
            return of(InvoicingActions.loadDianConfigsFailure({ error: msg }));
          })
        )
      )
    )
  );

  // Delete resolution
  deleteResolution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InvoicingActions.deleteResolution),
      switchMap(({ id }) =>
        this.invoicingService.deleteResolution(id).pipe(
          map(() => InvoicingActions.deleteResolutionSuccess({ id })),
          catchError((error) =>
            of(InvoicingActions.deleteResolutionFailure({
              error: error.error?.message || error.message || 'Error deleting resolution'
            }))
          )
        )
      )
    )
  );
}
