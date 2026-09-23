import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GROWTH-ON",
  description: "Prospecting, CRM and sales management platform",
};

const THEME_INIT_SCRIPT = `(function(){try{
  var t=localStorage.getItem('crm-color-theme');
  var d=localStorage.getItem('crm-design-system');
  document.documentElement.setAttribute('data-theme', (t==='blue'||t==='gray'||t==='orange')?t:'blue');
  document.documentElement.setAttribute('data-design', (d==='bento'||d==='brutalist'||d==='aurora')?d:'bento');
}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      data-theme="blue"
      data-design="bento"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-white text-[15px]">{children}</body>
    </html>
  );
}
