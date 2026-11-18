import { RouterProvider } from "react-router";
import { router } from "./app/routes";
import { AuthProvider } from "./app/AuthContext";
import { ThemeProvider } from "./app/ThemeContext";
import { LangProvider } from "./i18n";
import SchoolBranding from "./components/SchoolBranding";

export default function App() {
  return (
    <ThemeProvider>
      <LangProvider>
        <AuthProvider>
          {/* Applies the admin-configured school favicon to the document head. */}
          <SchoolBranding />
          <RouterProvider router={router} />
        </AuthProvider>
      </LangProvider>
    </ThemeProvider>
  );
}
