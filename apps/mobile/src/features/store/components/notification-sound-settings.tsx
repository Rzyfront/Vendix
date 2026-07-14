import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer } from 'expo-audio';
import {
  Selector,
  type SelectorOption,
} from '@/shared/components/selector/selector';
import {
  getNotificationSoundsCatalog,
  type NotificationSoundCatalogItem,
} from '@/features/store/services/notification-sounds-catalog.service';
import { borderRadius } from '@/shared/theme';

/**
 * `NotificationSoundSettings` — bloque de configuración de sonido de
 * notificaciones (selector + probar + slider de volumen).
 *
 * Réplica del sub-bloque "Sonido de notificaciones" del web
 * `notifications-settings-form.component.ts`. Encapsula:
 *  - Catálogo de sonidos (`GET /notification-sounds`, cacheado a nivel de
 *    servicio — mismo patrón que `uom.service.ts`).
 *  - Reproductor de preview con `expo-audio` (auto-stop a 1.5s).
 *  - Slider de volumen (responder handlers directos en un `<View>`,
 *    parity con web `<input type="range">`).
 *  - Popover anchored para el selector de sonido (parity con el shared
 *    `<Selector>` que usan los módulos pop y prebulk).
 *
 * El toggle "Silenciar sonidos" (`sound_muted`) NO vive aquí porque es un
 * ajuste de alto nivel que también afecta a las suscripciones push; lo
 * mantiene el padre (Settings → General → Alertas) que tiene acceso al
 * `<AppToggle>` local. Esta vista recibe `muted` para deshabilitar todos
 * sus controles de forma coherente con la UI.
 */
export interface NotificationSoundSettingsProps {
  /** ID del sonido seleccionado actualmente (null = sin sonido). */
  soundId: string | null | undefined;
  /** Volumen 0-100. */
  soundVolume: number | undefined;
  /** Cuando true, todos los controles quedan deshabilitados visualmente. */
  muted: boolean;
  onSoundIdChange: (id: string | null) => void;
  onSoundVolumeChange: (volume: number) => void;
}

