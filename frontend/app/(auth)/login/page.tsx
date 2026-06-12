'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Activity, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { data } = await authApi.login(email, password);
      // Clear stale query cache from any previous session before setting new auth
      queryClient.clear();
      setAuth(
        {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          dataset_access: data.user.dataset_access ?? [],
          report_access: (data.user as { report_access?: string[] }).report_access ?? [],
        },
        data.token
      );

      if (data.must_change_password) {
        router.push('/change-password');
      } else {
        router.push('/');
      }
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      const message =
        axiosErr.response?.data?.message ??
        axiosErr.message ??
        'Login failed. Please check your credentials.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-8 w-8 text-blue-500" />
            <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">AMS</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Alert Management System</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">Hayo BI Platform</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-2xl">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-6 text-center">Sign in to your account</h1>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-300">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@hayo.net"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isLoading}
            >
              Sign In
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-600">
          © {new Date().getFullYear()} Hayo · Internal use only
        </p>
      </div>
    </div>
  );
}
