import { useState, useRef } from 'react';
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
  ActivityIndicator,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
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
  const [aspect, setAspect] = useState<AspectRatio>('free');
  const [frame, setFrame] = useState<Frame>({ x: 0, y: 0, w: 1, h: 1 });

  // Refs para el PanResponder (no trigger re-render)
  const containerSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const frameRef = useRef<Frame>({ x: 0, y: 0, w: 1, h: 1 });
  const activeHandleRef = useRef<Handle>(null);
  const startFrameRef = useRef<Frame | null>(null);
  const startTouchRef = useRef<{ x: number; y: number } | null>(null);

  // Actualizar el ref cuando el state cambia
  frameRef.current = frame;

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
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const handle = getHandle(locationX, locationY, frameRef.current);
        activeHandleRef.current = handle;
        startFrameRef.current = { ...frameRef.current };
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

  function reset() {
    setRotation(0);
    setFlippedH(false);
    setFlippedV(false);
    setAspect('free');
    setFrame({ x: 0, y: 0, w: 1, h: 1 });
  }

  function apply() {
    if (!imageUri) return;
    onApply({
      uri: imageUri,
      rotation,
      flippedH,
      flippedV,
      aspectRatio: ASPECT_RATIOS[aspect],
    });
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
                        onPress={() => setAspect(key)}
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

              {/* Canvas con imagen + frame de crop interactivo */}
              <View
                style={styles.canvasContainer}
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
                      transform: [
                        { rotate: `${rotation}deg` },
                        { scaleX: flippedH ? -1 : 1 },
                        { scaleY: flippedV ? -1 : 1 },
                      ],
                    },
                  ]}
                  resizeMode="contain"
                />
                {/* Frame de crop interactivo con drag y resize */}
                <FrameView
                  frame={getFramePixel()}
                  onMove={(e) => {
                    e.stopPropagation?.();
                    const next = updateFrame('move', e.nativeEvent.pageX - (startTouchRef.current?.x ?? 0), e.nativeEvent.pageY - (startTouchRef.current?.y ?? 0));
                    setFrame(next);
                  }}
                />
                {/* Edges del frame */}
                <FrameEdge frame={getFramePixel()} side="t" />
                <FrameEdge frame={getFramePixel()} side="b" />
                <FrameEdge frame={getFramePixel()} side="l" />
                <FrameEdge frame={getFramePixel()} side="r" />
                {/* Corners del frame */}
                <FrameCorner frame={getFramePixel()} corner="tl" />
                <FrameCorner frame={getFramePixel()} corner="tr" />
                <FrameCorner frame={getFramePixel()} corner="bl" />
                <FrameCorner frame={getFramePixel()} corner="br" />
                {/* Grid thirds */}
                <View style={[styles.cropGridLineH, { top: getFramePixel().top + getFramePixel().height / 3 }]} />
                <View style={[styles.cropGridLineH, { top: getFramePixel().top + (getFramePixel().height * 2) / 3 }]} />
                <View style={[styles.cropGridLineV, { left: getFramePixel().left + getFramePixel().width / 3 }]} />
                <View style={[styles.cropGridLineV, { left: getFramePixel().left + (getFramePixel().width * 2) / 3 }]} />
              </View>

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
                  loading={!imageUri}
                  leftIcon={<Icon name="check" size={16} color={colors.background} />}
                  disabled={!imageUri}
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
 * Soporta drag (mover).
 */
function FrameView({ frame, onMove }: { frame: { left: number; top: number; width: number; height: number }; onMove: (e: any) => void }) {
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
          borderColor: colors.background,
        },
      ]}
      onStartShouldSetResponder={() => true}
      onResponderRelease={onMove}
    />
  );
}

function FrameEdge({ frame, side }: { frame: any; side: 't' | 'b' | 'l' | 'r' }) {
  const edgeStyle =
    side === 't' || side === 'b'
      ? { left: frame.left, top: side === 't' ? frame.top - 5 : frame.top + frame.height - 5, width: frame.width, height: 10 }
      : { top: frame.top, left: side === 'l' ? frame.left - 5 : frame.left + frame.width - 5, width: 10, height: frame.height };
  return <View pointerEvents="none" style={[edgeStyle, { backgroundColor: 'transparent' }]} />;
}

function FrameCorner({ frame, corner }: { frame: any; corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const cornerStyle = {
    top: corner === 'tl' || corner === 'tr' ? frame.top - 6 : frame.top + frame.height - 6,
    left: corner === 'tl' || corner === 'bl' ? frame.left - 6 : frame.left + frame.width - 6,
  };
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: 12,
          height: 12,
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colorScales.gray[700],
          borderRadius: 2,
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
    flexGrow: 1,
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
  canvasContainer: {
    width: '100%',
    minHeight: 280,
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[3],
  },
  canvasImage: {
    width: '100%',
    height: '100%',
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
