-- Verificar el estado de verificación de email del usuario con ID 12
SELECT id, email, email_verified, state, onboarding_completed 
FROM users 
WHERE id = 12;