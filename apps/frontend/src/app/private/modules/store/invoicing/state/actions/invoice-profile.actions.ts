import { createAction, props } from '@ngrx/store';
import type {
    CloneInvoiceProfilePayload,
    CreateInvoiceProfilePayload,
    InvoiceProfile,
    InvoiceProfileDetail,
    InvoiceProfilePageMeta,
    InvoiceProfileQuery,
    InvoiceProfileState,
    InvoiceProfileVersionSummary,
    PreviewProfilePayload,
    ProfilePreviewResult,
} from '../../interfaces/invoice-profile.interface';
import type { MutationFailure } from './invoicing.actions';

/**
 * Acciones de los perfiles de facturación.
 *
 * Archivo aparte de `invoicing.actions.ts` (454 líneas ya) pero MISMO slice:
 * el shell provee `provideState({name:'invoicing'})` una sola vez, y un slice
 * nuevo duplicaría ese proveedor. Lo que se separa es el archivo, no el estado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODAS LAS MUTACIONES LLEVAN `MutationFailure`, NO UN STRING
 * ─────────────────────────────────────────────────────────────────────────────
 * Un fallo que sólo trae texto obliga a la UI a adivinar qué pasó. Aquí viaja
 * `errorCode`, y con él la vista puede ramificar de verdad:
 * - `INVOICING_PROFILE_004` (nombre duplicado) → marcar el campo `name`
 * - `INVOICING_PROFILE_003` (tiene facturas timbradas) → ofrecer desactivar,
 *   que es la salida real, en vez de repetir un borrado que nunca va a pasar
 * - `INVOICING_PROFILE_005` (config inválida) → abrir la sección culpable con
 *   `details.issues`, que trae la ruta punteada de cada campo
 * - `INVOICING_PROFILE_007` (inactivo no puede ser predeterminado) → ofrecer
 *   activarlo primero
 * - `AUTH_PERM_001` → no ofrecer reintentar, que no va a funcionar
 * El mensaje suelto sirve para el toast; el código, para hacer algo al respecto.
 */

// ── Listado ──────────────────────────────────────────────────────────────────

export const loadProfiles = createAction(
    '[Invoicing/Profiles] Load',
    props<{ query?: InvoiceProfileQuery }>(),
);
export const loadProfilesSuccess = createAction(
    '[Invoicing/Profiles] Load Success',
    props<{ profiles: InvoiceProfile[]; meta: InvoiceProfilePageMeta }>(),
);
export const loadProfilesFailure = createAction(
    '[Invoicing/Profiles] Load Failure',
    props<MutationFailure>(),
);

// ── Filtros (filter-as-state) ────────────────────────────────────────────────
// El filtro es estado, no un argumento suelto: así el efecto puede releerlo
// del store y una recarga no pierde lo que el usuario tenía escrito.

export const setProfilesSearch = createAction(
    '[Invoicing/Profiles] Set Search',
    props<{ search: string }>(),
);
export const setProfilesStateFilter = createAction(
    '[Invoicing/Profiles] Set State Filter',
    props<{ state: InvoiceProfileState | '' }>(),
);
export const setProfilesOperationFilter = createAction(
    '[Invoicing/Profiles] Set Operation Filter',
    props<{ operation_type: string }>(),
);
export const setProfilesPage = createAction(
    '[Invoicing/Profiles] Set Page',
    props<{ page: number }>(),
);

// ── Detalle ──────────────────────────────────────────────────────────────────

export const loadProfile = createAction(
    '[Invoicing/Profiles] Load One',
    props<{ id: number }>(),
);
export const loadProfileSuccess = createAction(
    '[Invoicing/Profiles] Load One Success',
    props<{ profile: InvoiceProfileDetail }>(),
);
export const loadProfileFailure = createAction(
    '[Invoicing/Profiles] Load One Failure',
    props<MutationFailure>(),
);
/** Limpia el detalle al salir del editor, para que el siguiente no abra con el anterior. */
export const clearCurrentProfile = createAction('[Invoicing/Profiles] Clear Current');

// ── Crear / clonar / editar ──────────────────────────────────────────────────

export const createProfile = createAction(
    '[Invoicing/Profiles] Create',
    props<{ payload: CreateInvoiceProfilePayload }>(),
);
export const createProfileSuccess = createAction(
    '[Invoicing/Profiles] Create Success',
    props<{ profile: InvoiceProfileDetail }>(),
);
export const createProfileFailure = createAction(
    '[Invoicing/Profiles] Create Failure',
    props<MutationFailure>(),
);

