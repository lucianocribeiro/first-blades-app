'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { createClientComponent } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { copy } from '@/lib/copy';

type LoginFormProps = {
  /** Mensaje sembrado desde el server (ej. redirect del gate de acceso). */
  initialError?: string;
};

export function LoginForm({ initialError }: LoginFormProps = {}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError ?? '');
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClientComponent();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(copy.auth.login.invalidCredentials);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError(copy.auth.login.genericError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Input
        label={copy.auth.login.email}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        icon={<Mail size={16} />}
        required
        autoComplete="email"
        placeholder={copy.auth.login.emailPlaceholder}
      />

      <Input
        label={copy.auth.login.password}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        icon={<Lock size={16} />}
        rightIcon={
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={
              showPassword
                ? copy.auth.login.hidePassword
                : copy.auth.login.showPassword
            }
            className="text-neutral hover:text-secondary transition-colors"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        }
        required
        autoComplete="current-password"
      />

      {error && (
        <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" className="w-full mt-2" loading={loading}>
        {copy.auth.login.submit}
      </Button>
    </form>
  );
}
