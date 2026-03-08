import { createRootRoute, Outlet } from "@tanstack/react-router";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";

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
});
