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
import { isValidEmail } from '@/core/utils/validators';
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

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [vlink, setVlink] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!isValidEmail(email)) {
      setError('Por favor ingresa un correo electrónico válido');
      return;
    }
    setIsLoading(true);
    try {
      await AuthService.forgotPassword({ email });
      setSuccess(true);
    } catch (err: unknown) {
      const message =
        (err as any)?.response?.data?.message ||
        (err as any)?.message ||
        'Error al enviar el correo. Intenta de nuevo.';
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
            <Text style={styles.successTitle}>Correo Enviado</Text>
            <Text style={styles.successSubtitle}>
              Hemos enviado las instrucciones de recuperación a tu correo electrónico.
            </Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.button}
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>Volver a Iniciar Sesión</Text>
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
            <Icon name="key-round" size={28} color={colors.primary} />
          </View>
          <Text style={styles.brandText}>Vendix</Text>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Recuperar Contraseña</Text>
          <Text style={styles.subtitle}>
            Ingresa tu Vlink y email para recibir instrucciones.
          </Text>
        </View>

        {/* Form Card */}
        <View style={styles.card}>
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Input
            label="V-LINK"
            placeholder="mi-organizacion"
            value={vlink}
            onChangeText={setVlink}
            editable={!isLoading}
          />

          <Input
            label="EMAIL DE PROPIETARIO"
            placeholder="propietario@empresa.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
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
              <Text style={styles.buttonText}>Enviar Instrucciones</Text>
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