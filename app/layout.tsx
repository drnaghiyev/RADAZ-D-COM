import {viewerTitle} from '@/lib/product-version';
import type { Metadata } from "next";
import "./globals.css";
import {LanguageInitialization} from "@/components/language-settings";
import { ProductBoundary } from '@/components/app-product';
import { ViewerFullscreen } from '@/components/viewer-fullscreen';

export const metadata: Metadata = {
  title: viewerTitle,
  description: "RADAZ — radioloq Rövşən Nağıyev tərəfindən hazırlanmış şəxsi DICOM görüntüləyici.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az">
      <body className="antialiased"><LanguageInitialization/><ViewerFullscreen/><ProductBoundary>{children}</ProductBoundary></body>
    </html>
  );
}
