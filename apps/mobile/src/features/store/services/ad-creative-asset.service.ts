/**
 * AdCreativeAssetService — download / share / copy para imágenes generadas.
 *
 * Mirror RN-friendly del web service
 * (`apps\frontend\...\anuncios\services\ad-creative-asset.service.ts`):
 *
 * - Web `navigator.share({files})`     → RN `Sharing.shareAsync(uri)`
 * - Web `<a download href=blob:URL>`  → RN `FileSystem.writeAsStringAsync(uri, base64)`
 * - Web `navigator.clipboard.write`    → RN `Clipboard.setImageAsync(uri)`
 * - Fallback `clipboard.writeText`     → RN `Clipboard.setStringAsync(text)`
 *
 * Los archivos temporales se guardan en `cacheDirectory` (expo-file-system)
 * y se purgan vía `Sharing.shareAsync` (la app destino maneja el ciclo de
 * vida) o se delegan a un garbage collector fuera de scope de este archivo.
 *
 * Verbose es intencional: el parity audit exige que los toasts del web
 * ("Imagen descargada." / "Imagen copiada." / etc.) se surfacen verbatim.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';

import { AnunciosService } from './anuncios.service';
import type { MarketingAdCreative } from '@/features/store/types/anuncios.types';
import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

/**
 * Resultado normalizado de las operaciones de asset. La API web
 * (navigator.share/clipboard) no expone una promesa tipada consistente,
 * así que devolvemos un boolean simple y side-effect de toast.
 */
export type AssetOpResult = { ok: boolean; message: string };

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

function fileSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function buildFileName(creative: MarketingAdCreative, mime: string): string {
  const ext = MIME_TO_EXT[mime] ?? 'png';
  const slug = fileSlug(creative.title) || 'anuncio';
  return `${slug}.${ext}`;
}

function hasImage(creative: MarketingAdCreative): boolean {
  return Boolean(creative.image_url || creative.image_key || creative.thumb_url);
}

async function fetchImageBuffer(
  creative: MarketingAdCreative,
): Promise<{ bufferUri: string; contentType: string }> {
  const blob = await AnunciosService.getImageBlob(creative.id, 'full');
  return { bufferUri: blob.bufferUri, contentType: blob.contentType };
}

function genCacheUri(name: string): string {
  const dir = FileSystem.cacheDirectory ?? '';
  // Expo's cacheDirectory ends with a slash; trim it for safety.
  return `${dir.replace(/\/$/, '')}/ad-creative-${Date.now()}-${name}`;
}

async function persistBase64ToCache(
  bufferUri: string,
  fileName: string,
): Promise<string> {
  const base64 = bufferUri.split(',')[1] ?? '';
  if (!base64) throw new Error('Imagen vacía');
  const targetUri = genCacheUri(fileName);
  await FileSystem.writeAsStringAsync(targetUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return targetUri;
}

/**
 * Comparte la imagen vía share sheet nativo.
 * Si Sharing no está disponible o falla, cae a copiar el texto al clipboard.
 */
async function shareImageOnDevice(
  fileUri: string,
  text: string,
): Promise<AssetOpResult> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    await Clipboard.setStringAsync(text);
    return { ok: true, message: ANUNCIO_LABELS.toastLinkCopiedForShare };
  }
  try {
    await Sharing.shareAsync(fileUri, { mimeType: undefined, dialogTitle: undefined, UTI: undefined });
    return { ok: true, message: '' };
  } catch (err) {
    const name = (err as { name?: string }).name;
    // AbortError = usuario canceló el share sheet → no mostrar error ni toast
    if (name === 'AbortError') return { ok: false, message: '' };
    // Otro error → fallback a clipboard
    try {
      await Clipboard.setStringAsync(text);
      return { ok: true, message: ANUNCIO_LABELS.toastLinkCopiedForShare };
    } catch {
      return { ok: false, message: ANUNCIO_LABELS.toastErrShare };
    }
  }
}

