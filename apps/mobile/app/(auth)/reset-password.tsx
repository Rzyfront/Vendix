import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { AuthService } from '@/core/auth/auth.service';
import { colors } from '@/shared/theme';
import { Input } from '@/shared/components/input/input';
import { Icon } from '@/shared/components/icon/icon';

const styles = {
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center' as const, paddingHorizontal: 32, paddingVertical: 48 },
  logoContainer: { alignItems: 'center' as const, marginBottom: 32 },
  iconContainer: { width: 64, height: 64, backgroundColor: colors.primaryLight, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 12, borderWidth: 2, borderColor: colors.primary },
  brandText: { fontSize: 20, fontWeight: '600' as const, color: colors.text.primary },
  titleContainer: { alignItems: 'center' as const, marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text.primary },
  subtitle: { fontSize: 14, color: colors.text.secondary, marginTop: 4, textAlign: 'center' as const },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 24, gap: 20 },
  errorBox: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 8, padding: 12 },
  errorText: { fontSize: 14, color: colors.error, textAlign: 'center' as const },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' as const, justifyContent: 'center' as const },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 14, fontWeight: '600' as const, color: '#FFFFFF' },
  linkContainer: { alignItems: 'center' as const, marginTop: 16 },
  linkText: { fontSize: 14, fontWeight: '500' as const, color: colors.primary },
  successContainer: { alignItems: 'center' as const },
  successIcon: { width: 64, height: 64, backgroundColor: colors.primaryLight, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 16, borderWidth: 2, borderColor: colors.primary },
  successTitle: { fontSize: 26, fontWeight: '700' as const, color: colors.text.primary, marginBottom: 8 },
  successSubtitle: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' as const, marginBottom: 32 },
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setIsLoading(true);
    try {
      await AuthService.resetPassword({ newPassword, token: '' });
      setSuccess(true);
    } catch (err: unknown) {
      const message =
        (err as any)?.response?.data?.message ||
        (err as any)?.message ||
        'Error al restablecer la contraseña. Intenta de nuevo.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <Icon name="check" size={32} color={colors.primary} />
            </View>
            <Text style={styles.successTitle}>Contraseña Actualizada</Text>
            <Text style={styles.successSubtitle}>
              Tu contraseña ha sido restablecida exitosamente.
            </Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>Iniciar Sesión</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Icon */}
        <View style={styles.logoContainer}>
          <View style={styles.iconContainer}>
            <Icon name="lock" size={28} color={colors.primary} />
          </View>
          <Text style={styles.brandText}>Vendix</Text>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Restablecer Contraseña</Text>
          <Text style={styles.subtitle}>Ingresa tu nueva contraseña.</Text>
        </View>

        {/* Form Card */}
        <View style={styles.card}>
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Input
            label="NUEVA CONTRASEÑA"
            placeholder="••••••••"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showNewPassword}
            helperText="Mín. 8 caracteres, 1 mayúscula, 1 número y 1 especial"
            editable={!isLoading}
            rightIcon={
              <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
                <Icon name={showNewPassword ? 'eye-off' : 'eye'} size={20} color={colors.text.muted} />
              </TouchableOpacity>
            }
          />

          <Input
            label="CONFIRMAR NUEVA CONTRASEÑA"
            placeholder="••••••••"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
            editable={!isLoading}
            rightIcon={
              <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                <Icon name={showConfirmPassword ? 'eye-off' : 'eye'} size={20} color={colors.text.muted} />
              </TouchableOpacity>
            }
          />

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Restablecer Contraseña</Text>
            )}
          </TouchableOpacity>

          <View style={styles.linkContainer}>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={styles.linkText}>← Volver a Iniciar Sesión</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}