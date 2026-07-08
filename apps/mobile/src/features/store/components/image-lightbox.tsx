import { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  borderRadius,
  colors,
  colorScales,
  spacing,
  typography,
} from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface ImageLightboxProps {
  source: { uri: string } | null;
  onClose: () => void;
  alt?: string;
}

/**
 * ImageLightbox — modal full-screen para previsualizar una imagen
 * (producto, marca, categoría) con un overlay oscuro y tap-to-close.
 *
 * Mirror del web `ImageLightboxComponent`: backdrop rgba(15,23,42,0.45)
 * + imagen centrada `maxWidth: 480` (mobile: pantalla completa con
 * padding interno).
 */
export function ImageLightbox({ source, onClose, alt }: ImageLightboxProps) {
  return (
    <Modal
      visible={!!source}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={styles.backdrop}
        accessibilityLabel="Cerrar vista previa"
      >
        <View style={styles.container}>
          {source ? (
            <Image
              source={source}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={alt ?? 'Imagen'}
            />
          ) : null}
          <View style={styles.headerActions}>
            <View style={styles.headerChip}>
              <Icon name="image" size={14} color={colors.background} />
              {alt ? (
                <Text style={styles.headerChipText} numberOfLines={1}>
                  {alt}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.closeBtn}
              accessibilityLabel="Cerrar"
            >
              <Icon name="x" size={20} color={colors.background} />
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

interface LightboxImageTapProps {
  uri?: string | null;
  alt?: string;
  size?: number;
  borderRadius?: number;
  /**
   * Estilo adicional para el wrapper del thumbnail (cuando la imagen
   * existe y quiere un borde, padding, etc.).
   */
  style?: any;
}

/**
 * LightboxImageTap — wrapper que muestra un thumbnail y abre el
 * ImageLightbox al hacer tap. Si la imagen no existe muestra un
 * placeholder con icono. Usar en products/brands/categories list.
 */
export function LightboxImageTap({
  uri,
  alt,
  size = 80,
  borderRadius: radius = 12,
  style,
}: LightboxImageTapProps) {
  const [open, setOpen] = useState(false);
  const hasImage = !!uri;

  return (
    <>
      <Pressable
        onPress={() => hasImage && setOpen(true)}
        disabled={!hasImage}
        hitSlop={4}
        style={[
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: colorScales.gray[100],
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          },
          style,
        ]}
        accessibilityLabel={hasImage ? `Ver ${alt ?? 'imagen'}` : undefined}
      >
        {hasImage ? (
          <Image source={{ uri: uri! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Icon name="image" size={size * 0.4} color={colors.text.muted} />
        )}
      </Pressable>
      {hasImage ? (
        <ImageLightbox
          source={{ uri: uri! }}
          alt={alt}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  container: {
    flex: 1,
    padding: spacing[4],
    paddingTop: spacing[10],
    paddingBottom: spacing[6],
  },
  image: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  headerActions: {
    position: 'absolute',
    top: spacing[4],
    left: spacing[4],
    right: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: borderRadius.lg,
    maxWidth: '70%',
  },
  headerChipText: {
    fontSize: typography.fontSize.xs,
    color: colors.background,
    fontWeight: '600',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
