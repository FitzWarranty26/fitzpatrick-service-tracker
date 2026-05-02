import { ReactNode } from "react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";

/**
 * PageHero — the unified header used across every page in the app.
 *
 * Layout matches the Service Call Detail template:
 *  - Optional back link
 *  - Title + subtitle
 *  - Optional badge row
 *  - Right-aligned actions
 *  - Optional KPI strip (separate component)
 */
export function PageHero({
  backHref,
  backLabel,
  title,
  subtitle,
  badges,
  actions,
  kpis,
}: {
  backHref?: string;
  backLabel?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  kpis?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {backHref && (
        <Link href={backHref}>
          <button
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="page-hero-back"
          >
            <ChevronLeft className="w-4 h-4" /> {backLabel || "Back"}
          </button>
        </Link>
      )}
      <div className="bg-card rounded-xl border border-border/50 p-5 md:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <div className="text-sm text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
                {subtitle}
              </div>
            )}
            {badges && (
              <div className="flex items-center gap-2 flex-wrap mt-3">
                {badges}
              </div>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              {actions}
            </div>
          )}
        </div>
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 mt-5 pt-5 border-t border-border/50">
            {kpis}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single KPI cell used inside PageHero's `kpis` slot.
 */
export function KPICell({ label, value, sublabel }: { label: string; value: ReactNode; sublabel?: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className="text-sm md:text-base font-bold text-foreground tabular-nums mt-1 truncate" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
      {sublabel && (
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sublabel}</p>
      )}
    </div>
  );
}
