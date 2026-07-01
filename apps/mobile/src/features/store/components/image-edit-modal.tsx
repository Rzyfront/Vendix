import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  ScrollView,
  PanResponder,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

export interface ImageEditResult {
  uri: string;
  rotation: number;
  flippedH: boolean;
  flippedV: boolean;
  aspectRatio: number;
}

interface ImageEditModalProps {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onApply: (result: ImageEditResult) => void;
}

type AspectRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '4:5' | '9:16';

const ASPECT_RATIOS: Record<AspectRatio, number> = {
  'free': 0,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
};

type Handle = 'move' | 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | null;

interface Frame {
  x: number; // 0..1 left edge
  y: number; // 0..1 top edge
  w: number; // 0..1 width
  h: number; // 0..1 height
}

const MIN_SIZE = 0.1; // 10% del canvas mínimo

/**
 * Modal de edición de imagen (espejo del web "Ajustar y recortar").
 *
 * Funcionalidades:
 * - Rotar izquierda/derecha (90° por click)
 * - Voltear horizontal / vertical (mirror)
 * - Selector de relación de aspecto (Libre, 1:1, 4:3, 3:2, 16:9, 4:5, 9:16)
 * - Frame de crop interactivo: arrastrable y redimensionable
 *   - 4 esquinas + 4 lados (8 handles)
 *   - Restringido a los límites del canvas
 * - Helper text con información contextual
 * - Footer: Restablecer / Cancelar / Guardar ajuste
 *
 * Devuelve el uri original + metadatos de transformación.
 */
