/**
 * FB-F5-08 — validatePassword: única fuente de verdad de la regla de
 * fuerza de contraseña, compartida por el alta (createUser) y el reseteo
 * (resetPassword) de gestion-usuarios/actions.ts.
 */
import { describe, it, expect } from 'vitest';
import { validatePassword } from '@/lib/password';
import { copy } from '@/lib/copy';

describe('validatePassword', () => {
  it('rechaza menos de 8 caracteres', () => {
    const result = validatePassword('Abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toBe(copy.gestionUsuarios.password.tooShort);
  });

  it('rechaza sin número', () => {
    const result = validatePassword('Abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.error).toBe(copy.gestionUsuarios.password.missingNumber);
  });

  it('rechaza sin mayúscula', () => {
    const result = validatePassword('abcdefg1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe(copy.gestionUsuarios.password.missingUppercase);
  });

  it('acepta una contraseña válida (8+, número, mayúscula, sin símbolos)', () => {
    expect(validatePassword('Abcdefg1')).toEqual({ valid: true });
    expect(validatePassword('Contrasena9Segura')).toEqual({ valid: true });
  });

  it('no exige símbolos', () => {
    expect(validatePassword('Password1').valid).toBe(true);
  });

  it('exactamente 8 caracteres con número y mayúscula pasa (borde)', () => {
    expect(validatePassword('Abcdefg1')).toEqual({ valid: true });
  });

  it('7 caracteres con número y mayúscula falla (borde)', () => {
    expect(validatePassword('Abcdef1').valid).toBe(false);
  });
});
