import type { ReactNode } from "react";
import { Link } from "react-router";
import { UserButton } from "@neondatabase/auth-ui";
import { Moon, Sun } from "lucide-react";
import { useDarkMode } from "../../hooks/useDarkMode";

export function AppShell({ clientId, children }: { clientId?: string; children: ReactNode }) {
  const [dark, toggleDark] = useDarkMode();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-brand-navy dark:border-slate-800">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2 text-white">
            <span className="h-2 w-2 rounded-full bg-brand-blue" aria-hidden />
            <span className="text-sm font-semibold tracking-tight">GR AdLab</span>
            <span className="text-sm text-slate-400">Meta Ads</span>
          </Link>
          <div className="flex items-center gap-3">
            {clientId && (
              <Link
                to={`/clients/${clientId}/angles`}
                className="text-sm text-slate-300 hover:text-white"
              >
                Angles créatifs
              </Link>
            )}
            <button
              onClick={toggleDark}
              aria-label="Basculer le mode sombre"
              className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              {dark ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
            </button>
            {/* Forced into its dark variant regardless of the app's own light/dark
                toggle — the header background stays navy in both, so UserButton
                should always render its light-on-dark colors here. */}
            <div className="dark">
              <UserButton classNames={{ trigger: { user: { subtitle: "hidden" } } }} />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
    </div>
  );
}
