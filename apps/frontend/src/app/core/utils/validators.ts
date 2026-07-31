import { passwordPolicyValidator } from './password-policy';

/**
 * @deprecated Usar `passwordPolicyValidator` de `core/utils/password-policy`.
 *
 * Esta versión exigía mayúscula y símbolo pero NO minúscula ni número, así que
 * aceptaba contraseñas que otros formularios rechazaban. Se conserva como alias
 * para no romper imports antiguos; la política real es una sola.
 */
export const passwordValidator = passwordPolicyValidator;
