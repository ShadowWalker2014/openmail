import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import DocsLayout from "@/components/layout/DocsLayout";
import DocPage from "@/pages/DocPage";

// When served at /docs/ from the web service, all routes must be prefixed.
// In standalone dev mode (bun dev inside docs/), the vite base is also /docs/
// so basename="/docs" correctly matches the URL structure.
const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Navigate to="/getting-started/introduction" replace />,
    },
    {
      path: "/*",
      element: <DocsLayout />,
      children: [
        {
          path: "*",
          element: <DocPage />,
        },
      ],
    },
  ],
  { basename: "/docs" },
);

export default function App() {
  return <RouterProvider router={router} />;
}
