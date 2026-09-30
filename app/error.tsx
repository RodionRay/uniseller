'use client';

import { useEffect } from 'react';
import { ErrorFallback } from '@/components/product/error-fallback';

/** Root route error boundary (login, register, invite, marketing pages). */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[route]', error);
  }, [error]);
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <ErrorFallback onRetry={reset} />
    </main>
  );
}
