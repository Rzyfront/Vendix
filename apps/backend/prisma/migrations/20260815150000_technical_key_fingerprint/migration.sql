-- DATA IMPACT:
-- Tables affected: invoice_resolutions
-- Expected row changes: NONE. Solo se agrega una columna nullable y su indice.
--                       Ninguna fila se lee, se actualiza ni se borra.
-- Destructive operations: none
-- FK/cascade risk: none (columna escalar, sin llaves foraneas)
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- Approval: no requiere — migracion puramente aditiva (CLAUDE.md 6.3 aplica a
--           migraciones que mutan filas; esta no muta ninguna).

-- Huella determinista de la clave tecnica DIAN (ClTec).
--
-- POR QUE HACE FALTA UNA TERCERA COLUMNA. `technical_key_encrypted` usa
-- AES-256-GCM con salt e IV frescos por registro, asi que dos filas con la MISMA
-- ClTec producen ciphertexts DISTINTOS. Eso es correcto criptograficamente y es
-- justamente lo que rompe la unica consulta que compara claves entre filas:
-- `findResolutionsSharingTechnicalKey` busca, SIN scope de tenant y en toda la
-- plataforma, otra resolucion con la misma ClTec — el detector de contaminacion
-- cruzada entre NIT. Contra la columna cifrada esa igualdad JAMAS coincide, y su
-- respuesta vacia se lee identica a «no hay contaminacion»: un control de
-- seguridad que se apaga sin decirlo.
--
-- POR QUE LA HUELLA NO LLEVA LLAVE. Es un SHA-256 pelado de la ClTec
-- normalizada, no un HMAC. Dos razones:
--   1. La ClTec es un SHA-1 en hexadecimal — 160 bits de entropia sin estructura
--      adivinable. No es un NIT ni una cedula: no hay diccionario que enumerar,
--      asi que la huella no revela el secreto.
--   2. Sin llave, la huella es ESTABLE entre entornos y sobrevive a una rotacion
--      de `DIAN_ENCRYPTION_KEY`. Con HMAC, rotar la llave dejaria mudo al mismo
--      detector que esta columna existe para mantener vivo.
ALTER TABLE "invoice_resolutions"
  ADD COLUMN IF NOT EXISTS "technical_key_fingerprint" VARCHAR(64);

-- El detector consulta por huella exacta y sin scope: la busqueda recorre la
-- tabla entera de la plataforma, no la de un tenant.
CREATE INDEX IF NOT EXISTS "idx_invoice_resolutions_technical_key_fingerprint"
  ON "invoice_resolutions" ("technical_key_fingerprint");
