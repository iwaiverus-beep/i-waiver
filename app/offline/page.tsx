import { Container } from "@/components/ui";

export const metadata = { title: "Offline" };

/**
 * The only page the service worker keeps a copy of.
 *
 * Deliberately says nothing about any agreement. Someone reaching this has no
 * connection, and a cached shell implying their document was available would be
 * worse than an honest dead end.
 */
export default function OfflinePage() {
  return (
    <Container className="py-24">
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-serif text-3xl tracking-tight">No connection</h1>
        <p className="mt-4 text-ink-soft">
          This app needs to be online. Nothing is kept on your phone — agreements,
          signatures and documents all live on the server, which is what makes them
          worth anything later.
        </p>
        <p className="mt-4 text-sm text-ink-muted">Try again once you have signal.</p>
      </div>
    </Container>
  );
}