export default function NotificationSoundSettings({
  soundId,
  soundVolume,
  muted,
  onSoundIdChange,
  onSoundVolumeChange,
}: NotificationSoundSettingsProps) {
  // Catálogo de sonidos (inmutable en runtime). staleTime 1h reusa la
  // entrada del queryClient entre mounts (parity con uom.service.ts).
  const { data: soundsCatalog } = useQuery<NotificationSoundCatalogItem[]>({
    queryKey: ['notification-sounds-catalog'],
    queryFn: () => getNotificationSoundsCatalog(),
    staleTime: 1000 * 60 * 60,
  });

  // Reproductor de preview (expo-audio). Se inicializa con `null` para
  // poder llamar `replace(url)` cuando el usuario elige un sonido.
  const soundPlayer = useAudioPlayer(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track width para mapear locationX → porcentaje en el slider.
  // Se mide sobre el rail visible (4px de alto, ancho completo) — no sobre el
  // wrapper de 40px, así `locationX / width` da el porcentaje correcto aunque
  // el usuario tapee por encima o por debajo del rail.
  const [soundRailWidth, setSoundRailWidth] = useState(0);

  // Porcentaje clampeado 0-100 (el form puede traer null mientras carga).
  const safeVolume = Math.max(0, Math.min(100, soundVolume ?? 70));

  const stopPreview = useCallback(() => {
    // Pause + reset al inicio del source para que un play() posterior empiece
    // desde 0. Si solo hiciéramos pause(), `expo-audio` puede reanudar el
    // source anterior en lugar de reemplazarlo limpio.
    try {
      soundPlayer.pause();
      soundPlayer.seekTo(0);
    } catch {
      // Si el player está en estado inválido (nunca inicializado), ignorar.
    }
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, [soundPlayer]);

  const handlePlayPreview = useCallback(() => {
    if (!soundId) return;
    const sound = soundsCatalog?.find((s) => s.id === soundId);
    if (!sound?.url) return;

    const vol = Math.max(0, Math.min(1, safeVolume / 100));
    try {
      // Detener cualquier preview en curso antes de reemplazarlo (parity con
      // web `this.stopPreview()` línea 202 + previene race de `replace()` que
      // deja el source anterior sonando encima del nuevo).
      stopPreview();
      soundPlayer.replace(sound.url);
      soundPlayer.volume = vol;
      soundPlayer.seekTo(0);
      soundPlayer.play();
      // Auto-stop a 1.5s por seguridad (parity con web playPreview).
      previewTimerRef.current = setTimeout(() => {
        try { soundPlayer.pause(); } catch {}
      }, 1500);
    } catch {
      // Silenciar errores de playback (network, codec, permisos) — el form
      // sigue siendo usable.
    }
  }, [soundId, safeVolume, soundsCatalog, soundPlayer, stopPreview]);

  const handleVolumeScrub = useCallback(
    (locationX: number) => {
      if (soundRailWidth <= 0) return;
      const pct = Math.max(0, Math.min(100, (locationX / soundRailWidth) * 100));
      onSoundVolumeChange(Math.round(pct));
    },
    [soundRailWidth, onSoundVolumeChange],
  );

  // Responder handlers directos sobre el `<View>` del track — patrón más simple
  // de RN que evita las trampas del PanResponder vs ScrollView. Web usa
  // `<input type="range">` nativo; en RN sin librería externa este es el
  // equivalente más robusto.
  //
  // `onStartShouldSetResponderCapture: () => true` gana el touch al ScrollView
  // padre en la fase de captura (no podemos llamar handlers directos porque
  // RN resuelve el conflicto entre responder system y ScrollView via el
  // sistema de capture phase). Si el padre pide release, lo negamos para
  // mantener el responder durante todo el drag.
  const onTrackResponderStart = useCallback(
    (evt: GestureResponderEvent) => handleVolumeScrub(evt.nativeEvent.locationX),
    [handleVolumeScrub],
  );
  const onTrackResponderMove = useCallback(
    (evt: GestureResponderEvent) => handleVolumeScrub(evt.nativeEvent.locationX),
    [handleVolumeScrub],
  );
  const onTrackResponderTerminateRequest = useCallback(() => false, []);

  // Limpia el timer + pausa el audio al desmontar. Sin esto, el preview puede
  // seguir sonando en background (memory leak + sonido fantasma al cambiar
  // de pantalla). Parity con web `DestroyRef.onDestroy(() => this.stopPreview())`.
  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  // Opciones del selector — "Sin sonido" primero + catálogo.
  const selectorOptions = [
    { value: null, label: '— Sin sonido —' },
    ...((soundsCatalog ?? []).map((s) => ({
      value: s.id as string | null,
      label: s.name,
    })) as SelectorOption<string | null>[]),
  ];

  const canPreview = !!soundId && !muted;
  const isDisabled = muted;

  return (
    <View style={{ opacity: isDisabled ? 0.5 : 1 }} pointerEvents={isDisabled ? 'none' : 'auto'}>
      <View style={styles.row}>
        <Selector<string | null>
          label="Sonido seleccionado"
          value={soundId ?? null}
          onChange={onSoundIdChange}
          options={selectorOptions}
          placeholder="— Sin sonido —"
          disabled={isDisabled}
          style={{ flex: 1 }}
        />
        <TouchableOpacity
          style={[
            styles.previewButton,
            { backgroundColor: canPreview ? '#2ecc71' : '#9CA3AF' },
          ]}
          disabled={!canPreview}
          onPress={handlePlayPreview}
          accessibilityRole="button"
          accessibilityLabel="Probar sonido"
        >
          <Ionicons name="play" size={16} color="#FFFFFF" />
          <Text style={styles.previewButtonText}>Probar</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.volumeLabel}>Volumen: {safeVolume}%</Text>
      {/* Slider interactivo (parity web <input type="range">). Tap y drag
          horizontal via responder handlers directos en el `<View>`. El
          thumb sigue el dedo. Arquitectura:
          - `<View sliderTrack>` (40px alto) = área clicable completa +
            captura el touch via `onStartShouldSetResponderCapture` para
            ganar al `<ScrollView>` padre.
          - `<View sliderRail>` (4px alto) = línea visual del rail (gris/fill
            púrpura). Centrada vertical dentro del track.
          - `<View sliderThumb>` (16×16) = knob posicionado al % actual.
          Split track / rail para que el usuario pueda tapeear arriba o abajo
          del rail sin perder precisión de `locationX / width`. */}
      <View
        onLayout={(e) => setSoundRailWidth(e.nativeEvent.layout.width)}
        style={styles.sliderTrack}
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponderCapture={() => true}
        onResponderTerminationRequest={onTrackResponderTerminateRequest}
        onResponderGrant={onTrackResponderStart}
        onResponderMove={onTrackResponderMove}
        // Accesibilidad: el web usa `<input type="range">` que el lector de
        // pantalla anuncia como "slider, X%". En RN declarativo hay que
        // configurarlo a mano con accessibilityRole + accessibilityValue.
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Volumen de notificaciones"
        accessibilityValue={{
          min: 0,
          max: 100,
          now: Math.round(safeVolume),
        }}
        accessibilityHint="Desliza para ajustar el volumen entre 0 y 100 por ciento"
      >
        <View style={styles.sliderRail}>
          <View style={[styles.sliderFill, { width: `${safeVolume}%` }]} />
        </View>
        <View
          style={[
            styles.sliderThumb,
            { left: `${safeVolume}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 44,
    borderRadius: borderRadius.md,
  },
  previewButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 6,
  },
  volumeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  sliderTrack: {
    // Wrapper de 40px — área clicable amplia + captura el touch via
    // onStartShouldSetResponderCapture.
    height: 40,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderRail: {
    // Visual del rail: 4px de alto centrado verticalmente dentro del track.
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 2,
  },
  sliderThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#7C3AED',
    position: 'absolute',
    marginLeft: -8,
    // Centrado vertical dentro del track de 40px (16px knob + 12px offset = top 12).
    top: 12,
    // Elevación sobre el rail — RN no soporta z-index de hermano confiable,
    // pero el orden en JSX (después del rail) lo pone encima en iOS y Android.
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
});
