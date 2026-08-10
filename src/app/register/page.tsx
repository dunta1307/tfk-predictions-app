import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
export const metadata = { title: 'Create account · TFK Predictions League' };
export default function RegisterPage() {
  return <Suspense><AuthForm mode="register" /></Suspense>;
}
