# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | QUOTE_DESTINATION_001 | 422 | cambian destination | campo bloqueado + aviso | Destino no editable tras crear | PATCH y ver codigo | [x] |
| ERR-02 | QUOTE_CONVERT_STATUS_001 | 422 | convertir no aceptada | boton deshabilitado | Estado no permite convertir | POST en draft y ver codigo | [ ] |
| ERR-03 | CONTRACT_INDUSTRY_001 | 403 | sin construction | modulo oculto/pantalla no-access | No disponible en tu industria | curl sin industria y ver 403 | [ ] |
| ERR-04 | QPROFILE_STORE_001 | 400 | perfil de otro store | selector solo activos propios | Perfil no valido para tu tienda | POST con id ajeno | [x] |
| ERR-05 | QUOTE_CONTRACT_001 | 409 | contrato ya existe | muestra ficha existente | Ya tiene contrato creado | doble POST y ver 409 | [x] |
| ERR-06 | CONTRACT_STATUS_001 | 422 | transicion invalida | mensaje accionable | Transicion no permitida | PATCH invalido y ver codigo | [x] |
| ERR-07 | CONTRACT_INVOICE_001 | 409 | factura ya existe | enlace a factura | Contrato ya facturado | doble POST y ver 409 | [x] |
