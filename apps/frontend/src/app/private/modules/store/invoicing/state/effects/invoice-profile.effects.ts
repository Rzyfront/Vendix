import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { catchError, concatMap, exhaustMap, map, switchMap, withLatestFrom } from 'rxjs/operators';

import { InvoiceProfileService } from '../../services/invoice-profile.service';
import * as ProfileActions from '../actions/invoice-profile.actions';
import { selectProfilesQuery } from '../selectors/invoice-profile.selectors';
import { describeApiFailure } from '../../utils/invoicing-errors.util';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

/**
 * Efectos de los perfiles de facturación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NINGÚN FALLO ES INVISIBLE, Y NINGUNO SE TRAGA EL CÓDIGO
 * ─────────────────────────────────────────────────────────────────────────────
 * Cada `catchError` pasa por `describeApiFailure`, que lee el `error_code` del
 * cuerpo y devuelve la copia en español de `ERROR_MESSAGES`. El código viaja
 * ADEMÁS en la acción de fallo, para que la vista pueda hacer algo concreto
 * (marcar un campo, ofrecer desactivar en vez de borrar) y no sólo mostrar un
 * toast. El `message` del backend es de desarrollador y no se muestra nunca.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ELECCIÓN DE OPERADOR DE APLANADO — no es estilo, cambia el resultado
 * ─────────────────────────────────────────────────────────────────────────────
 * - `switchMap` para las CARGAS: si llega una segunda petición, la primera ya
 *   no interesa y su respuesta tardía pintaría datos viejos sobre nuevos.
 * - `exhaustMap` para CREAR y CLONAR: dos clics en «Guardar» crearían dos
 *   perfiles. Ignorar el segundo mientras el primero está en vuelo es la
 *   única defensa que no depende de que la UI deshabilite el botón.
 * - `concatMap` para EDITAR, borrar y cambiar estado: son operaciones sobre
 *   filas distintas, así que no se pueden descartar, pero sí tienen que
 *   respetar el orden — desactivar y luego marcar predeterminado no da lo
 *   mismo al revés.
 */
@Injectable()
export class InvoiceProfileEffects {
    private readonly actions$ = inject(Actions);
    private readonly store = inject(Store);
    private readonly profiles = inject(InvoiceProfileService);
    private readonly toast = inject(ToastService);

