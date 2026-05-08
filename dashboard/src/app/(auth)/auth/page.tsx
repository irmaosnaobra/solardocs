'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LoginForm from './forms/LoginForm';
import RegisterForm from './forms/RegisterForm';
import EsqueciSenhaForm from './forms/EsqueciSenhaForm';
import RedefinirSenhaForm from './forms/RedefinirSenhaForm';
import EmailSentForm from './forms/EmailSentForm';

function AuthContent() {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') || 'login';

  switch (mode) {
    case 'register':
    case 'signup':
      return <RegisterForm />;
    case 'esqueci':
    case 'forgot':
    case 'forgot-password':
      return <EsqueciSenhaForm />;
    case 'email-sent':
    case 'sent':
      return <EmailSentForm />;
    case 'redefinir':
    case 'reset':
    case 'reset-password':
      return <RedefinirSenhaForm />;
    default:
      return <LoginForm />;
  }
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: '#475569' }}>Carregando...</div>}>
      <AuthContent />
    </Suspense>
  );
}
