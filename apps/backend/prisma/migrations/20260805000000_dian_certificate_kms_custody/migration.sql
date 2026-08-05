-- DATA IMPACT:
-- Tables affected: dian_configurations (ADD COLUMN only, nullable, no default)
-- Expected row changes: NONE. No UPDATE, no DELETE, no INSERT, no column drop,
--                       no table drop, no constraint change, no default change.
-- Destructive operations: none
-- FK/cascade risk: none — no constraint is created, dropped or altered.
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- Approval: additive-only schema change; no production row is read or written by
--           this migration, so it carries no data risk to approve.
--
-- Purpose: allow the certificate's PRIVATE KEY to live in an HSM (AWS KMS
-- asymmetric key, `Origin: AWS_KMS`, `KeyUsage: SIGN_VERIFY`) instead of inside
-- the `.p12` stored in S3.
--
-- WHY a column and not an env var: custody is per accounting entity. A platform
-- with several fiscal entities may hold one certificate in an HSM (the entity that
-- invoices at volume) and another as a `.p12` (a small entity still migrating).
-- One env var would force the whole platform to move at once, which in practice
-- means nobody moves.
--
-- WHEN set, `DianXmlSignerService` produces the RSA signature inside KMS and the
-- `.p12` private key is never touched. The CERTIFICATE keeps coming from S3
-- regardless: it is public material and XAdES must publish it in
-- `KeyInfo`/`SigningCertificate`. So a container holding only the certificate
-- (no private key bag) is a valid and preferable configuration under HSM custody.
--
-- WHEN NULL, behaviour is byte-for-byte what it was: the private key is read from
-- the `.p12` in process memory. Nothing about existing rows changes, which is why
-- this migration mutates none of them.

ALTER TABLE "dian_configurations"
  ADD COLUMN IF NOT EXISTS "certificate_kms_key_id" TEXT;

COMMENT ON COLUMN "dian_configurations"."certificate_kms_key_id" IS
  'ARN or key-id of the AWS KMS asymmetric RSA key holding the certificate private key (non-exportable). NULL = private key read from the .p12 in S3.';
