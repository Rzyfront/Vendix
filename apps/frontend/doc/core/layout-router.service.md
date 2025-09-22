# LayoutRouterService

Responsable de calcular la URL destino tanto para usuarios anónimos (por `DomainApp`) como para usuarios autenticados (por roles + preferencia + contexto de dominio).

## API propuesta
- computeHomeUrlFor(domainApp: DomainApp | string, ctx?): string
- computePostLoginUrl(user: UserProfile, domainApp: DomainApp | string, ctx?): string
- layoutToUrl(layout: LayoutKey, ctx?): string

## Reglas resumidas
- Home anónima: se basa en `DomainApp`.
- Post-login: usa matriz de acceso por roles; respeta `preferredLayout` si permitido; sino usa prioridad.
- El branding siempre proviene del dominio resuelto; no afecta la ruta, sólo el tema.

## Ejemplos
- domainApp=VENDIX_LANDING (anónimo) → '/'
- user(owner, preferred=admin), domainApp=VENDIX_LANDING → '/admin'
- user(employee) → '/pos'
- user(customer) → '/shop'
