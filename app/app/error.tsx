'use client';

import { useEffect } from 'react';
import { ErrorFallback } from '@/components/product/error-fallback';

/** Route error boundary for the cabinet: a render throw shows a recoverable screen, not a blank page. */
export default function CabinetError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[cabinet]', error);
  }, [error]);
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <ErrorFallback onRetry={reset} />
    </main>
  );
}
