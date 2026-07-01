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

/**
 * Modal de edición de imagen (espejo del web "Recortar imagen").
 *
 * Funcionalidades:
 * - Rotar izquierda/derecha (90° por click)
 * - Voltear horizontal / vertical (mirror)
 * - Selector de relación de aspecto (Libre, 1:1, 4:3, 3:2, 16:9, 4:5, 9:16)
 * - Frame de crop con drag (básico, no handles de resize en esta versión)
 * - Footer: Restablecer / Omitir / Cancelar / Aplicar y agregar
 *
 * Devuelve el uri original con metadatos de transformación.
 * (Una implementación real usaría `react-native-view-shot` para exportar
 * la imagen ya transformada, pero por ahora retornamos el uri + transform.)
 */
export function ImageEditModal({ visible, imageUri, onClose, onApply }: ImageEditModalProps) {
  const [rotation, setRotation] = useState(0);
  const [flippedH, setFlippedH] = useState(false);
  const [flippedV, setFlippedV] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>('free');
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 });

  // PanResponder para arrastrar el frame de crop
  const dragRef = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<View>(null);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      startRef.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
    },
    onPanResponderMove: (evt) => {
      if (!startRef.current) return;
      const dx = (evt.nativeEvent.pageX - startRef.current.x) / 300; // normalizado aprox
      const dy = (evt.nativeEvent.pageY - startRef.current.y) / 300;
      const newX = Math.max(0, Math.min(0.8, dragRef.current.x + dx));
      const newY = Math.max(0, Math.min(0.8, dragRef.current.y + dy));
      setCrop((c) => ({ ...c, x: newX, y: newY }));
    },
    onPanResponderRelease: () => {
      startRef.current = null;
    },
  });

  function reset() {
    setRotation(0);
    setFlippedH(false);
    setFlippedV(false);
    setAspect('free');
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    dragRef.current = { x: 0, y: 0, w: 1, h: 1 };
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

  function getCropFrameStyle() {
    if (aspect === 'free') {
      return { width: '90%', aspectRatio: 1 };
    }
    return { width: '90%', aspectRatio: ASPECT_RATIOS[aspect] };
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
                  Recortar imagen
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
                  >
                    <Icon name="rotate-ccw" size={14} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setRotation((r) => (r + 90) % 360)}
                    style={styles.toolbarBtn}
                  >
                    <Icon name="rotate-cw" size={14} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setFlippedH((v) => !v)}
                    style={styles.toolbarBtn}
                  >
                    <Icon name="flip-horizontal" size={14} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setFlippedV((v) => !v)}
                    style={styles.toolbarBtn}
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

              {/* Canvas con imagen + frame de crop */}
              <View style={styles.canvasContainer}>
                <View
                  ref={containerRef}
                  collapsable={false}
                  style={styles.canvasInner}
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
                  {/* Frame de crop overlay */}
                  <View
                    style={[
                      styles.cropFrame as any,
                      getCropFrameStyle(),
                      { left: `${crop.x * 100}%`, top: `${crop.y * 100}%` },
                    ]}
                    pointerEvents="none"
                  >
                    <View style={[styles.cropEdge, styles.cropEdgeTop, { top: 0 }]} />
                    <View style={[styles.cropEdge, styles.cropEdgeBottom, { bottom: 0 }]} />
                    <View style={[styles.cropEdge, styles.cropEdgeLeft, { left: 0 }]} />
                    <View style={[styles.cropEdge, styles.cropEdgeRight, { right: 0 }]} />
                    {/* Grid thirds */}
                    <View style={[styles.cropGridLine, { top: '33%' }]} />
                    <View style={[styles.cropGridLine, { top: '66%' }]} />
                    <View style={[styles.cropGridLine, { left: '33%', top: 0, bottom: 0, width: 1, height: '100%' }]} />
                    <View style={[styles.cropGridLine, { left: '66%', top: 0, bottom: 0, width: 1, height: '100%' }]} />
                    {/* Corner handles */}
                    {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y], i) => (
                      <View
                        key={i}
                        style={[
                          styles.cropHandle,
                          { left: x === 0 ? -6 : undefined, right: x === 1 ? -6 : undefined, top: y === 0 ? -6 : undefined, bottom: y === 1 ? -6 : undefined },
                        ]}
                      />
                    ))}
                  </View>
                </View>
              </View>

              <Text style={styles.helperText}>
                Imagen 1 de 1 · Arrastra el marco para reposicionarlo y los puntos para redimensionarlo
              </Text>
            </ScrollView>

            {/* Footer */}
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
                  title="Omitir"
                  variant="outline"
                  onPress={onClose}
                  leftIcon={<Icon name="skip-forward" size={16} color={colors.primary} />}
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
                  title="Aplicar y agregar"
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
  canvasInner: {
    width: '100%',
    height: '100%',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasImage: {
    width: '100%',
    height: '100%',
  },
  cropFrame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.background,
  },
  cropEdge: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  cropEdgeTop: { left: 0, right: 0, height: '33.333%' },
  cropEdgeBottom: { left: 0, right: 0, height: '33.333%' },
  cropEdgeLeft: { top: 0, bottom: 0, width: '33.333%' },
  cropEdgeRight: { top: 0, bottom: 0, width: '33.333%' },
  cropGridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    width: '100%',
    height: 1,
  },
  cropHandle: {
    position: 'absolute',
    width: 12,
    height: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[700],
    borderRadius: 2,
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
