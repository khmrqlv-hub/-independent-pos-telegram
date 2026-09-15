import type {Metadata, Viewport} from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Independent POS",
  description: "Защищённая касса магазина",
  applicationName: "Independent POS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f6f8",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ru"><body>{children}</body></html>;
}

