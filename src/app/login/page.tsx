import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
export const metadata = { title: 'Sign in · TFK Predictions League' };
export default function LoginPage() {
  return <Suspense><AuthForm mode="login" /></Suspense>;
}
