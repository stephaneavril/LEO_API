import "@/styles/globals.css";
import { Metadata } from "next";
import { Fira_Code as FontMono, Inter as FontSans } from "next/font/google";

// import NavBar from "@/components/NavBar"; // Importa NavBar de nuevo - ESTA LÍNEA SE COMENTÓ/ELIMINÓ

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = FontMono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "HeyGen Interactive Avatar SDK Demo", // Título original
    template: `%s - HeyGen Interactive Avatar SDK Demo`, // Plantilla original
  },
  icons: {
    icon: "/heygen-logo.png", // Ícono original
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} font-sans`}
      lang="en" // Idioma original
    >
      <head />
      <body className="min-h-screen bg-black text-white">
        <main className="relative flex flex-col gap-6 h-screen w-screen">
          {/* <NavBar /> ESTA LÍNEA FUE REMOVIDA PARA ESCONDER LA BARRA DE NAVEGACIÓN */}
          {children}
        </main>
      </body>
    </html>
  );
}