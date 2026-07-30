'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, AlertCircle, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Microsoft SSO landing page. The backend callback has already validated the Microsoft
 * identity, minted the AMS session, and set the HttpOnly refresh_token cookie — then
 * redirected here. We bootstrap the access token from that cookie (POST /auth/refresh),
 * load the full user (GET /auth/me), hydrate the auth store exactly like password login,
 * and enter the app. Deny outcomes arrive as ?sso=denied&reason=… — no account is ever
 * auto-created (playbook: pre-create + deny).
 */

const DENY_MESSAGES: Record<string, { title: string; body: string }> = {
  'no-account': {
    title: 'No access',
    body: 'Your Microsoft account is not registered in AMS. Please ask your administrator to add you — you can sign in again as soon as your account exists.',
  },
  inactive: {
    title: 'Account deactivated',
    body: 'Your AMS account has been deactivated. Please contact your administrator.',
  },
  mismatch: {
    title: 'Account mismatch',
    body: 'Your Microsoft identity does not match the AMS account on record. Please contact your administrator to correct your account email.',
  },
  unavailable: {
    title: 'Microsoft sign-in unavailable',
    body: 'Microsoft sign-in is not configured on this server yet. Please sign in with your email and password instead.',
  },
  state: {
    title: 'Sign-in expired',
    body: 'The sign-in attempt expired or was interrupted. Please try again.',
  },
  error: {
    title: 'Sign-in failed',
    body: 'Microsoft sign-in could not be completed. Please try again, or use your email and password.',
  },
};

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();

  const denied = searchParams.get('sso') === 'denied';
  const reason = searchParams.get('reason') ?? 'error';
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (denied) return;
    let cancelled = false;
    (async () => {
      try {
        // Cookie-authenticated: exchanges the HttpOnly refresh_token for an access token.
        const { data: refreshed } = await authApi.refresh();
        const token = refreshed.token;
        const { data: user } = await authApi.me(token);
        if (cancelled) return;
        queryClient.clear();
        setAuth(
          {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            dataset_access: user.dataset_access ?? [],
            report_access: (user as { report_access?: string[] }).report_access ?? [],
          },
          token,
          true,
        );
        router.replace('/');
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [denied]); // eslint-disable-line react-hooks/exhaustive-deps

  const deny = denied ? (DENY_MESSAGES[reason] ?? DENY_MESSAGES.error) : failed ? DENY_MESSAGES.error : null;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-8 w-8 text-blue-500" />
            <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">AMS</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Alert Management System</p>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-2xl text-center">
          {!deny ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500 mb-3" />
              <p className="text-sm text-gray-600 dark:text-gray-300">Completing Microsoft sign-in…</p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 mb-2">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{deny.title}</h1>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{deny.body}</p>
              <a
                href="/login"
                className="inline-block w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 transition-colors"
              >
                Back to sign in
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SsoCallbackPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <React.Suspense fallback={null}>
      <CallbackInner />
    </React.Suspense>
  );
}
