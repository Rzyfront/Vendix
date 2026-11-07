import type { Request } from 'express';
import { ErrorCodes, VendixHttpException } from '@common/errors';

/**
 * Reads the raw bytes of an `application/octet-stream` request (the JSON parser
 * ignores that type) refusing anything above `maxBytes` while streaming.
 */
export async function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  const tooLarge = () =>
    new VendixHttpException(
      ErrorCodes.WORKFLOW_UPLOAD_INVALID,
      `Cada parte puede pesar como máximo ${maxBytes} bytes.`,
    );
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (Buffer.isBuffer((req as { body?: unknown }).body)) {
    const body = (req as { body: Buffer }).body;
    if (body.length > maxBytes) throw tooLarge();
    return body;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) throw tooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
