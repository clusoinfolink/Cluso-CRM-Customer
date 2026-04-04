import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Cluso Enterprise Portal",
  description: "Enterprise portal for candidate verification requests",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Script id="performance-api-polyfill" strategy="beforeInteractive">
          {`(function () {
  if (typeof window === "undefined" || !window.performance) return;
  var perf = window.performance;
  var noop = function () {};

  if (typeof perf.clearMarks !== "function") {
    try {
      perf.clearMarks = noop;
    } catch (e) {
      try {
        Object.defineProperty(perf, "clearMarks", {
          configurable: true,
          writable: true,
          value: noop,
        });
      } catch (_) {}
    }
  }

  if (typeof perf.clearMeasures !== "function") {
    try {
      perf.clearMeasures = noop;
    } catch (e) {
      try {
        Object.defineProperty(perf, "clearMeasures", {
          configurable: true,
          writable: true,
          value: noop,
        });
      } catch (_) {}
    }
  }
})();`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
