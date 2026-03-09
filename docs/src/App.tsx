import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import DocsLayout from "@/components/layout/DocsLayout";
import DocPage from "@/pages/DocPage";

const router = createBrowserRouter([
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
]);

export default function App() {
  return <RouterProvider router={router} />;
}
