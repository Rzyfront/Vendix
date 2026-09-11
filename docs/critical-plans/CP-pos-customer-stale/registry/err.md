# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `POS_CUSTOMER_REQUIRED` | 400 |falta customer_id con require_customer_data|bloquea pago, pide cliente|`Se requiere cliente`|`curl sin customer_id => 400 codigo`|[ ]|
| ERR-02 | `CUSTOMER_STORE_MISMATCH` | 403 |customer_id de otra tienda|toast error, no avanza|`Cliente no es de la tienda`|`curl id ajeno => 403 codigo`|[ ]|
| ERR-03 | `RESOLVE_VALIDATION` | 400 |resolve sin email/doc/nombre|toast info, se queda en paso|`Ingresa email, documento o nombre`|`curl resolve vacio => 400`|[ ]|
| ERR-04 | `SYS_INTERNAL_001` | 500 |falla no mapeada|toast genérico, no avanza|ver `vendix-error-handling`|grep `throw new Error` en ruta POS|[ ]|