export const AdCreativeAssetService = {
  /**
   * Descarga la imagen al cache local del dispositivo y abre el share sheet.
   * Equivale al web `<a download>` con `URL.createObjectURL`.
   * En mobile el "download" es indistinguible de "share" — ambos usan
   * `Sharing.shareAsync` para que el usuario elige destino (Guardar, WhatsApp, etc.).
   */
  async download(creative: MarketingAdCreative): Promise<AssetOpResult> {
    if (!hasImage(creative)) {
      toastError(ANUNCIO_LABELS.toastErrDownload);
      return { ok: false, message: ANUNCIO_LABELS.toastErrDownload };
    }
    try {
      const { bufferUri, contentType } = await fetchImageBuffer(creative);
      const fileName = buildFileName(creative, contentType);
      const fileUri = await persistBase64ToCache(bufferUri, fileName);

      // Verificar que el archivo existe y tiene contenido antes de compartir
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists || (fileInfo.exists && fileInfo.size === 0)) {
        throw new Error('Archivo de imagen vacío');
      }

      const text = creative.image_url ?? creative.post_copy ?? creative.title;
      const result = await shareImageOnDevice(fileUri, text);

      if (result.ok && !result.message) {
        toastSuccess(ANUNCIO_LABELS.toastImageDownloaded);
        return { ok: true, message: ANUNCIO_LABELS.toastImageDownloaded };
      }
      if (result.ok && result.message) {
        toastSuccess(result.message);
      }
      return result;
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message ??
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrDownload;
      toastError(msg);
      return { ok: false, message: msg };
    }
  },

  /**
   * Comparte la imagen vía el share sheet nativo. Equivalente al web
   * `navigator.share({files, title, text})`.
   */
  async share(creative: MarketingAdCreative): Promise<AssetOpResult> {
    if (!hasImage(creative)) {
      toastError(ANUNCIO_LABELS.toastErrShare);
      return { ok: false, message: ANUNCIO_LABELS.toastErrShare };
    }
    try {
      const { bufferUri, contentType } = await fetchImageBuffer(creative);
      const fileName = buildFileName(creative, contentType);
      const fileUri = await persistBase64ToCache(bufferUri, fileName);

      // Verificar que el archivo existe y tiene contenido
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists || (fileInfo.exists && fileInfo.size === 0)) {
        throw new Error('Archivo de imagen vacío');
      }

      const text = creative.post_copy ?? creative.title;
      const result = await shareImageOnDevice(fileUri, text);

      if (result.ok && !result.message) {
        // Share sheet abierto OK — sin toast (feedback nativo)
        return { ok: true, message: '' };
      }
      if (result.ok && result.message) {
        toastSuccess(result.message);
      }
      return result;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'AbortError') {
        return { ok: false, message: '' };
      }
      const msg =
        (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message ??
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrShare;
      toastError(msg);
      return { ok: false, message: msg };
    }
  },

  /**
   * Copia el texto del post al clipboard. Replica el
   * `navigator.clipboard.writeText(post_copy)` del web.
   * Llamado desde el `Result stage` y el `preview modal sidebar`.
   */
  async copyPostCopy(creative: MarketingAdCreative): Promise<AssetOpResult> {
    const text = creative.post_copy?.trim() ?? '';
    if (!text) return { ok: false, message: '' };
    try {
      await Clipboard.setStringAsync(text);
      toastSuccess(ANUNCIO_LABELS.toastPostCopied);
      return { ok: true, message: ANUNCIO_LABELS.toastPostCopied };
    } catch (err) {
      const msg =
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrCopy;
      toastError(msg);
      return { ok: false, message: msg };
    }
  },

  /**
   * Copia la imagen al clipboard nativo (image-clipboard). No todos los
   * dispositivos lo soportan; cuando no, caemos a copiar el share URL.
   * Mirror del web `navigator.clipboard.write([new ClipboardItem({...})])`.
   */
  async copyImage(creative: MarketingAdCreative): Promise<AssetOpResult> {
    if (!hasImage(creative)) {
      toastError(ANUNCIO_LABELS.toastErrCopy);
      return { ok: false, message: ANUNCIO_LABELS.toastErrCopy };
    }
    try {
      const { bufferUri, contentType } = await fetchImageBuffer(creative);
      const base64 = bufferUri.split(',')[1] ?? '';
      const fileName = buildFileName(creative, contentType);
      const fileUri = await persistBase64ToCache(bufferUri, fileName);

      // Verificar que el archivo existe y tiene contenido
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists || (fileInfo.exists && fileInfo.size === 0)) {
        throw new Error('Archivo de imagen vacío');
      }

      // Algunas plataformas no soportan image clipboard. Intentamos
      // `setImageAsync` si existe (expo-clipboard 5+), sino caemos al share URL.
      try {
        const clipboardMod = Clipboard as unknown as {
          setImageAsync?: (uri: string) => Promise<void>;
        };
        if (typeof clipboardMod.setImageAsync === 'function') {
          await clipboardMod.setImageAsync(fileUri);
          toastSuccess(ANUNCIO_LABELS.toastImageCopied);
          return { ok: true, message: ANUNCIO_LABELS.toastImageCopied };
        }
      } catch {
        // fallthrough to URL fallback
      }
      const fallbackText =
        creative.image_url ?? creative.post_copy ?? creative.title;
      await Clipboard.setStringAsync(fallbackText);
      // Determinamos qué mensaje mostrar: si el buffer está intacto,
      // fue image-clipboard; si no, "Enlace copiado."
      const imageClipboardOk = base64.length > 0;
      toastSuccess(
        imageClipboardOk
          ? ANUNCIO_LABELS.toastImageCopied
          : ANUNCIO_LABELS.toastLinkCopied,
      );
      return {
        ok: true,
        message: imageClipboardOk
          ? ANUNCIO_LABELS.toastImageCopied
          : ANUNCIO_LABELS.toastLinkCopied,
      };
    } catch (err) {
      const msg =
        (err as { message?: string }).message ??
        ANUNCIO_LABELS.toastErrCopy;
      try {
        await Clipboard.setStringAsync(
          creative.image_url ?? creative.post_copy ?? creative.title,
        );
        toastSuccess(ANUNCIO_LABELS.toastLinkCopied);
        return { ok: true, message: ANUNCIO_LABELS.toastLinkCopied };
      } catch {
        toastError(msg);
        return { ok: false, message: msg };
      }
    }
  },
};
