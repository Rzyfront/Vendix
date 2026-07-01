import { useState } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

export interface UploadedImage {
  uri: string;
  fileName?: string;
  width?: number;
  height?: number;
  type?: 'gallery' | 'camera' | 'url';
}

interface ImageSourceModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Callback al confirmar la imagen. En web la subida es async al backend;
   * en mobile, por ahora guardamos la uri local y la enviamos como
   * `image_urls` (string[]) en el buildDto (el backend las descarga).
   */
  onConfirm: (image: UploadedImage) => void;
  /** Cuántas imágenes más se pueden subir (default 5 - máx web). */
  remainingSlots?: number;
}

const CARD_MAX_WIDTH = 480;

/**
 * Modal de selección de fuente de imagen. Mirror del web:
 * Subir | Desde URL | Tomar foto | Buscar en la web (placeholder) | Generar con IA (placeholder)
 *
 * Sólo las 3 primeras opciones son funcionales en mobile. Las 2 últimas son
 * placeholders disabled (el web las muestra como "Aún no disponible").
 */
export function ImageSourceModal({ visible, onClose, onConfirm, remainingSlots = 5 }: ImageSourceModalProps) {
  const [view, setView] = useState<'menu' | 'url'>('menu');
  const [urlValue, setUrlValue] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setView('menu');
    setUrlValue('');
    setBusy(false);
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  async function pickFromGallery() {
    try {
      setBusy(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toastError('Necesitamos permiso para acceder a tu galería');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      onConfirm({
        uri: asset.uri,
        fileName: asset.fileName ?? undefined,
        width: asset.width,
        height: asset.height,
        type: 'gallery',
      });
      handleClose();
    } catch (error) {
      toastError('No se pudo abrir la galería');
    } finally {
      setBusy(false);
    }
  }

  async function pickFromCamera() {
    try {
      setBusy(true);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        toastError('Necesitamos permiso para acceder a la cámara');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.85,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      onConfirm({
        uri: asset.uri,
        fileName: asset.fileName ?? undefined,
        width: asset.width,
        height: asset.height,
        type: 'camera',
      });
      handleClose();
    } catch (error) {
      toastError('No se pudo abrir la cámara');
    } finally {
      setBusy(false);
    }
  }

  function handleUrlConfirm() {
    const trimmed = urlValue.trim();
    if (!trimmed) {
      toastError('Ingresa una URL válida');
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      toastError('La URL debe empezar con http:// o https://');
      return;
    }
    onConfirm({ uri: trimmed, type: 'url' });
    handleClose();
  }

  if (!visible) return null;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {view === 'menu' ? 'Agregar imágenes' : 'Pegar URL'}
                </Text>
                {view === 'menu' && (
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    Elige una fuente
                  </Text>
                )}
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { backgroundColor: colorScales.gray[100] },
                ]}
                accessibilityLabel="Cerrar modal"
              >
                <Icon name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            {/* Body */}
            {view === 'menu' ? (
              <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.bodyHint}>
                  Quedan {remainingSlots} espacio{remainingSlots === 1 ? '' : 's'} disponible{remainingSlots === 1 ? '' : 's'}. Elige cómo quieres agregar imágenes:
                </Text>

                <View style={styles.grid}>
                  {/* Subir — gallery */}
                  <OptionButton
                    icon="upload-cloud"
                    title="Subir"
                    subtitle="Selecciona archivos desde tu equipo"
                    onPress={pickFromGallery}
                    disabled={busy}
                  />
                  {/* Desde URL */}
                  <OptionButton
                    icon="link"
                    title="Desde URL"
                    subtitle="Descarga una imagen pública y edítala"
                    onPress={() => setView('url')}
                    disabled={busy}
                  />
                  {/* Tomar foto — camera */}
                  <OptionButton
                    icon="camera"
                    title="Tomar foto"
                    subtitle="Usa la cámara del dispositivo"
                    onPress={pickFromCamera}
                    disabled={busy}
                  />
                  {/* Buscar en la web — placeholder */}
                  <OptionButton
                    icon="search"
                    title="Buscar en la web"
                    subtitle="Aún no disponible"
                    onPress={() => toastSuccess('Próximamente')}
                    disabled
                    style={styles.placeholderOption}
                  />
                  {/* Generar con IA — placeholder, full width */}
                  <OptionButton
                    icon="sparkles"
                    title="Generar con IA"
                    subtitle="Aún no disponible"
                    onPress={() => toastSuccess('Próximamente')}
                    disabled
                    style={[styles.placeholderOption, styles.fullWidthOption]}
                  />
                </View>
              </ScrollView>
            ) : (
              <View style={styles.urlView}>
                <Text style={styles.urlLabel}>URL de la imagen</Text>
                <TextInput
                  style={styles.urlInput}
                  value={urlValue}
                  onChangeText={setUrlValue}
                  placeholder="https://ejemplo.com/imagen.jpg"
                  placeholderTextColor={colors.text.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={!busy}
                />
                <View style={styles.urlActions}>
                  <Button
                    title="Volver"
                    variant="outline"
                    onPress={() => {
                      setView('menu');
                      setUrlValue('');
                    }}
                    fullWidth
                    disabled={busy}
                  />
                  <Button
                    title={busy ? 'Descargando…' : 'Confirmar'}
                    variant="primary"
                    onPress={handleUrlConfirm}
                    fullWidth
                    loading={busy}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

interface OptionButtonProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
  style?: any;
}

function OptionButton({ icon, title, subtitle, onPress, disabled, style }: OptionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.option,
        disabled && styles.optionDisabled,
        style,
        pressed && !disabled && { backgroundColor: colorScales.green[50] },
      ]}
    >
      <View style={styles.optionIcon}>
        <Icon name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.optionText}>
        <Text style={[styles.optionTitle, disabled && { color: colorScales.gray[700] }]}>{title}</Text>
        <Text style={styles.optionSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
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
    maxWidth: CARD_MAX_WIDTH,
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
  body: {
    padding: spacing[4],
    gap: spacing[3],
  },
  bodyHint: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  option: {
    flex: 1,
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.card,
  },
  fullWidthOption: {
    minWidth: '100%',
  },
  optionDisabled: {
    backgroundColor: colorScales.gray[50],
    opacity: 0.7,
  },
  placeholderOption: {
    backgroundColor: colorScales.gray[50],
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.green[50],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  optionSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
  urlView: {
    padding: spacing[4],
    gap: spacing[3],
  },
  urlLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[700],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  urlInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
    backgroundColor: colors.background,
  },
  urlActions: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[2],
  },
});
