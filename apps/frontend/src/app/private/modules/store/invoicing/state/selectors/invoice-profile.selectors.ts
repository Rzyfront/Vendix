import { createSelector } from '@ngrx/store';
import { selectInvoicingState } from './invoicing.selectors';
import type {
    InvoiceProfileQuery,
    ProfilePreviewValidation,
} from '../../interfaces/invoice-profile.interface';

/**
 * Selectores de perfiles de facturación.
 *
 * Reutilizan `selectInvoicingState` del archivo hermano en vez de declarar otro
 * `createFeatureSelector('invoicing')`: dos feature selectors sobre el mismo
 * nombre funcionan, pero si algún día el slice se renombra habría que
 * acordarse de los dos, y el que se olvide falla en runtime sin que `tsc` diga
 * nada.
 */

export const selectProfiles = createSelector(
    selectInvoicingState,
    (state) => state.profiles,
);

export const selectProfilesLoading = createSelector(
    selectInvoicingState,
    (state) => state.profilesLoading,
);

export const selectProfilesMeta = createSelector(
    selectInvoicingState,
    (state) => state.profilesMeta,
);

export const selectProfilesError = createSelector(
    selectInvoicingState,
    (state) => state.profilesError,
);

export const selectProfileSaving = createSelector(
    selectInvoicingState,
    (state) => state.profileSaving,
);

export const selectCurrentProfile = createSelector(
    selectInvoicingState,
    (state) => state.currentProfile,
);

export const selectCurrentProfileLoading = createSelector(
    selectInvoicingState,
    (state) => state.currentProfileLoading,
);

/** Config vigente del perfil abierto, o `null` si no hay perfil o no se resolvió. */
export const selectCurrentProfileConfig = createSelector(
    selectCurrentProfile,
    (profile) => profile?.current_config ?? null,
);

/**
 * Filtros vigentes, ya con la forma del query del backend.
 *
 * Los vacíos se omiten en vez de mandarse como `''`: el `ValidationPipe` corre
 * con `forbidNonWhitelisted` y `state=''` no está en `INVOICE_PROFILE_STATES`,
 * o sea que «sin filtro» sería un 400.
 */
export const selectProfilesQuery = createSelector(
    selectInvoicingState,
    (state): InvoiceProfileQuery => {
        const query: InvoiceProfileQuery = {
            page: state.profilesPage,
            limit: state.profilesLimit,
        };
        if (state.profilesSearch.trim()) query.search = state.profilesSearch.trim();
        if (state.profilesStateFilter) query.state = state.profilesStateFilter;
        if (state.profilesOperationFilter) {
            query.operation_type = state.profilesOperationFilter;
        }
        return query;
    },
);

export const selectProfilesFilters = createSelector(
    selectInvoicingState,
    (state) => ({
        search: state.profilesSearch,
        state: state.profilesStateFilter,
        operation_type: state.profilesOperationFilter,
        page: state.profilesPage,
        limit: state.profilesLimit,
    }),
);

/**
 * Historial del perfil abierto, y SÓLO si le pertenece.
 *
 * Sin la comprobación de `profileVersionsProfileId`, el historial del perfil A
 * se pintaría bajo el B durante el instante entre abrir el segundo y que
 * responda su carga. En un perfil de facturación eso no es un parpadeo
 * cosmético: el diff compararía snapshots de perfiles distintos y mostraría
 * cambios fiscales que nunca ocurrieron.
 */
export const selectCurrentProfileVersions = createSelector(
    selectInvoicingState,
    (state) =>
        state.currentProfile &&
        state.profileVersionsProfileId === state.currentProfile.id
            ? state.profileVersions
            : [],
);

export const selectProfileVersionsLoading = createSelector(
    selectInvoicingState,
    (state) => state.profileVersionsLoading,
);

/** Previsualización del perfil abierto, con la misma guarda de pertenencia. */
export const selectCurrentProfilePreview = createSelector(
    selectInvoicingState,
    (state) =>
        state.currentProfile &&
        state.profilePreviewProfileId === state.currentProfile.id
            ? state.profilePreview
            : null,
);

export const selectProfilePreviewLoading = createSelector(
    selectInvoicingState,
    (state) => state.profilePreviewLoading,
);

export const selectProfilePreviewError = createSelector(
    selectInvoicingState,
    (state) => state.profilePreviewError,
);

/**
 * Las validaciones del anexo agrupadas por veredicto.
 *
 * `blockers` son las que impedirían timbrar: se cuentan aparte porque la
 * diferencia entre «esta factura no se puede emitir» y «esto conviene revisar»
 * es la única que le importa al operador antes de guardar.
 */
export const selectPreviewValidationGroups = createSelector(
    selectCurrentProfilePreview,
    (preview) => {
        const validations: ProfilePreviewValidation[] = preview?.validations ?? [];
        const failed = validations.filter((item) => !item.passed);
        return {
            all: validations,
            passed: validations.filter((item) => item.passed),
            blockers: failed.filter((item) => item.severity === 'blocker'),
            warnings: failed.filter((item) => item.severity === 'warning'),
            infos: failed.filter((item) => item.severity === 'info'),
            /** `true` si el perfil, tal como está, produciría un documento emisible. */
            emitable: failed.every((item) => item.severity !== 'blocker'),
        };
    },
);

/** Último fallo de mutación, completo (mensaje + código + `details`). */
export const selectProfileMutationFailure = createSelector(
    selectInvoicingState,
    (state) => state.profileMutationFailure,
);

/**
 * Borrado bloqueado por referencias, con el conteo que lo bloquea.
 *
 * `INVOICING_PROFILE_003` cubre dos causas distintas con salidas distintas para
 * el usuario: facturas timbradas (`invoice_count`) ⇒ desactivar en vez de
 * borrar; clones de otra tienda (`foreign_clone_count`) ⇒ hay que llamar a
 * soporte porque desde acá no se alcanza el otro ámbito. Se distinguen por la
 * clave presente en `details`, no por el mensaje, que es texto.
 */
export const selectProfileDeleteBlock = createSelector(
    selectProfileMutationFailure,
    (failure) => {
        if (!failure || failure.errorCode !== 'INVOICING_PROFILE_003') return null;
        const details = (failure.details ?? {}) as Record<string, unknown>;
        const invoices = Number(details['invoice_count'] ?? 0);
        const clones = Number(details['foreign_clone_count'] ?? 0);
        return {
            message: failure.message,
            invoiceCount: Number.isFinite(invoices) ? invoices : 0,
            foreignCloneCount: Number.isFinite(clones) ? clones : 0,
            /** `true` cuando la salida correcta es desactivar, no borrar. */
            suggestDeactivate: invoices > 0,
        };
    },
);

/** Snapshot de la versión abierta del historial, sólo si es del perfil actual. */
export const selectProfileVersionSnapshot = createSelector(
    selectInvoicingState,
    (state) =>
        state.currentProfile &&
        state.profileVersionSnapshotProfileId === state.currentProfile.id
            ? state.profileVersionSnapshot
            : null,
);

export const selectProfileVersionSnapshotLoading = createSelector(
    selectInvoicingState,
    (state) => state.profileVersionSnapshotLoading,
);
