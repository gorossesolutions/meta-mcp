import { Link } from "react-router";

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400" aria-label="Fil d'Ariane">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300 dark:text-slate-600">/</span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-brand-blue dark:hover:text-brand-blue">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-slate-900 dark:text-slate-100">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
