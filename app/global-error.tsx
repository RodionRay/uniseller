'use client';

import { useEffect } from 'react';
import './globals.css';
import { ErrorFallback } from '@/components/product/error-fallback';

/** Last-resort boundary: replaces the root layout, so it renders its own html/body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global]', error);
  }, [error]);
  return (
    <html lang="ru">
      <body className="antialiased font-sans">
        <main className="flex min-h-svh items-center justify-center p-6">
          <ErrorFallback onRetry={reset} />
        </main>
      </body>
    </html>
  );
}
