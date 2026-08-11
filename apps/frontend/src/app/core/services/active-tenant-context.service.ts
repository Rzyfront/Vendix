import { Injectable, computed, signal } from '@angular/core';

/**
 * Alcance del tenant sobre el que opera el super admin. Plural obligatorio:
 * el backend responde 403 a cualquier ruta que contenga el literal `/store/`
 * con un token `VENDIX_ADMIN`.
 */
export type ActiveTenantScope = 'stores' | 'organizations';

export interface ActiveTenantContext {
  readonly scope: ActiveTenantScope;
  readonly tenantId: number;
  /** Nombre visible del tenant. Placeholder mientras el perfil carga. */
  readonly label: string;
  /** Organización a la que pertenece; `null` cuando el tenant ES la organización. */
  readonly organizationName: string | null;
  /** Directorio al que se vuelve al salir del perfil. */
  readonly exitRoute: string;
  /** `true` mientras el nombre real todavía no llegó del backend. */
  readonly resolving: boolean;
}

/**
 * Tenant sobre el que el super admin está operando ahora mismo.
 *
 * Existe por una razón concreta de seguridad operativa: la ficha de un tenant
 * es VISUALMENTE IDÉNTICA al panel de una tienda y al de la plataforma. Sin una
 * señal permanente, un super admin distraído sube el certificado digital de un
 * cliente a la ficha de otro. El layout pinta un banner ámbar mientras este
 * servicio tenga contexto.
 *
 * Es el ÚNICO trozo de este rail que vive en raíz, y sólo porque el layout está
 * fuera del subárbol de rutas del perfil. Guarda exclusivamente lo que el
 * banner pinta — jamás datos fiscales, secretos ni el perfil.
 */
@Injectable({ providedIn: 'root' })
export class ActiveTenantContextService {
  private readonly _context = signal<ActiveTenantContext | null>(null);

  readonly context = this._context.asReadonly();
  readonly isActive = computed(() => this._context() !== null);

  /**
   * Fija el tenant activo. Sustituye por completo al anterior en vez de
   * fusionarlo: un merge dejaría el nombre de la tienda previa colgando junto
   * al id de la nueva, que es precisamente el error que este banner evita.
   */
  set(context: ActiveTenantContext): void {
    this._context.set(context);
  }

  /**
   * Reemplaza el nombre una vez resuelto el perfil, sólo si el contexto sigue
   * apuntando al mismo tenant. Una respuesta rezagada de la tienda anterior no
   * puede renombrar la ficha que el usuario está mirando.
   */
  resolveLabel(
    scope: ActiveTenantScope,
    tenantId: number,
    label: string,
    organizationName: string | null,
  ): void {
    const current = this._context();
    if (!current || current.scope !== scope || current.tenantId !== tenantId) {
      return;
    }
    this._context.set({
      ...current,
      label,
      organizationName,
      resolving: false,
    });
  }

  clear(): void {
    this._context.set(null);
  }
}
