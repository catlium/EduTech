import type { Metadata } from "next";
import { Toaster } from "sonner";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CatLium EduTech",
    template: "%s · CatLium EduTech",
  },
  description:
    "Teaching platform for educational institutions — build courses, generate content, and run examinations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}