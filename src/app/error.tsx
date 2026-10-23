"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen bg-[#010409] text-slate-100 flex items-center justify-center p-6">
      <section role="alert" className="panel max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold">ORBITAL est momentanément indisponible</h1>
        <p className="mt-3 text-sm text-slate-300">L’interface n’a pas pu s’afficher. Vous pouvez réessayer sans perdre les données du serveur.</p>
        <button className="header-button mt-5" type="button" onClick={reset}>Réessayer</button>
      </section>
    </main>
  );
}
