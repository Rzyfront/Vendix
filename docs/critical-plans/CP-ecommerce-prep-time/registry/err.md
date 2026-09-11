# Error Code Registry

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `VALIDATION_400` | 400 | PATCH con flag no booleano | admin muestra error y no guarda | mensaje de validacion del campo | `curl PATCH flag:"si" espera 400` | [ ] |
| ERR-02 | `CATALOG_EMPTY_200` | 200 | catalogo con flag on/off vacio | vitrina muestra estado vacio | mensaje de vitrina vacia | `curl search imposible espera []` | [ ] |
| ERR-03 | `NO_RAW_500` | 500 | throw nuevo en mappers | fail-closed: flag false y lista ok | toast generico | `grep throw` en mapeadores tocados || [x] |
