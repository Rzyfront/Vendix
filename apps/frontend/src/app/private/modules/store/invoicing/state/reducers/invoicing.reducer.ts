import { createReducer, on } from '@ngrx/store';
import { InvoicingState, initialInvoicingState } from '../invoicing.state';
import * as InvoicingActions from '../actions/invoicing.actions';
import * as ProfileActions from '../actions/invoice-profile.actions';

export const invoicingReducer = createReducer(
  initialInvoicingState,

  // ── Load Invoices ───────────────────────────────────────
  on(InvoicingActions.loadInvoices, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.loadInvoicesSuccess, (state, { invoices, meta }) => ({
    ...state,
    invoices,
    meta,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.loadInvoicesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Load Single Invoice ─────────────────────────────────
  on(InvoicingActions.loadInvoice, (state) => ({
    ...state,
    currentInvoiceLoading: true,
    error: null,
    // Cargar otra factura invalida el rechazo en pantalla: pertenecia a la
    // anterior y mostrarlo sobre esta seria mentir dos veces.
    dianRejection: null,
  })),
  on(InvoicingActions.loadInvoiceSuccess, (state, { invoice }) => ({
    ...state,
    currentInvoice: invoice,
    currentInvoiceLoading: false,
    error: null,
  })),
  on(InvoicingActions.loadInvoiceFailure, (state, { error }) => ({
    ...state,
    currentInvoiceLoading: false,
    error,
  })),

  // ── Create Invoice ──────────────────────────────────────
  on(InvoicingActions.createInvoice, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.createInvoiceSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.createInvoiceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Create From Order ───────────────────────────────────
  on(InvoicingActions.createFromOrder, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.createFromOrderSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.createFromOrderFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Create From Sales Order ─────────────────────────────
  on(InvoicingActions.createFromSalesOrder, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.createFromSalesOrderSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.createFromSalesOrderFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Update Invoice ──────────────────────────────────────
  on(InvoicingActions.updateInvoice, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.updateInvoiceSuccess, (state, { invoice }) => ({
    ...state,
    currentInvoice: invoice,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.updateInvoiceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Delete Invoice ──────────────────────────────────────
  on(InvoicingActions.deleteInvoice, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(InvoicingActions.deleteInvoiceSuccess, (state, { id }) => ({
    ...state,
    currentInvoice:
      state.currentInvoice?.id === id ? null : state.currentInvoice,
    loading: false,
    error: null,
  })),
  on(InvoicingActions.deleteInvoiceFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Validate / Send ─────────────────────────────────────
  on(
    InvoicingActions.validateInvoice,
    InvoicingActions.sendInvoice,
    (state) => ({
      ...state,
      loading: true,
      error: null,
      // Un reintento empieza sin el rechazo anterior en pantalla.
      dianRejection: null,
    }),
  ),
  on(
    InvoicingActions.validateInvoiceSuccess,
    InvoicingActions.sendInvoiceSuccess,
    (state, { invoice }) => ({
      ...state,
      currentInvoice: invoice,
      loading: false,
      error: null,
    }),
  ),
  on(
    InvoicingActions.validateInvoiceFailure,
    InvoicingActions.sendInvoiceFailure,
    (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }),
  ),

  // ── Accept / Reject / Cancel / Void ───────────────────────
  on(
    InvoicingActions.acceptInvoice,
    InvoicingActions.rejectInvoice,
    InvoicingActions.cancelInvoice,
    InvoicingActions.voidInvoice,
    (state) => ({
      ...state,
      loading: true,
      error: null,
      dianRejection: null,
    }),
  ),
  on(
    InvoicingActions.acceptInvoiceSuccess,
    InvoicingActions.rejectInvoiceSuccess,
    InvoicingActions.cancelInvoiceSuccess,
    InvoicingActions.voidInvoiceSuccess,
    (state, { invoice }) => ({
      ...state,
      currentInvoice: invoice,
      loading: false,
      error: null,
    }),
  ),
  on(
    InvoicingActions.acceptInvoiceFailure,
    InvoicingActions.rejectInvoiceFailure,
    InvoicingActions.cancelInvoiceFailure,
    InvoicingActions.voidInvoiceFailure,
    (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }),
  ),

  // ── Credit / Debit Notes ────────────────────────────────
  on(
    InvoicingActions.createCreditNote,
    InvoicingActions.createDebitNote,
    (state) => ({
      ...state,
      loading: true,
      error: null,
      dianRejection: null,
    }),
  ),
  on(
    InvoicingActions.createCreditNoteSuccess,
    InvoicingActions.createDebitNoteSuccess,
    (state) => ({
      ...state,
      loading: false,
      error: null,
    }),
  ),
  on(
    InvoicingActions.createCreditNoteFailure,
    InvoicingActions.createDebitNoteFailure,
    (state, { error }) => ({
      ...state,
      loading: false,
      error,
    }),
  ),

  // ── Stats ───────────────────────────────────────────────
  on(InvoicingActions.loadInvoiceStats, (state) => ({
    ...state,
    loadingStats: true,
  })),
  on(InvoicingActions.loadInvoiceStatsSuccess, (state, { stats }) => ({
    ...state,
    stats,
    loadingStats: false,
  })),
  on(InvoicingActions.loadInvoiceStatsFailure, (state) => ({
    ...state,
    loadingStats: false,
  })),

  // ── Resolutions ─────────────────────────────────────────
  on(InvoicingActions.loadResolutions, (state) => ({
    ...state,
    resolutionsLoading: true,
    error: null,
  })),
  on(InvoicingActions.loadResolutionsSuccess, (state, { resolutions }) => ({
    ...state,
    resolutions,
    resolutionsLoading: false,
    error: null,
  })),
  on(InvoicingActions.loadResolutionsFailure, (state, { error }) => ({
    ...state,
    resolutionsLoading: false,
    error,
  })),

  on(InvoicingActions.createResolutionSuccess, (state, { resolution }) => ({
    ...state,
    resolutions: [...state.resolutions, resolution],
  })),

  on(InvoicingActions.updateResolutionSuccess, (state, { resolution }) => ({
    ...state,
    resolutions: state.resolutions.map((r) =>
      r.id === resolution.id ? resolution : r,
    ),
  })),

  on(InvoicingActions.deleteResolutionSuccess, (state, { id }) => ({
    ...state,
    resolutions: state.resolutions.filter((r) => r.id !== id),
  })),

  // ── DIAN Configs ────────────────────────────────────────
  on(InvoicingActions.loadDianConfigs, (state) => ({
    ...state,
    dianConfigsLoading: true,
    dianConfigsError: null,
  })),
  on(InvoicingActions.loadDianConfigsSuccess, (state, { configs }) => ({
    ...state,
    dianConfigs: configs,
    dianConfigsLoading: false,
    dianConfigsError: null,
  })),
  on(InvoicingActions.loadDianConfigsFailure, (state, { error }) => ({
    ...state,
    dianConfigsLoading: false,
    dianConfigsError: error,
  })),

  // ── Rechazo DIAN ────────────────────────────────────────
  on(InvoicingActions.dianDocumentRejected, (state, { rejection }) => ({
    ...state,
    dianRejection: rejection,
  })),
  on(InvoicingActions.clearDianRejection, (state) => ({
    ...state,
    dianRejection: null,
  })),

  // ── Eventos RADIAN ──────────────────────────────────────
  //
  // La carga BORRA los eventos anteriores y fija ya la factura destino: si no
  // se limpiaran, la lista de la factura anterior seguiria en pantalla durante
  // todo el viaje HTTP y el usuario leeria eventos ajenos como propios.
  on(InvoicingActions.loadDianEvents, (state, { invoiceId }) => ({
    ...state,
    dianEvents: [],
    dianEventsInvoiceId: invoiceId,
    dianEventsLoading: true,
  })),
  on(InvoicingActions.loadDianEventsSuccess, (state, { invoiceId, events }) => ({
    ...state,
    // Una respuesta que llega tarde, cuando el usuario ya abrio OTRA factura, se
    // descarta. `switchMap` cancela la suscripcion pero no la respuesta ya en
    // vuelo de una carga disparada desde otra superficie.
    dianEvents: state.dianEventsInvoiceId === invoiceId ? events : state.dianEvents,
    dianEventsLoading:
      state.dianEventsInvoiceId === invoiceId ? false : state.dianEventsLoading,
  })),
  on(InvoicingActions.loadDianEventsFailure, (state, { invoiceId }) => ({
    ...state,
    dianEventsLoading:
      state.dianEventsInvoiceId === invoiceId ? false : state.dianEventsLoading,
  })),

  // Registrar un evento NO toca `dianEvents`: la lista la repuebla el
  // `loadDianEvents` que dispara el effect al terminar. Escribir aqui la fila
  // devuelta y ADEMAS recargar produciria el evento duplicado en pantalla
  // durante todo el viaje de la recarga.
  on(InvoicingActions.registerDianEvent, (state) => ({
    ...state,
    dianEventRegistering: true,
  })),
  on(
    InvoicingActions.registerDianEventSuccess,
    InvoicingActions.registerDianEventFailure,
    (state) => ({
      ...state,
      dianEventRegistering: false,
    }),
  ),

  // ── Regenerar PDF ───────────────────────────────────────
  on(InvoicingActions.regenerateInvoicePdf, (state) => ({
    ...state,
    pdfRegenerating: true,
  })),
  on(
    InvoicingActions.regenerateInvoicePdfSuccess,
    InvoicingActions.regenerateInvoicePdfFailure,
    (state) => ({
      ...state,
      pdfRegenerating: false,
    }),
  ),

  // ── Filter setters ─────────────────────────────────────
  on(InvoicingActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(InvoicingActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(InvoicingActions.setSort, (state, { sortBy, sortOrder }) => ({
    ...state,
    sortBy,
    sortOrder,
    page: 1,
  })),
  on(InvoicingActions.setStatusFilter, (state, { statusFilter }) => ({
    ...state,
    statusFilter,
    page: 1,
  })),
  on(InvoicingActions.setTypeFilter, (state, { typeFilter }) => ({
    ...state,
    typeFilter,
    page: 1,
  })),
  on(InvoicingActions.setDateRange, (state, { dateFrom, dateTo }) => ({
    ...state,
    dateFrom,
    dateTo,
    page: 1,
  })),
  on(InvoicingActions.clearFilters, (state) => ({
    ...state,
    search: '',
    page: 1,
    statusFilter: '',
    typeFilter: '',
    dateFrom: '',
    dateTo: '',
  })),

  // ═══════════════════════════════════════════════════════
  // PERFILES DE FACTURACIÓN
  // ═══════════════════════════════════════════════════════
  // Cada mutación toca SU bandera. Reusar `profilesLoading` para guardar
  // cambiaría la tabla por un esqueleto mientras se edita una fila, y el
  // usuario perdería de vista justo lo que está tocando.

  on(ProfileActions.loadProfiles, (state) => ({
    ...state,
    profilesLoading: true,
    profilesError: null,
  })),
  on(ProfileActions.loadProfilesSuccess, (state, { profiles, meta }) => ({
    ...state,
    profiles,
    profilesMeta: meta,
    profilesLoading: false,
    profilesError: null,
  })),
  on(ProfileActions.loadProfilesFailure, (state, { error }) => ({
    ...state,
    profilesLoading: false,
    profilesError: error,
    // La lista NO se vacía en el fallo: dejar los datos anteriores con el aviso
    // de error es más honesto que un «no hay perfiles», que es una afirmación
    // falsa sobre la tienda.
  })),

  // Filtros: cualquier cambio vuelve a la página 1, porque el resultado que
  // había en la página 3 del filtro anterior no existe en el nuevo.
  on(ProfileActions.setProfilesSearch, (state, { search }) => ({
    ...state,
    profilesSearch: search,
    profilesPage: 1,
  })),
  on(ProfileActions.setProfilesStateFilter, (state, { state: value }) => ({
    ...state,
    profilesStateFilter: value,
    profilesPage: 1,
  })),
  on(ProfileActions.setProfilesOperationFilter, (state, { operation_type }) => ({
    ...state,
    profilesOperationFilter: operation_type,
    profilesPage: 1,
  })),
  on(ProfileActions.setProfilesPage, (state, { page }) => ({
    ...state,
    profilesPage: page,
  })),

  // ── Detalle ──────────────────────────────────────────────
  on(ProfileActions.loadProfile, (state) => ({
    ...state,
    currentProfileLoading: true,
    profilesError: null,
  })),
  on(ProfileActions.loadProfileSuccess, (state, { profile }) => ({
    ...state,
    currentProfile: profile,
    currentProfileLoading: false,
  })),
  on(ProfileActions.loadProfileFailure, (state, { error }) => ({
    ...state,
    currentProfileLoading: false,
    profilesError: error,
    // `currentProfile` a null: si falló la carga, seguir mostrando el perfil
    // anterior haría que el editor guardara cambios contra el id equivocado.
    currentProfile: null,
  })),
  on(ProfileActions.clearCurrentProfile, (state) => ({
    ...state,
    currentProfile: null,
    // Se limpia también el historial y la previsualización: pertenecen al
    // perfil que se está cerrando, no al siguiente.
    profileVersions: [],
    profileVersionsProfileId: null,
    profilePreview: null,
    profilePreviewProfileId: null,
    profilePreviewError: null,
    profileVersionSnapshot: null,
    profileVersionSnapshotProfileId: null,
  })),

  // ── Mutaciones ───────────────────────────────────────────
  on(
    ProfileActions.createProfile,
    ProfileActions.cloneProfile,
    ProfileActions.updateProfile,
    ProfileActions.deleteProfile,
    ProfileActions.activateProfile,
    ProfileActions.deactivateProfile,
    ProfileActions.setProfileDefault,
    (state) => ({ ...state, profileSaving: true, profilesError: null }),
  ),
  on(
    ProfileActions.createProfileSuccess,
    ProfileActions.cloneProfileSuccess,
    (state, { profile }) => ({
      ...state,
      profileSaving: false,
      currentProfile: profile,
      // El listado NO se parchea a mano con la fila nueva: el efecto recarga.
      // Insertarla aquí la pondría fuera del orden y del filtro vigentes, y la
      // fila aparecería donde no le toca hasta el siguiente refresco.
    }),
  ),
  on(ProfileActions.updateProfileSuccess, (state, { profile }) => ({
    ...state,
    profileSaving: false,
    currentProfile: profile,
    // La fila del listado sí se reemplaza en sitio: ya está en la lista, en su
    // posición, y sustituirla evita el parpadeo de una recarga completa.
    profiles: state.profiles.map((row) =>
      row.id === profile.id ? { ...row, ...stripDetail(profile) } : row,
    ),
    // Una edición con `config` creó una versión nueva, así que el historial
    // cargado quedó viejo. Se invalida en vez de dejarlo mentir.
    profileVersions: [],
    profileVersionsProfileId: null,
    // Y la previsualización también: describía la versión anterior.
    profilePreview: null,
    profilePreviewProfileId: null,
  })),
  on(ProfileActions.profileStateChangeSuccess, (state, { profile }) => ({
    ...state,
    profileSaving: false,
    currentProfile:
      state.currentProfile?.id === profile.id ? profile : state.currentProfile,
    // `set-default` mueve la bandera de OTRA fila (la que era predeterminada),
    // así que no basta con reemplazar la tocada: se apaga en todas las del
    // mismo tipo de operación y se prende en la que responde el backend. Sin
    // esto, la tabla mostraría dos perfiles predeterminados hasta recargar.
    profiles: state.profiles.map((row) => {
      if (row.id === profile.id) return { ...row, ...stripDetail(profile) };
      if (profile.is_default && row.operation_type === profile.operation_type) {
        return { ...row, is_default: false };
      }
      return row;
    }),
  })),
  on(ProfileActions.deleteProfileSuccess, (state, { id }) => ({
    ...state,
    profileSaving: false,
    profiles: state.profiles.filter((row) => row.id !== id),
    currentProfile: state.currentProfile?.id === id ? null : state.currentProfile,
    profilesMeta: state.profilesMeta
      ? { ...state.profilesMeta, total: Math.max(0, state.profilesMeta.total - 1) }
      : null,
  })),
  on(
    ProfileActions.createProfileFailure,
    ProfileActions.cloneProfileFailure,
    ProfileActions.updateProfileFailure,
    ProfileActions.deleteProfileFailure,
    ProfileActions.profileStateChangeFailure,
    // Se guarda el fallo COMPLETO, no sólo el texto: el 409 de borrado bloqueado
    // trae `details.invoice_count`, y ese número es lo que convierte un aviso
    // genérico en una decisión informada.
    (state, { error, errorCode, details }) => ({
      ...state,
      profileSaving: false,
      profilesError: error,
      profileMutationFailure: {
        message: error,
        errorCode: errorCode ?? null,
        details: details ?? null,
      },
    }),
  ),
  // Cualquier mutación que arranca limpia el fallo anterior: dejarlo pintado
  // mientras se reintenta hace parecer que el reintento también falló.
  on(
    ProfileActions.createProfile,
    ProfileActions.cloneProfile,
    ProfileActions.updateProfile,
    ProfileActions.deleteProfile,
    ProfileActions.activateProfile,
    ProfileActions.deactivateProfile,
    ProfileActions.setProfileDefault,
    (state) => ({ ...state, profileMutationFailure: null }),
  ),

  // ── Snapshot de una versión ──────────────────────────────
  on(ProfileActions.loadProfileVersion, (state) => ({
    ...state,
    profileVersionSnapshotLoading: true,
  })),
  on(ProfileActions.loadProfileVersionSuccess, (state, { profileId, snapshot }) => ({
    ...state,
    profileVersionSnapshotLoading: false,
    profileVersionSnapshot: snapshot,
    profileVersionSnapshotProfileId: profileId,
  })),
  on(ProfileActions.loadProfileVersionFailure, (state, { error }) => ({
    ...state,
    profileVersionSnapshotLoading: false,
    profilesError: error,
  })),
  on(ProfileActions.clearProfileVersionSnapshot, (state) => ({
    ...state,
    profileVersionSnapshot: null,
    profileVersionSnapshotProfileId: null,
  })),

  // ── Historial ────────────────────────────────────────────
  on(ProfileActions.loadProfileVersions, (state) => ({
    ...state,
    profileVersionsLoading: true,
  })),
  on(
    ProfileActions.loadProfileVersionsSuccess,
    (state, { profileId, versions }) => ({
      ...state,
      profileVersions: versions,
      profileVersionsProfileId: profileId,
      profileVersionsLoading: false,
    }),
  ),
  on(ProfileActions.loadProfileVersionsFailure, (state, { error }) => ({
    ...state,
    profileVersionsLoading: false,
    profileVersions: [],
    profileVersionsProfileId: null,
    profilesError: error,
  })),

  // ── Previsualización ─────────────────────────────────────
  on(ProfileActions.previewProfile, (state) => ({
    ...state,
    profilePreviewLoading: true,
    profilePreviewError: null,
  })),
  on(ProfileActions.previewProfileSuccess, (state, { profileId, result }) => ({
    ...state,
    profilePreview: result,
    profilePreviewProfileId: profileId,
    profilePreviewLoading: false,
    profilePreviewError: null,
  })),
  on(ProfileActions.previewProfileFailure, (state, { error, errorCode }) => ({
    ...state,
    profilePreviewLoading: false,
    // El XML anterior se descarta: mostrarlo junto al error haría creer que ese
    // es el documento que el perfil produce ahora, y es el de antes del cambio.
    profilePreview: null,
    profilePreviewProfileId: null,
    profilePreviewError: { code: errorCode ?? null, message: error },
  })),
  on(ProfileActions.clearProfilePreview, (state) => ({
    ...state,
    profilePreview: null,
    profilePreviewProfileId: null,
    profilePreviewError: null,
  })),

  // ── Clear State ─────────────────────────────────────────
  on(InvoicingActions.clearInvoicingState, () => initialInvoicingState),
);

/**
 * Quita del detalle los campos que la fila del listado no tiene.
 *
 * El backend devuelve `InvoiceProfileDetail` (con `version` y `current_config`)
 * en las mutaciones, pero `state.profiles` es de `InvoiceProfile`. Meter el
 * detalle entero en la lista guardaría un snapshot completo por fila y haría
 * que la tabla creyera tener config disponible — que es justo lo que la
 * interfaz del listado evita declarar.
 */
function stripDetail(profile: {
  version?: unknown;
  current_config?: unknown;
}): Record<string, unknown> {
  const { version: _version, current_config: _config, ...row } = profile;
  return row;
}
