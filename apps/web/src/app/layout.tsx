import type { Metadata } from "next";
import { Toaster } from "sonner";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "CatLium EduTech",
  description: "Teaching platform for educational institutions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}