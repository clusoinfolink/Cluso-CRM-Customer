import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cluso Customer Portal",
  description: "Customer portal for candidate verification requests",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
