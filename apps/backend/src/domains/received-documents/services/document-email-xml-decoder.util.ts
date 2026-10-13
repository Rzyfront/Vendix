import { BadRequestException } from '@nestjs/common';
import { TextDecoder } from 'node:util';

export interface DecodedEmailXml {
  xml: string;
  encoding: 'utf-8' | 'iso-8859-1';
}

const MAX_XML_BYTES = 10 * 1024 * 1024;

function unsupportedEncoding(): never {
  throw new BadRequestException({
    reason_code: 'UNSUPPORTED_ENCODING',
    message: 'La codificación del XML no es compatible o no coincide con su declaración.',
  });
}

/** Decode only the parsing copy. The caller retains the original immutable bytes for evidence. */
export function decodeEmailXml(buffer: Buffer): DecodedEmailXml {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException({ reason_code: 'INVALID_FISCAL_XML', message: 'El XML está vacío.' });
  }
  if (buffer.length > MAX_XML_BYTES) {
    throw new BadRequestException({ reason_code: 'INVALID_FISCAL_XML', message: 'El XML excede el límite de 10 MiB.' });
  }
  // UTF-16/32 BOMs and zero-padded XML prefixes are not supported in P0.
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) ||
      (buffer[0] === 0xfe && buffer[1] === 0xff) ||
      buffer.subarray(0, 4).includes(0)) unsupportedEncoding();

  const hasUtf8Bom = buffer.length >= 3 &&
    buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const payload = hasUtf8Bom ? buffer.subarray(3) : buffer;
  // The XML declaration is ASCII in either accepted encoding. Bound this
  // inspection; a malformed/oversized declaration is rejected by the parser.
  const header = payload.subarray(0, 1024).toString('latin1');
  const declaration = /^<\?xml\b[^?]*\?>/.exec(header)?.[0];
  if (/^<\?xml\b/.test(header) && !declaration) unsupportedEncoding();
  const declared = declaration?.match(/\bencoding\s*=\s*(['"])([^'"]+)\1/i)?.[2]?.toLowerCase();
  let encoding: DecodedEmailXml['encoding'] = 'utf-8';
  if (declared) {
    if (declared === 'utf-8' || declared === 'utf8') encoding = 'utf-8';
    else if (declared === 'iso-8859-1' || declared === 'latin1' || declared === 'latin-1') encoding = 'iso-8859-1';
    else unsupportedEncoding();
  }
  if (hasUtf8Bom && encoding !== 'utf-8') unsupportedEncoding();

  let xml: string;
  try {
    // Buffer's latin1 mapping is ISO-8859-1, unlike WHATWG TextDecoder's
    // "iso-8859-1" alias (Windows-1252). Never transcode evidence bytes.
    xml = encoding === 'iso-8859-1'
      ? payload.toString('latin1')
      : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
  } catch {
    return unsupportedEncoding();
  }
  if (!xml.trim()) {
    throw new BadRequestException({ reason_code: 'INVALID_FISCAL_XML', message: 'El XML está vacío.' });
  }
  // xmldom receives a Unicode string; the encoding attribute must describe
  // this parsing copy, not the untouched source that remains with the caller.
  if (declaration && declared) {
    xml = xml.replace(/^<\?xml\b[^?]*\?>/, (value) =>
      value.replace(/\bencoding\s*=\s*(['"])[^'"]+\1/i, 'encoding="UTF-8"'));
  }
  return { xml, encoding };
}