export const cloneProfile = createAction(
    '[Invoicing/Profiles] Clone',
    props<{ id: number; payload: CloneInvoiceProfilePayload }>(),
);
export const cloneProfileSuccess = createAction(
    '[Invoicing/Profiles] Clone Success',
    props<{ profile: InvoiceProfileDetail }>(),
);
export const cloneProfileFailure = createAction(
    '[Invoicing/Profiles] Clone Failure',
    props<MutationFailure>(),
);

/**
 * Edita un perfil.
 *
 * `payload.config` presente ⇒ el backend crea una versión nueva. El editor lo
 * omite cuando sólo cambió el nombre; esa decisión es de la vista, no del
 * efecto, porque sólo la vista sabe qué tocó el usuario.
 */
export const updateProfile = createAction(
    '[Invoicing/Profiles] Update',
    props<{ id: number; payload: Record<string, unknown> }>(),
);
export const updateProfileSuccess = createAction(
    '[Invoicing/Profiles] Update Success',
    props<{ profile: InvoiceProfileDetail }>(),
);
export const updateProfileFailure = createAction(
    '[Invoicing/Profiles] Update Failure',
    props<MutationFailure>(),
);

// ── Estado y predeterminado ──────────────────────────────────────────────────

export const activateProfile = createAction(
    '[Invoicing/Profiles] Activate',
    props<{ id: number }>(),
);
export const deactivateProfile = createAction(
    '[Invoicing/Profiles] Deactivate',
    props<{ id: number }>(),
);
/**
 * Marca el perfil como predeterminado.
 *
 * Acción propia y no un `updateProfile({is_default:true})`: el backend la sirve
 * en su propia ruta con su propio permiso (`invoicing:profiles:set_default`),
 * porque cambia lo que se timbra por omisión. Fundirla en la edición haría que
 * quien puede renombrar pudiera además cambiar el perfil con el que se factura.
 */
export const setProfileDefault = createAction(
    '[Invoicing/Profiles] Set Default',
    props<{ id: number }>(),
);
/** Éxito común de las tres: el backend devuelve el perfil actualizado. */
export const profileStateChangeSuccess = createAction(
    '[Invoicing/Profiles] State Change Success',
    props<{ profile: InvoiceProfileDetail }>(),
);
export const profileStateChangeFailure = createAction(
    '[Invoicing/Profiles] State Change Failure',
    props<MutationFailure>(),
);

// ── Borrado ──────────────────────────────────────────────────────────────────

export const deleteProfile = createAction(
    '[Invoicing/Profiles] Delete',
    props<{ id: number }>(),
);
export const deleteProfileSuccess = createAction(
    '[Invoicing/Profiles] Delete Success',
    props<{ id: number }>(),
);
export const deleteProfileFailure = createAction(
    '[Invoicing/Profiles] Delete Failure',
    props<MutationFailure>(),
);

// ── Historial de versiones ───────────────────────────────────────────────────

export const loadProfileVersions = createAction(
    '[Invoicing/Profiles] Load Versions',
    props<{ id: number; page?: number; limit?: number }>(),
);
export const loadProfileVersionsSuccess = createAction(
    '[Invoicing/Profiles] Load Versions Success',
    /** `profileId` viaja de vuelta para que el reducer sepa de quién es el historial. */
    props<{
        profileId: number;
        versions: InvoiceProfileVersionSummary[];
        meta: InvoiceProfilePageMeta;
    }>(),
);
export const loadProfileVersionsFailure = createAction(
    '[Invoicing/Profiles] Load Versions Failure',
    props<MutationFailure>(),
);

// ── Previsualización ─────────────────────────────────────────────────────────

export const previewProfile = createAction(
    '[Invoicing/Profiles] Preview',
    props<{ id: number; payload: PreviewProfilePayload }>(),
);
export const previewProfileSuccess = createAction(
    '[Invoicing/Profiles] Preview Success',
    props<{ profileId: number; result: ProfilePreviewResult }>(),
);
export const previewProfileFailure = createAction(
    '[Invoicing/Profiles] Preview Failure',
    props<MutationFailure>(),
);
export const clearProfilePreview = createAction('[Invoicing/Profiles] Clear Preview');
