# F.1 — `is_primary` aislado por cliente; daño histórico cuantificado

QA local tienda #10, 2026-09-23. Se usó token owner de la tienda, datos QA y consultas SQL de solo lectura salvo dos `PATCH` temporales restaurados al final. `AddressesService` specs **5/5**.

| Sonda | Resultado | Efecto |
| --- | --- | --- |
| POST `/store/addresses` con `is_primary:true`, sin `customer_id` | **400 `ADDR_PRIMARY_REQUIRES_CUSTOMER_001`** | Cero filas QA creadas, predeterminadas tienda #10 **11→11**. |
| POST con `customer_id:247` de otra tienda | **400 `ADDR_CUSTOMER_NOT_IN_STORE_001`** | Cero filas QA creadas, predeterminadas **11→11**. |
| PATCH dirección huérfana #10 con `is_primary:true` | **400 `ADDR_PRIMARY_REQUIRES_CUSTOMER_001`** | Fila histórica sin mutación, predeterminadas **11→11**. |
| PATCH dirección #484 del cliente #151 a `true`, luego #529 a `true` | Ambos **200**. Al final #484=false, #529=true, predeterminadas tienda **12** (solo la nueva del cliente, los otros 11 intactos). Ningún cliente con dos predeterminadas. | PATCH #529 a `false` restauró #484/#529 a false y la tienda a **11**. |

**Daño previo:** `SELECT count(*) FROM addresses WHERE is_primary AND user_id IS NULL` da **53**, pero **45** tienen `store_id IS NULL` (direcciones de organización, no libreta de cliente). El subconjunto relevante para F.1 es **8** direcciones de tienda sin cliente (una en tienda #10). No se cambian en este paso porque el plan excluye reparación histórica sin criterio del dueño. Clientes #151 y #197 de tienda #10 tienen dos direcciones cada uno y ninguna predeterminada; no hay forma fiable de inferir cuál elegir.

**Contrato que sigue abierto:** el registry ERR-26 decía HTTP 422, pero el catálogo y la API reales usan **400**. `UpdateAddressDto` acepta `customer_id` por `PartialType(CreateAddressDto)`, pero `AddressesService.update` lo ignora; FB-56 no puede declararse «adopción de huérfana posible» sin implementar/probar ese enlace (ADR-05 propuesto).
