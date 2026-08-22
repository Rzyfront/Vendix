import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ApiResponse } from '../interfaces/invoice.interface';
import type { InvoiceProfileConfig } from '../../../../../core/utils/invoice-profile-config.contract';
import type {
    CloneInvoiceProfilePayload,
    CreateInvoiceProfilePayload,
    InvoiceProfile,
    InvoiceProfileDetail,
    InvoiceProfilePageMeta,
    InvoiceProfileQuery,
    InvoiceProfileVersion,
    InvoiceProfileVersionSummary,
    PreviewProfilePayload,
    ProfilePreviewResult,
    UpdateInvoiceProfilePayload,
} from '../interfaces/invoice-profile.interface';

/** Envelope paginado. `ApiResponse<T>` no declara `meta`, y el listado lo trae. */
export interface ApiPagedResponse<T> extends ApiResponse<T> {
    meta: InvoiceProfilePageMeta;
}

/** Plantilla de perfil que ofrece `GET …/profiles/templates`. */
export interface InvoiceProfileTemplate {
    key: string;
    name: string;
    description: string;
    operation_type: string;
    config: InvoiceProfileConfig;
}

/** Entrada del catálogo de perfiles activos que consume el wizard de factura. */
export interface InvoiceProfileCatalogEntry {
    id: number;
    name: string;
    operation_type: string;
    is_default: boolean;
    current_version: number;
}

