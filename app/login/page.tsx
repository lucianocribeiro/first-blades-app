import type { Metadata } from 'next';
import Image from 'next/image';
import { LoginForm } from './LoginForm';
import { copy } from '@/lib/copy';

export const metadata: Metadata = { title: 'Ingresar · Portal First Blades' };

type LoginPageProps = {
  searchParams: Promise<{ motivo?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { motivo } = await searchParams;
  // `motivo=acceso` llega desde el gate de requireAuth() (FB-F5-08): sesión
  // sin perfil activo. El mensaje es el genérico de sesión expirada — nunca
  // uno específico de "cuenta inactiva", para no confirmarle a quien haya
  // adivinado una contraseña correcta de una cuenta dada de baja que acertó.
  const blockedMessage = motivo === 'acceso' ? copy.errors.sessionExpired : undefined;

  return (
    <div className="min-h-screen flex">
      {/* Panel izquierdo — marca */}
      <div className="hidden lg:flex lg:w-1/2 bg-secondary flex-col items-center justify-center p-12">
        <Image
          src="/logo.fb.png"
          alt={copy.general.logoAlt}
          width={200}
          height={70}
          className="object-contain mb-8"
          priority
        />
        <p className="text-blue-200 text-sm text-center">
          {copy.auth.login.brandTagline}
        </p>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex-1 flex items-center justify-center p-8 bg-surface">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-card shadow-card border border-color-border p-8">
            {/* Logo mobile */}
            <div className="flex justify-center mb-6 lg:hidden">
              <Image
                src="/logo.fb.png"
                alt={copy.general.logoAlt}
                width={140}
                height={50}
                className="object-contain"
                priority
              />
            </div>

            <h1 className="text-2xl font-bold text-secondary text-center mb-1">
              {copy.auth.login.welcome}
            </h1>
            <p className="text-neutral text-sm text-center mb-8">
              {copy.auth.login.subtitle}
            </p>

            <LoginForm initialError={blockedMessage} />

            <p className="text-center text-xs text-neutral mt-6">
              {copy.auth.login.secureAccess}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
