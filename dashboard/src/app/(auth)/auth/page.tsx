'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LoginForm from './forms/LoginForm';
import RegisterForm from './forms/RegisterForm';
import EsqueciSenhaForm from './forms/EsqueciSenhaForm';
import RedefinirSenhaForm from './forms/RedefinirSenhaForm';

function AuthContent() {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') || 'login';

  switch (mode) {
    case 'register':
      return <RegisterForm />;
    case 'esqueci':
      return <EsqueciSenhaForm />;
    case 'redefinir':
      return <RedefinirSenhaForm />;
    default:
      return <LoginForm />;
  }
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div>Carregando...</div>}>
      <AuthContent />
    </Suspense>
  );
}
