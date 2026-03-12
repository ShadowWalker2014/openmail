import { createRootRoute, Outlet } from "@tanstack/react-router";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";

function GlobalErrorFallback({ error }: { error: Error }) {
  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h2 className="text-[16px] font-semibold mb-2">Something went wrong</h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          An unexpected error occurred. Please refresh the page.
        </p>
        <p className="text-[11px] font-mono text-muted-foreground/70 bg-muted p-2 rounded text-left break-all">
          {error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 text-[13px] rounded-md bg-foreground text-background cursor-pointer"
        >
          Refresh page
        </button>
      </div>
    </div>
  );
}

function RootLayout() {
  const { open, setOpen } = useCommandPalette();
  return (
    <>
      <Outlet />
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <GlobalErrorFallback error={error as Error} />,
  notFoundComponent: () => (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="text-center">
        <h2 className="text-[16px] font-semibold mb-2">Page not found</h2>
        <p className="text-[13px] text-muted-foreground mb-4">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <a href="/" className="text-[13px] text-primary hover:underline cursor-pointer">
          Go home
        </a>
      </div>
    </div>
  ),
});