export function ImageEditModal({ visible, imageUri, onClose, onApply }: ImageEditModalProps) {
  const [rotation, setRotation] = useState(0);
  const [flippedH, setFlippedH] = useState(false);
  const [flippedV, setFlippedV] = useState(false);
  // Default: 1:1 (cuadrado) al subir una imagen. El usuario puede
  // cambiar a 'libre' u otro aspect desde los chips.
  const [aspect, setAspect] = useState<AspectRatio>('1:1');
  const [frame, setFrame] = useState<Frame>({ x: 0, y: 0, w: 1, h: 1 });
  // Aspect ratio real de la imagen (ancho/alto). Usado para dimensionar
  // el canvas según la imagen subida.
  const [imageAspect, setImageAspect] = useState<number>(1);
  // Dimensiones reales (en píxeles) de la imagen. Necesarias para
  // convertir el frame normalizado del canvas a coordenadas de píxeles
  // que `expo-image-manipulator` entiende al recortar.
  const [imageDims, setImageDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Loading mientras se aplica el crop/rotación/flip con expo-image-manipulator.
  const [processing, setProcessing] = useState(false);

  // Refs para el PanResponder (no trigger re-render)
  const containerSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const frameRef = useRef<Frame>({ x: 0, y: 0, w: 1, h: 1 });
  const activeHandleRef = useRef<Handle>(null);
  const startFrameRef = useRef<Frame | null>(null);
  const startTouchRef = useRef<{ x: number; y: number } | null>(null);
  // Ref espejo del aspect actual: lo lee el PanResponder sin recrearlo en
  // cada cambio de aspect. Cuando el aspect no es 'libre', el frame está
  // bloqueado y no se debe permitir arrastrarlo/redimensionarlo.
  const aspectRef = useRef<AspectRatio>('free');

  // Tamaño de la ventana: el canvas debe caber en el viewport y respetar
  // el aspect ratio de la imagen (mirror web: max-w-full + max-h-[60vh]).
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Actualizar el ref cuando el state cambia
  frameRef.current = frame;
  aspectRef.current = aspect;
  const frameLocked = aspect !== 'free';

  // Helpers de validación
  function clampFrame(f: Frame): Frame {
    let { x, y, w, h } = f;
    if (w < MIN_SIZE) w = MIN_SIZE;
    if (h < MIN_SIZE) h = MIN_SIZE;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > 1) x = 1 - w;
    if (y + h > 1) y = 1 - h;
    return { x, y, w, h };
  }

  function getHandle(touchX: number, touchY: number, current: Frame): Handle {
    const x0 = current.x * containerSizeRef.current.w;
    const y0 = current.y * containerSizeRef.current.h;
    const x1 = (current.x + current.w) * containerSizeRef.current.w;
    const y1 = (current.y + current.h) * containerSizeRef.current.h;
    const cornerSize = 20;
    // Esquinas (priority sobre lados)
    if (Math.abs(touchX - x0) < cornerSize && Math.abs(touchY - y0) < cornerSize) return 'tl';
    if (Math.abs(touchX - x1) < cornerSize && Math.abs(touchY - y0) < cornerSize) return 'tr';
    if (Math.abs(touchX - x0) < cornerSize && Math.abs(touchY - y1) < cornerSize) return 'bl';
    if (Math.abs(touchX - x1) < cornerSize && Math.abs(touchY - y1) < cornerSize) return 'br';
    // Lados
    if (Math.abs(touchY - y0) < 10 && touchX > x0 - 10 && touchX < x1 + 10) return 't';
    if (Math.abs(touchY - y1) < 10 && touchX > x0 - 10 && touchX < x1 + 10) return 'b';
    if (Math.abs(touchX - x0) < 10 && touchY > y0 - 10 && touchY < y1 + 10) return 'l';
    if (Math.abs(touchX - x1) < 10 && touchY > y0 - 10 && touchY < y1 + 10) return 'r';
    return 'move';
  }

  function updateFrame(handle: Handle, dx: number, dy: number): Frame {
    const current = frameRef.current;
    if (handle === 'move') {
      return clampFrame({
        x: current.x + dx / containerSizeRef.current.w,
        y: current.y + dy / containerSizeRef.current.h,
        w: current.w,
        h: current.h,
      });
    }
    let { x, y, w, h } = current;
    const aspectRatio = ASPECT_RATIOS[aspect];
    if (handle === 'tl') {
      const newX = current.x + dx / containerSizeRef.current.w;
      const newY = current.y + dy / containerSizeRef.current.h;
      w = current.w - (newX - current.x);
      h = current.h - (newY - current.y);
      x = newX;
      y = newY;
    } else if (handle === 'tr') {
      const newY = current.y + dy / containerSizeRef.current.h;
      h = current.h - (newY - current.y);
      w = current.w + dx / containerSizeRef.current.w;
      y = newY;
    } else if (handle === 'bl') {
      const newX = current.x + dx / containerSizeRef.current.w;
      h = current.h + dy / containerSizeRef.current.h;
      w = current.w - (newX - current.x);
      x = newX;
    } else if (handle === 'br') {
      w = current.w + dx / containerSizeRef.current.w;
      h = current.h + dy / containerSizeRef.current.h;
    } else if (handle === 't') {
      const newY = current.y + dy / containerSizeRef.current.h;
      h = current.h - (newY - current.y);
      y = newY;
    } else if (handle === 'b') {
      h = current.h + dy / containerSizeRef.current.h;
    } else if (handle === 'l') {
      const newX = current.x + dx / containerSizeRef.current.w;
      w = current.w - (newX - current.x);
      x = newX;
    } else if (handle === 'r') {
      w = current.w + dx / containerSizeRef.current.w;
    }
    // Si el aspect ratio está bloqueado, ajustar manteniendo la proporción
    if (aspectRatio && (handle === 'tl' || handle === 'tr' || handle === 'bl' || handle === 'br' || handle === 'l' || handle === 'r' || handle === 't' || handle === 'b')) {
      // Ajustar h según w (o viceversa) manteniendo aspect ratio
      if (handle === 'tl' || handle === 'tr' || handle === 'bl' || handle === 'br' || handle === 'l' || handle === 'r') {
        // Cambio en ancho, ajustar alto
        const newH = w / aspectRatio;
        if (handle === 'tl' || handle === 'tr') {
          // El alto decrece, mover y también
          y = y + (h - newH);
        }
        h = newH;
      } else {
        // Cambio en alto, ajustar ancho
        const newW = h * aspectRatio;
        if (handle === 'l' || handle === 'r') {
          // Para 'l'/'r' el cambio es en x, ajustar w
          // (no aplica directamente)
        }
        w = newW;
      }
    }
    return clampFrame({ x, y, w, h });
  }

  const panResponder = useRef(
    PanResponder.create({
      // Aceptamos el gesto siempre: el frame puede moverse aunque el
      // aspect ratio sea fijo. En `onPanResponderGrant` decidimos si
      // se trata de un drag válido (touch dentro del frame) o si lo
      // ignoramos (touch fuera del frame o intento de resize con
      // aspect bloqueado).
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const current = frameRef.current;
        const c = containerSizeRef.current;
        // Slop extra alrededor del frame para que sea más fácil de
        // atrapar con el dedo (sin esto, hay que ser muy preciso
        // para tocar justo sobre el borde).
        const touchSlop = 8;
        const x0 = current.x * c.w - touchSlop;
        const y0 = current.y * c.h - touchSlop;
        const x1 = (current.x + current.w) * c.w + touchSlop;
        const y1 = (current.y + current.h) * c.h + touchSlop;
        // Sólo iniciamos un drag si el touch cae dentro (o cerca) del
        // frame. Tocando lejos no hacemos nada.
        if (
          locationX < x0 ||
          locationX > x1 ||
          locationY < y0 ||
          locationY > y1
        ) {
          return;
        }
        const handle = getHandle(locationX, locationY, current);
        // Con aspect ratio bloqueado forzamos 'move': los handles de
        // resize (esquinas/lados) no están renderizados y aunque el
        // touch caiga cerca del borde lo tratamos como drag.
        activeHandleRef.current =
          aspectRef.current === 'free' ? handle : 'move';
        startFrameRef.current = { ...current };
        startTouchRef.current = { x: locationX, y: locationY };
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!startTouchRef.current) return;
        const newFrame = updateFrame(
          activeHandleRef.current!,
          gestureState.dx,
          gestureState.dy,
        );
        setFrame(newFrame);
      },
      onPanResponderRelease: () => {
        activeHandleRef.current = null;
        startFrameRef.current = null;
        startTouchRef.current = null;
      },
    }),
  ).current;

  const reset = useCallback(() => {
    setRotation(0);
    setFlippedH(false);
    setFlippedV(false);
    // Default: aspect 1:1 (cuadrado centrado). El usuario puede
    // cambiar a 'libre' u otro desde los chips.
    setAspect('1:1');
    setFrame(frameForAspect(ASPECT_RATIOS['1:1'], 1));
  }, []);

  /**
   * Cambia la relación de aspecto del frame y re-centra el rectángulo de
   * recorte. Si el aspect es 'free', el frame ocupa todo el canvas.
   * En caso contrario, devuelve el rectángulo más grande con esa
   * proporción que cabe dentro del canvas (centrado).
   */
  const changeAspect = useCallback(
    (next: AspectRatio) => {
      setAspect(next);
      setFrame(frameForAspect(ASPECT_RATIOS[next], imageAspect));
    },
    [imageAspect],
  );

  /**
   * Calcula el frame de recorte para un aspect ratio dado, normalizado al
   * canvas. El frame resultante es el rectángulo más grande con
   * `targetRatio` (w/h) que cabe dentro del canvas, centrado.
   *
   * Coords en 0..1 (x, y, w, h) relativas al canvas.
   */
  function frameForAspect(targetRatio: number, imageAR: number): Frame {
    if (!targetRatio || targetRatio <= 0 || !imageAR || imageAR <= 0) {
      // 'free' o imageAspect aún desconocido: ocupar todo el canvas
      return { x: 0, y: 0, w: 1, h: 1 };
    }
    // imageAR = canvasW / canvasH (lo que renderiza computeCanvasSize)
    if (imageAR > targetRatio) {
      // Canvas más ancho que el target → la altura es el cuello de botella
      const w = targetRatio / imageAR;
      return { x: (1 - w) / 2, y: 0, w, h: 1 };
    } else {
      // Canvas más angosto que el target → el ancho es el cuello de botella
      const h = imageAR / targetRatio;
      return { x: 0, y: (1 - h) / 2, w: 1, h };
    }
  }

  /**
   * Calcula el tamaño del canvas respetando el aspect ratio de la imagen y
   * los límites de pantalla. En mobile (pantalla vertical) el cuello de
   * botella suele ser el alto: una imagen 9:16 no debe forzar 1200px de
   * altura. Se inspira en el web `max-w-full max-h-[60vh]`.
   */
  function computeCanvasSize(aspect: number): { w: number; h: number } {
    // El modal tiene un cardWrapper con maxWidth 720 y padding externo
    // (spacing[4] cada lado). El canvasWrapper ya no tiene padding
    // interno, así que el ancho disponible es screenW - padding del card
    // y se aprovecha al máximo.
    const horizontalPadding = 32; // spacing[4] * 2 a cada lado
    const cardInnerPadding = spacing[4] * 2; // padding del body
    const maxW = Math.max(160, screenW - horizontalPadding - cardInnerPadding);
    // Cap de altura: 60% de la pantalla o 320px en mobile chico.
    const maxH = Math.max(160, Math.min(screenH * 0.45, 320));

    if (!aspect || aspect <= 0) {
      // Fallback cuadrado mientras se mide la imagen
      const s = Math.min(maxW, maxH);
      return { w: s, h: s };
    }

    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  // Resetear estado al cambiar la imagen
  useEffect(() => {
    reset();
    setImageDims({ w: 0, h: 0 });
    // Detectar dimensiones de la imagen al cambiar
    if (imageUri) {
      Image.getSize(
        imageUri,
        (w, h) => {
          setImageAspect(w / h);
          setImageDims({ w, h });
        },
        (err) => {
          console.warn('No se pudo leer la imagen', err);
        },
      );
    }
  }, [imageUri, reset]);

  // Re-centra el frame cada vez que cambia el chip de aspect o se
  // conoce el aspect real de la imagen. Lee los valores frescos
  // directamente del closure actual (no del closure del callback de
  // Image.getSize, que puede ser stale).
  useEffect(() => {
    setFrame(frameForAspect(ASPECT_RATIOS[aspect], imageAspect));
    // changeAspect ya hace su propio setFrame, así que sólo
    // necesitamos reaccionar a cambios de imageAspect o del chip
    // cuando vienen de fuera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, imageAspect]);

  /**
   * Aplica el recorte + rotación/flip sobre la imagen real usando
   * `expo-image-manipulator`. Devuelve un data URL (`data:image/jpeg;base64,…`)
   * con sólo el contenido del frame, para que el backend no reciba
   * zonas vacías o la imagen sin recortar.
   *
   * Si el manipulador falla (memoria, formato no soportado, etc.) hacemos
   * fallback al uri original para no bloquear al usuario.
   */
  async function apply() {
    if (!imageUri) return;
    const hasTransform = rotation !== 0 || flippedH || flippedV;
    const hasCrop = !(frame.x === 0 && frame.y === 0 && frame.w === 1 && frame.h === 1);
    if (!hasTransform && !hasCrop) {
      // Nada que aplicar, devolver la imagen tal cual.
      onApply({
        uri: imageUri,
        rotation,
        flippedH,
        flippedV,
        aspectRatio: ASPECT_RATIOS[aspect],
      });
      return;
    }
    if (imageDims.w === 0 || imageDims.h === 0) {
      // No pudimos leer las dimensiones: fallback defensivo.
      onApply({
        uri: imageUri,
        rotation,
        flippedH,
        flippedV,
        aspectRatio: ASPECT_RATIOS[aspect],
      });
      return;
    }
    try {
      setProcessing(true);
      // La rotación 90/270 intercambia ancho/alto de la imagen rendered.
      const swapAxes = rotation === 90 || rotation === 270;
      const renderedW = swapAxes ? imageDims.h : imageDims.w;
      const renderedH = swapAxes ? imageDims.w : imageDims.h;
      const crop = {
        originX: Math.round(frame.x * renderedW),
        originY: Math.round(frame.y * renderedH),
        width: Math.max(1, Math.round(frame.w * renderedW)),
        height: Math.max(1, Math.round(frame.h * renderedH)),
      };

      const manipulator = ImageManipulator.ImageManipulator.manipulate(imageUri);
      // Forzamos la imagen a su resolución natural ANTES del crop.
      // `expo-image-manipulator` puede cargar la imagen a una
      // resolución menor (p.ej. para ahorrar memoria) y si las coords
      // del crop vienen de `imageDims` (resolución natural) el recorte
      // queda "zoomed in" porque se aplica sobre la versión reducida.
      // `resize` a la dimensión natural hace que el crop opere sobre la
      // imagen a tamaño completo.
      manipulator.resize({ width: renderedW, height: renderedH });
      // Encadenamos: rotar, voltear, recortar.
      // El orden importa: el crop opera sobre el sistema de coords de la
      // imagen rendered (post-rotación).
      if (rotation !== 0) manipulator.rotate(rotation);
      if (flippedV) manipulator.flip('vertical');
      if (flippedH) manipulator.flip('horizontal');
      manipulator.crop(crop);

      const rendered = await manipulator.renderAsync();
      const saved = await rendered.saveAsync({
        format: ImageManipulator.SaveFormat.JPEG,
        compress: 0.85,
        base64: true,
      });
      const dataUri = saved.base64
        ? `data:image/jpeg;base64,${saved.base64}`
        : saved.uri;
      onApply({
        uri: dataUri,
        rotation,
        flippedH,
        flippedV,
        aspectRatio: ASPECT_RATIOS[aspect],
      });
    } catch (err) {
      console.warn('No se pudo recortar la imagen, usando original', err);
      onApply({
        uri: imageUri,
        rotation,
        flippedH,
        flippedV,
        aspectRatio: ASPECT_RATIOS[aspect],
      });
    } finally {
      setProcessing(false);
    }
  }

  // Frame coords -> pixel position
  function getFramePixel() {
    const c = containerSizeRef.current;
    return {
      left: frame.x * c.w,
      top: frame.y * c.h,
      width: frame.w * c.w,
      height: frame.h * c.h,
    };
  }

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  Ajustar y recortar
                </Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  Edita la foto seleccionada
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { backgroundColor: 'rgba(148, 163, 184, 0.2)' },
                ]}
                accessibilityLabel="Cerrar modal"
              >
                <Icon name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
            >
              {/* Toolbar Transformar */}
              <View style={styles.toolbar}>
                <Text style={styles.toolbarLabel}>Transformar:</Text>
                <View style={styles.toolbarButtons}>
                  <Pressable
                    onPress={() => setRotation((r) => (r - 90) % 360)}
                    style={styles.toolbarBtn}
                    accessibilityLabel="Rotar izquierda"
                  >
                    <Icon name="rotate-ccw" size={14} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setRotation((r) => (r + 90) % 360)}
                    style={styles.toolbarBtn}
                    accessibilityLabel="Rotar derecha"
                  >
                    <Icon name="rotate-cw" size={14} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setFlippedH((v) => !v)}
                    style={styles.toolbarBtn}
                    accessibilityLabel="Voltear horizontal"
                  >
                    <Icon name="flip-horizontal" size={14} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setFlippedV((v) => !v)}
                    style={styles.toolbarBtn}
                    accessibilityLabel="Voltear vertical"
                  >
                    <Icon name="flip-vertical" size={14} color={colors.primary} />
                  </Pressable>
                </View>
              </View>

              {/* Aspect ratio */}
              <View style={styles.toolbar}>
                <Text style={styles.toolbarLabel}>Relación de aspecto:</Text>
                <View style={styles.aspectRow}>
                  {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map((key) => {
                    const label = key === 'free' ? 'Libre' : key;
                    const isActive = aspect === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => changeAspect(key)}
                        style={[
                          styles.aspectChip,
                          isActive && styles.aspectChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.aspectChipText,
                            isActive && styles.aspectChipTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Canvas con imagen + frame de crop interactivo. El tamaño se
                  calcula respetando el aspect ratio de la imagen y los
                  límites de pantalla (max-w-full + max-h equivalente a
                  `max-h-[60vh]` del web). El padding visual vive en el
                  wrapper (canvasWrapper) para que la imagen llene el
                  canvas completo y el frame de crop quede centrado sobre
                  la imagen (no sobre el área con padding). */}
              {(() => {
                const { w: canvasW, h: canvasH } = computeCanvasSize(imageAspect);
                return (
                  <View style={styles.canvasWrapper}>
                    <View
                      style={[styles.canvasContainer, { width: canvasW, height: canvasH }]}
                      onLayout={(e) => {
                        containerSizeRef.current = {
                          w: e.nativeEvent.layout.width,
                          h: e.nativeEvent.layout.height,
                        };
                      }}
                      {...panResponder.panHandlers}
                    >
                      <Image
                        source={{ uri: imageUri || '' }}
                        style={[
                          styles.canvasImage,
                          {
                            width: canvasW,
                            height: canvasH,
                            transform: [
                              { rotate: `${rotation}deg` },
                              { scaleX: flippedH ? -1 : 1 },
                              { scaleY: flippedV ? -1 : 1 },
                            ],
                          },
                        ]}
                        resizeMode="contain"
                      />
                      {/* Frame de crop. El border cambia de color para
                          indicar visualmente si está bloqueado o libre. */}
                      <FrameView
                        frame={getFramePixel()}
                        locked={frameLocked}
                      />
                      {/* Edges y esquinas sólo cuando el frame es libre */}
                      {!frameLocked && (
                        <>
                          <FrameEdge frame={getFramePixel()} side="t" />
                          <FrameEdge frame={getFramePixel()} side="b" />
                          <FrameEdge frame={getFramePixel()} side="l" />
                          <FrameEdge frame={getFramePixel()} side="r" />
                          <FrameCorner frame={getFramePixel()} corner="tl" />
                          <FrameCorner frame={getFramePixel()} corner="tr" />
                          <FrameCorner frame={getFramePixel()} corner="bl" />
                          <FrameCorner frame={getFramePixel()} corner="br" />
                        </>
                      )}
                      {/* Grid thirds (siempre visible) */}
                      <View style={[styles.cropGridLineH, { top: getFramePixel().top + getFramePixel().height / 3 }]} />
                      <View style={[styles.cropGridLineH, { top: getFramePixel().top + (getFramePixel().height * 2) / 3 }]} />
                      <View style={[styles.cropGridLineV, { left: getFramePixel().left + getFramePixel().width / 3 }]} />
                      <View style={[styles.cropGridLineV, { left: getFramePixel().left + (getFramePixel().width * 2) / 3 }]} />
                    </View>
                  </View>
                );
              })()}

              {frameLocked && (
                <Text style={styles.lockedHint}>
                  Tamaño del recorte bloqueado por la relación de aspecto ({aspect})
                </Text>
              )}

              <Text style={styles.helperText}>
                Imagen 1 de 1 · Arrastra el marco para reposicionarlo y los puntos para redimensionarlo
              </Text>
            </ScrollView>

            {/* Footer (3 botones mirror web) */}
            <View style={styles.footer}>
              <View style={styles.footerActions}>
                <Button
                  title="Restablecer"
                  variant="outline"
                  onPress={reset}
                  leftIcon={<Icon name="rotate-ccw" size={16} color={colors.primary} />}
                  disabled={!imageUri}
                />
                <Button
                  title="Cancelar"
                  variant="outline"
                  onPress={onClose}
                  leftIcon={<Icon name="x" size={16} color={colors.primary} />}
                  disabled={!imageUri}
                />
                <Button
                  title="Guardar ajuste"
                  variant="primary"
                  onPress={apply}
                  loading={processing || !imageUri}
                  leftIcon={<Icon name="check" size={16} color={colors.background} />}
                  disabled={!imageUri || processing}
                />
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

/**
 * View del frame completo (área interior con border).
 * Soporta drag (mover). Cuando `locked` es true el border cambia de
 * color para señalar que el tamaño está bloqueado por el aspect ratio.
 */
function FrameView({
  frame,
  locked = false,
}: {
  frame: { left: number; top: number; width: number; height: number };
  onMove?: (e: any) => void;
  locked?: boolean;
}) {
  return (
    <View
      style={[
        {
          position: 'absolute',
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          borderWidth: 2,
          borderColor: locked ? colors.primary : colors.background,
          borderStyle: locked ? 'dashed' : 'solid',
        },
      ]}
      pointerEvents="none"
    />
  );
}

function FrameEdge({ frame, side }: { frame: any; side: 't' | 'b' | 'l' | 'r' }) {
  const edgeThickness = 14;
  const edgeStyle =
    side === 't' || side === 'b'
      ? {
          left: frame.left,
          top: side === 't' ? frame.top - edgeThickness / 2 : frame.top + frame.height - edgeThickness / 2,
          width: frame.width,
          height: edgeThickness,
        }
      : {
          top: frame.top,
          left: side === 'l' ? frame.left - edgeThickness / 2 : frame.left + frame.width - edgeThickness / 2,
          width: edgeThickness,
          height: frame.height,
        };
  // Línea blanca semitransparente para que el usuario VEA dónde puede
  // arrastrar. Antes era `transparent` y por eso era imposible de
  // encontrar visualmente.
  return <View pointerEvents="none" style={[edgeStyle, { backgroundColor: 'rgba(255,255,255,0.35)' }]} />;
}

function FrameCorner({ frame, corner }: { frame: any; corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  // Handles más grandes (20x20) y con mejor contraste para que sean
  // fáciles de agarrar con el dedo.
  const size = 20;
  const offset = size / 2;
  const cornerStyle = {
    top: corner === 'tl' || corner === 'tr' ? frame.top - offset : frame.top + frame.height - offset,
    left: corner === 'tl' || corner === 'bl' ? frame.left - offset : frame.left + frame.width - offset,
  };
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          backgroundColor: colors.background,
          borderWidth: 2,
          borderColor: colors.primary,
          borderRadius: 4,
          // Sombra suave para que destaque sobre la imagen.
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.3,
          shadowRadius: 2,
          elevation: 3,
        },
        cornerStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    // El card actúa como flex container para que el ScrollView del body
    // pueda hacer scroll y el footer quede fijo abajo (mirror web).
    maxHeight: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerTitleWrap: {
    flex: 1,
    marginRight: spacing[2],
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  headerSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyScroll: {
    // El ScrollView se encoje para caber en el espacio disponible entre
    // el header y el footer, que quedan fijos. Sin `flexShrink: 1` el
    // contenido se expande y empuja el footer fuera de pantalla.
    flexGrow: 1,
    flexShrink: 1,
  },
  body: {
    padding: spacing[4],
    gap: spacing[4],
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
  },
  toolbarLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
    marginRight: spacing[1],
  },
  toolbarButtons: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  toolbarBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aspectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  aspectChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  aspectChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  aspectChipText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  aspectChipTextActive: {
    color: colors.background,
  },
  canvasWrapper: {
    // Sin padding ni fondo extra: la imagen llena todo el área
    // disponible. El frame de crop queda exactamente sobre la imagen,
    // sin "espacios adicionales" alrededor.
    alignSelf: 'center',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  canvasContainer: {
    alignSelf: 'center',
    backgroundColor: '#000',
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasImage: {
    // width/height se setean dinámicamente según aspect ratio de la imagen
  },
  lockedHint: {
    fontSize: typography.fontSize.xs,
    color: colors.primary,
    textAlign: 'center',
    fontWeight: typography.fontWeight.medium,
  },
  cropGridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  cropGridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  helperText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  footerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing[2],
  },
});
