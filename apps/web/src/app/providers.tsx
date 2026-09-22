'use client';

import type { ReactNode } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { AuthProvider } from '@/lib/auth';
import { TenantProvider } from '@/lib/tenant';
import { PlatformProvider } from '@/lib/platform';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <TenantProvider>
          <PlatformProvider>{children}</PlatformProvider>
        </TenantProvider>
      </AuthProvider>
    </NextThemesProvider>
  );
}
