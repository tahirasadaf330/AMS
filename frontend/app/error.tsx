'use client';

import * as React from 'react';

/**
 * Root route-level error boundary. Catches render crashes anywhere below the root
 * layout so users get a recoverable screen instead of a blank white page.
 *
 * IMPORTANT: this boundary intentionally does NOT clear the user's session
 * automatically. The stale-persisted-auth crash that originally motivated it is now
 * prevented at the source (null-safe access helpers + a versioned persist migration
 * in the auth store), so auto-wiping auth here would only harm unrelated cases —
 * it would log people out on any transient/unrelated render error and could loop on
 * the default route (crash -> wipe -> re-login -> crash). Recovery is user-initiated:
 * "Try again" uses Next's reset() for transient errors; "Reset session & sign in" is
 * the explicit escape hatch for the rare case where corrupt local state is the cause.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('AMS render error:', error);
  }, [error]);

  const resetSession = () => {
    try {
      localStorage.removeItem('ams-auth');
      sessionStorage.removeItem('ams-auth');
    } catch {
      /* storage unavailable — ignore */
    }
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-2xl text-center">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          An unexpected error occurred while rendering this page.
        </p>
        <div className="space-y-2">
          <button
            onClick={() => reset()}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 transition-colors"
          >
            Try again
          </button>
          <button
            onClick={resetSession}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium py-2.5 transition-colors"
          >
            Reset session &amp; sign in
          </button>
        </div>
      </div>
    </div>
  );
}
