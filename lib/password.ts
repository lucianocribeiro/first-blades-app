// Validación de contraseña compartida por alta y reseteo (FB-F5-08) —
// única fuente de verdad para no duplicar la regla entre gestion-usuarios/
// actions.ts (createUser) y la nueva resetPassword. Se corre del lado del
// server: el feedback en el form es UX, no la autoridad.
import { copy } from '@/lib/copy';

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: copy.gestionUsuarios.password.tooShort };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: copy.gestionUsuarios.password.missingNumber };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: copy.gestionUsuarios.password.missingUppercase };
  }
  return { valid: true };
}
