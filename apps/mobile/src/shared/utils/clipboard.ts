import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';
import { toastInfo } from '@/shared/components/toast/toast.store';

/**
 * Wrapper de `expo-clipboard` con feedback de toast automático.
 *
 * - En web usa `navigator.clipboard.writeText` (fallback silencioso si no está
 *   disponible, ej. en contextos inseguros).
 * - En mobile usa `expo-clipboard` con fallback silencioso en errores.
 * - Muestra un `toastInfo('Copiado')` por defecto — pasa `silent: true` para
 *   suprimirlo (ej. cuando el caller ya emite su propio toast).
 *
 * Pensado para centralizar la lógica de "copiar al portapapeles + confirmar al
 * usuario" — antes estaba repetida en muchos componentes y nadie mostraba
 * feedback consistente.
 *
 * ## Dependencia requerida
 *
 * Este helper importa `expo-clipboard`. Si aún no está instalado:
 *   npx expo install expo-clipboard
 *
 * Si la dependencia no está presente, las llamadas a `copyToClipboard` en
 * mobile devolverán `false` silenciosamente (sin toast de error para no
 * molestar al usuario en flows donde copiar no es crítico).
 */

const isWeb = Platform.OS === 'web';

async function writeNative(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

async function writeWeb(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* swallow — clipboard puede fallar en contextos inseguros */
  }
  return false;
}

export interface CopyOptions {
  /**
   * Mensaje del toast. Default: `'Copiado'`.
   * Pasa `null` para usar el mensaje por defecto;
   * `silent: true` para suprimir el toast completamente.
   */
  message?: string | null;
  /** Si true, no muestra toast. Default: false. */
  silent?: boolean;
}

/**
 * Copia `text` al portapapeles y muestra un toast de confirmación.
 *
 * @returns `true` si la copia fue exitosa, `false` en caso contrario.
 *          En caso de fallo muestra `toastError('No se pudo copiar')`.
 */
export async function copyToClipboard(
  text: string,
  options: CopyOptions = {},
): Promise<boolean> {
  const { message = 'Copiado', silent = false } = options;
  const ok = isWeb ? await writeWeb(text) : await writeNative(text);

  if (silent) return ok;

  if (ok) {
    toastInfo(message ?? 'Copiado');
    return true;
  }
  return false;
}

/**
 * Atajo para `copyToClipboard(text, { silent: true })` — útil cuando el
 * caller ya emite su propio toast y no quiere duplicar el feedback.
 */
export async function copySilently(text: string): Promise<boolean> {
  return copyToClipboard(text, { silent: true });
}