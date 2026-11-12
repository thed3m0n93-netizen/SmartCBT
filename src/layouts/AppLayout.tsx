import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { useAuth } from "../app/AuthContext";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";

export default function AppLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Mobile drawer: the 256px sidebar does not fit phone screens, so below the
  // `lg` breakpoint it slides in over the content instead.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("smartcbt:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!user) navigate("/login", { replace: true });
  }, [user, navigate]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    try {
      localStorage.setItem("smartcbt:sidebar-collapsed", String(sidebarCollapsed));
    } catch {
      // Keep the current layout when browser storage is unavailable.
    }
  }, [sidebarCollapsed]);

  if (!user) return null;

  return (
    <div className="flex h-full" style={{ background: "#F0F4F8" }}>
      {/* Desktop sidebar (hidden on phones — see the drawer below). */}
      <div className="hidden lg:block h-full shrink-0">
        <Sidebar
          isSidebarCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0"
            style={{ background: "rgba(15,23,42,0.5)" }}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 safe-area-top safe-area-bottom overflow-y-auto"
            style={{ boxShadow: "8px 0 24px rgba(0,0,0,0.25)" }}
          >
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header onMenu={() => setDrawerOpen((v) => !v)} />
        <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 safe-area-bottom">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
