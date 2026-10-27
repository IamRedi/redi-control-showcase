import "@redi-control/ui/tokens.css";
import "../styles.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "REDI CONTROL",
  description: "Multi-tenant control plane foundation",
};

export default function RootRedirectLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
