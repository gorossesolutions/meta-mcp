import { AuthView } from "@neondatabase/auth-ui";
import { useParams } from "react-router";

export function AuthPage() {
  const { path } = useParams();
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-navy p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-lg font-semibold tracking-tight text-white">GR AdLab</p>
          <p className="text-sm text-slate-400">Tableau de bord Meta Ads</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
          <AuthView pathname={path} />
        </div>
      </div>
    </div>
  );
}