    /**
     * Carga el listado.
     *
     * El query se lee del STORE (filter-as-state) y no del payload cuando la
     * acción no lo trae: así una recarga disparada por una mutación respeta el
     * filtro y la página en que estaba el usuario, en vez de devolverlo a la
     * página 1 sin filtros.
     */
    readonly load$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.loadProfiles),
            withLatestFrom(this.store.select(selectProfilesQuery)),
            switchMap(([action, stateQuery]) =>
                this.profiles.list(action.query ?? stateQuery).pipe(
                    map((response) =>
                        ProfileActions.loadProfilesSuccess({
                            profiles: response.data,
                            meta: response.meta,
                        }),
                    ),
                    catchError((error) =>
                        of(ProfileActions.loadProfilesFailure(this.fail(error))),
                    ),
                ),
            ),
        ),
    );

    /**
     * Cualquier cambio de filtro recarga.
     *
     * Va por acción y no por un `subscribe` en el componente: un refresco por
     * HTTP directo desde la vista se salta el efecto, y entonces el store queda
     * con datos que él no puso — el defecto que este repo ya documenta.
     */
    readonly reloadOnFilterChange$ = createEffect(() =>
        this.actions$.pipe(
            ofType(
                ProfileActions.setProfilesSearch,
                ProfileActions.setProfilesStateFilter,
                ProfileActions.setProfilesOperationFilter,
                ProfileActions.setProfilesPage,
            ),
            map(() => ProfileActions.loadProfiles({})),
        ),
    );

    readonly loadOne$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.loadProfile),
            switchMap(({ id }) =>
                this.profiles.getById(id).pipe(
                    map((response) =>
                        ProfileActions.loadProfileSuccess({ profile: response.data }),
                    ),
                    catchError((error) =>
                        of(ProfileActions.loadProfileFailure(this.fail(error))),
                    ),
                ),
            ),
        ),
    );

    readonly create$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.createProfile),
            exhaustMap(({ payload }) =>
                this.profiles.create(payload).pipe(
                    map((response) => {
                        this.toast.success(`Perfil «${response.data.name}» creado`);
                        return ProfileActions.createProfileSuccess({
                            profile: response.data,
                        });
                    }),
                    catchError((error) =>
                        of(ProfileActions.createProfileFailure(this.fail(error))),
                    ),
                ),
            ),
        ),
    );

    readonly clone$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.cloneProfile),
            exhaustMap(({ id, payload }) =>
                this.profiles.clone(id, payload).pipe(
                    map((response) => {
                        this.toast.success(`Perfil clonado como «${response.data.name}»`);
                        return ProfileActions.cloneProfileSuccess({
                            profile: response.data,
                        });
                    }),
                    catchError((error) =>
                        of(ProfileActions.cloneProfileFailure(this.fail(error))),
                    ),
                ),
            ),
        ),
    );

    readonly update$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.updateProfile),
            concatMap(({ id, payload }) =>
                this.profiles.update(id, payload).pipe(
                    map((response) => {
                        // Se dice si se creó versión nueva, porque es lo que
                        // determina si las facturas futuras cambian de reglas.
                        const versioned = 'config' in payload;
                        this.toast.success(
                            versioned
                                ? `Perfil guardado — versión ${response.data.current_version}`
                                : 'Perfil actualizado',
                        );
                        return ProfileActions.updateProfileSuccess({
                            profile: response.data,
                        });
                    }),
                    catchError((error) =>
                        of(ProfileActions.updateProfileFailure(this.fail(error))),
                    ),
                ),
            ),
        ),
    );

    /**
     * Activar / desactivar / marcar predeterminado.
     *
     * Los tres comparten el éxito porque el backend devuelve lo mismo (el
     * perfil actualizado) y el reducer necesita hacer lo mismo con él. Lo que
     * NO comparten es la ruta ni el permiso: `set-default` exige
     * `invoicing:profiles:set_default`, y esa separación es la que impide que
     * quien puede renombrar cambie además el perfil con el que se factura.
     */
    readonly stateChange$ = createEffect(() =>
        this.actions$.pipe(
            ofType(
                ProfileActions.activateProfile,
                ProfileActions.deactivateProfile,
                ProfileActions.setProfileDefault,
            ),
            concatMap((action) => {
                const call =
                    action.type === ProfileActions.activateProfile.type
                        ? this.profiles.activate(action.id)
                        : action.type === ProfileActions.deactivateProfile.type
                          ? this.profiles.deactivate(action.id)
                          : this.profiles.setDefault(action.id);
                const label =
                    action.type === ProfileActions.activateProfile.type
                        ? 'Perfil activado'
                        : action.type === ProfileActions.deactivateProfile.type
                          ? 'Perfil desactivado'
                          : 'Perfil marcado como predeterminado';
                return call.pipe(
                    map((response) => {
                        this.toast.success(label);
                        return ProfileActions.profileStateChangeSuccess({
                            profile: response.data,
                        });
                    }),
                    catchError((error) =>
                        of(ProfileActions.profileStateChangeFailure(this.fail(error))),
                    ),
                );
            }),
        ),
    );

    readonly remove$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.deleteProfile),
            concatMap(({ id }) =>
                this.profiles.remove(id).pipe(
                    map(() => {
                        this.toast.success('Perfil eliminado');
                        return ProfileActions.deleteProfileSuccess({ id });
                    }),
                    catchError((error) =>
                        of(ProfileActions.deleteProfileFailure(this.fail(error))),
                    ),
                ),
            ),
        ),
    );

    /**
     * Tras crear o clonar, recarga el listado.
     *
     * El reducer NO inserta la fila nueva a mano: la pondría fuera del orden y
     * del filtro vigentes, y aparecería donde no le toca hasta el siguiente
     * refresco. La recarga respeta el filtro porque el efecto de carga lo lee
     * del store.
     */
    readonly reloadAfterCreate$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.createProfileSuccess, ProfileActions.cloneProfileSuccess),
            map(() => ProfileActions.loadProfiles({})),
        ),
    );

    readonly loadVersions$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.loadProfileVersions),
            switchMap(({ id, page, limit }) =>
                this.profiles.versions(id, page ?? 1, limit ?? 20).pipe(
                    map((response) =>
                        ProfileActions.loadProfileVersionsSuccess({
                            // El id viaja de vuelta: sin él el reducer no puede
                            // saber de quién es el historial que acaba de llegar.
                            profileId: id,
                            versions: response.data,
                            meta: response.meta,
                        }),
                    ),
                    catchError((error) =>
                        of(ProfileActions.loadProfileVersionsFailure(this.fail(error))),
                    ),
                ),
            ),
        ),
    );

    /**
     * Previsualización.
     *
     * `switchMap`: el editor la dispara al cambiar la configuración, así que la
     * respuesta de una muestra vieja llegando después de la nueva pintaría un
     * XML que no corresponde a lo que está en pantalla — y ese XML es lo que el
     * operador va a leer para decidir si el IVA está bien.
     *
     * **No hay toast en el fallo.** El error de la previsualización se pinta
     * DENTRO del panel, junto al formulario de la muestra: un toast que
     * desaparece a los tres segundos no sirve para corregir un dato, y el
     * usuario está mirando el panel, no la esquina de la pantalla.
     */
    readonly preview$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.previewProfile),
            switchMap(({ id, payload }) =>
                this.profiles.preview(id, payload).pipe(
                    map((response) =>
                        ProfileActions.previewProfileSuccess({
                            profileId: id,
                            result: response.data,
                        }),
                    ),
                    catchError((error) =>
                        of(
                            ProfileActions.previewProfileFailure(
                                this.fail(error, { silent: true }),
                            ),
                        ),
                    ),
                ),
            ),
        ),
    );

    /**
     * Snapshot de una versión concreta del historial.
     *
     * `switchMap`: si el usuario pincha tres versiones seguidas, la respuesta
     * que importa es la de la última — dejar llegar una anterior pintaría el
     * snapshot equivocado bajo la versión seleccionada, que en una revisión
     * fiscal es peor que no mostrar nada.
     */
    readonly loadVersion$ = createEffect(() =>
        this.actions$.pipe(
            ofType(ProfileActions.loadProfileVersion),
            switchMap(({ id, version }) =>
                this.profiles.version(id, version).pipe(
                    map((response) =>
                        ProfileActions.loadProfileVersionSuccess({
                            profileId: id,
                            snapshot: response.data,
                        }),
                    ),
                    catchError((error) =>
                        of(
                            ProfileActions.loadProfileVersionFailure(
                                this.fail(error, { silent: false }),
                            ),
                        ),
                    ),
                ),
            ),
        ),
    );

    /**
     * Punto único de reporte de fallos.
     *
     * `describeApiFailure` traduce el `error_code` a la copia en español del
     * catálogo. El código se propaga en la acción para que la vista ramifique;
     * el toast es la red de seguridad para que ningún fallo sea invisible,
     * excepto donde el error se pinta en su propio panel (`silent`).
     */
    private fail(
        error: unknown,
        options: { silent?: boolean } = {},
    ): { error: string; errorCode?: string | null; details?: unknown } {
        const failure = describeApiFailure(error);
        if (!options.silent) {
            this.toast.error(failure.message);
        }
        return {
            error: failure.message,
            errorCode: failure.errorCode,
            details: failure.details,
        };
    }
}