/**
 * HTTP de los perfiles de facturación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO HAY `catchError` EN NINGÚN MÉTODO, Y ES DELIBERADO
 * ─────────────────────────────────────────────────────────────────────────────
 * Un `catchError` que devuelve `of(null)` —o que re-lanza un `Error` con el
 * mensaje ya formateado— destruye el `HttpErrorResponse`, y con él el
 * `error_code` del cuerpo. Sin ese código la UI no puede distinguir «el nombre
 * ya existe» (`INVOICING_PROFILE_002`) de «el perfil tiene facturas timbradas»
 * (`INVOICING_PROFILE_004`), y acaba mostrando el mismo toast genérico para
 * dos situaciones con salidas distintas. El error sube crudo hasta el efecto,
 * que es quien decide qué mostrar.
 *
 * La envoltura del backend es
 * `{statusCode, error_code, message, details, timestamp, path}` — el campo es
 * **`error_code`**, no `code`.
 *
 * Las rutas replican EXACTAMENTE las del controller, incluidas las estáticas
 * (`templates`, `catalog`) que allí van antes de `:id`. Aquí el orden no
 * importa, pero los nombres sí: `set-default` con guión, no `set_default`.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceProfileService {
    private readonly http = inject(HttpClient);

    private url(path = ''): string {
        return `${environment.apiUrl}/store/invoicing/profiles${path ? '/' + path : ''}`;
    }

    /**
     * Listado paginado.
     *
     * Sólo viajan los filtros con valor: el `ValidationPipe` global corre con
     * `forbidNonWhitelisted`, y un `state=''` es un valor que no está en
     * `INVOICE_PROFILE_STATES` — o sea, un 400 por mandar «sin filtro».
     */
    list(query: InvoiceProfileQuery = {}): Observable<ApiPagedResponse<InvoiceProfile[]>> {
        const params: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null && value !== '') {
                params[key] = value as string | number;
            }
        }
        return this.http.get<ApiPagedResponse<InvoiceProfile[]>>(this.url(), { params });
    }

    /** Detalle con el snapshot vigente. */
    getById(id: number): Observable<ApiResponse<InvoiceProfileDetail>> {
        return this.http.get<ApiResponse<InvoiceProfileDetail>>(this.url(`${id}`));
    }

    /** Plantillas de arranque (AIU, estándar…). */
    templates(): Observable<ApiResponse<InvoiceProfileTemplate[]>> {
        return this.http.get<ApiResponse<InvoiceProfileTemplate[]>>(this.url('templates'));
    }

    /**
     * Catálogo de perfiles activos, servido desde Redis.
     *
     * Es el que consume el wizard de factura: liviano y sin `config`, porque
     * elegir un perfil no requiere conocer sus reglas — timbrar sí, y eso lo
     * resuelve el backend con la versión congelada.
     */
    catalog(): Observable<ApiResponse<InvoiceProfileCatalogEntry[]>> {
        return this.http.get<ApiResponse<InvoiceProfileCatalogEntry[]>>(this.url('catalog'));
    }

    /** Historial de versiones (sin snapshots: la tabla no los necesita). */
    versions(
        id: number,
        page = 1,
        limit = 20,
    ): Observable<ApiPagedResponse<InvoiceProfileVersionSummary[]>> {
        return this.http.get<ApiPagedResponse<InvoiceProfileVersionSummary[]>>(
            this.url(`${id}/versions`),
            { params: { page, limit } },
        );
    }

    /** Una versión con su snapshot completo — la que alimenta el diff. */
    version(id: number, version: number): Observable<ApiResponse<InvoiceProfileVersion>> {
        return this.http.get<ApiResponse<InvoiceProfileVersion>>(
            this.url(`${id}/versions/${version}`),
        );
    }

    /** Crea un perfil. Responde 201. */
    create(payload: CreateInvoiceProfilePayload): Observable<ApiResponse<InvoiceProfileDetail>> {
        return this.http.post<ApiResponse<InvoiceProfileDetail>>(this.url(), payload);
    }

    /** Clona un perfil desde una versión concreta o desde la vigente. Responde 201. */
    clone(
        id: number,
        payload: CloneInvoiceProfilePayload,
    ): Observable<ApiResponse<InvoiceProfileDetail>> {
        return this.http.post<ApiResponse<InvoiceProfileDetail>>(
            this.url(`${id}/clone`),
            payload,
        );
    }

    /**
     * Edita un perfil.
     *
     * **Mandar `config` crea una versión nueva; mandar sólo `name` no.** El
     * editor tiene que omitir `config` cuando el usuario sólo renombró, o el
     * historial se llena de versiones idénticas y el diff pierde su utilidad.
     */
    update(
        id: number,
        payload: UpdateInvoiceProfilePayload,
    ): Observable<ApiResponse<InvoiceProfileDetail>> {
        return this.http.patch<ApiResponse<InvoiceProfileDetail>>(this.url(`${id}`), payload);
    }

    /**
     * Marca el perfil como predeterminado de su tipo de operación.
     *
     * Ruta y permiso propios (`invoicing:profiles:set_default`): cambia lo que
     * se timbra por omisión, así que no es una edición cualquiera y no viaja
     * dentro del `PATCH`.
     */
    setDefault(id: number): Observable<ApiResponse<InvoiceProfileDetail>> {
        return this.http.post<ApiResponse<InvoiceProfileDetail>>(
            this.url(`${id}/set-default`),
            {},
        );
    }

    /** Activa el perfil. */
    activate(id: number): Observable<ApiResponse<InvoiceProfileDetail>> {
        return this.http.post<ApiResponse<InvoiceProfileDetail>>(this.url(`${id}/activate`), {});
    }

    /** Desactiva el perfil. No borra: las facturas timbradas siguen apuntando a su versión. */
    deactivate(id: number): Observable<ApiResponse<InvoiceProfileDetail>> {
        return this.http.post<ApiResponse<InvoiceProfileDetail>>(
            this.url(`${id}/deactivate`),
            {},
        );
    }

    /**
     * Previsualiza el XML DIAN que este perfil produciría.
     *
     * `POST` que responde **200**, no 201: no crea nada. Ese detalle está en el
     * controller con `@HttpCode(HttpStatus.OK)` y aquí se documenta porque un
     * efecto que ramifique por status lo necesita.
     *
     * No reserva numeración, no firma, no transmite y no persiste — la
     * respuesta lo declara en `not_performed`, que la UI debe PINTAR en vez de
     * dar por supuesto.
     */
    preview(
        id: number,
        payload: PreviewProfilePayload,
    ): Observable<ApiResponse<ProfilePreviewResult>> {
        return this.http.post<ApiResponse<ProfilePreviewResult>>(
            this.url(`${id}/preview`),
            payload,
        );
    }

    /**
     * Borra un perfil.
     *
     * Responde 409 `INVOICING_PROFILE_004` si alguna factura timbrada
     * referencia una de sus versiones. La garantía última no es ese conteo sino
     * la FK compuesta hacia `invoice_profile_versions` con `ON DELETE
     * RESTRICT`: entre contar y borrar cabe una factura nueva, y esa carrera la
     * gana la base.
     */
    remove(id: number): Observable<ApiResponse<{ id: number }>> {
        return this.http.delete<ApiResponse<{ id: number }>>(this.url(`${id}`));
    }
}
