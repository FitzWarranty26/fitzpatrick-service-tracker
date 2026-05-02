import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { getWarrantyStatus } from "@shared/schema";
import {
  History as HistoryIcon, Wrench, Calendar as CalendarIcon, Lightbulb, ShieldCheck,
  CheckCircle2, Keyboard,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayISO() { return new Date().toISOString().split("T")[0]; }

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function relativeDays(callDate: string): string {
  const d = daysBetween(callDate, todayISO());
  if (d === 0) return "today";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

interface CustomerCall {
  id: number;
  callDate: string;
  scheduledDate: string | null;
  status: string;
  manufacturer: string;
  productModel: string | null;
  productSerial: string | null;
}

interface SerialCall {
  id: number;
  callDate: string;
  manufacturer: string;
  status: string;
  customerName: string;
  productModel: string | null;
  installationDate: string | null;
  productType: string | null;
  issueDescription: string | null;
}

// ─── Section card ───────────────────────────────────────────────────────────

function SbCard({
  icon: Icon, iconColor, title, children, empty = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: "sky" | "violet" | "emerald" | "amber" | "cyan" | "muted";
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  const colorClass = {
    sky:     "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    violet:  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    amber:   "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    cyan:    "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
    muted:   "bg-muted text-muted-foreground",
  }[iconColor];
  return (
    <div className={`rounded-xl border ${empty ? "border-dashed border-border/40 bg-muted/10" : "border-border/50 bg-card"} p-3.5`}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${colorClass}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <p className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}

// ─── Customer history ──────────────────────────────────────────────────────

function CustomerHistory({ customerName }: { customerName: string }) {
  const trimmed = (customerName || "").trim();
  const enabled = trimmed.length >= 3;
  const { data: calls, isLoading } = useQuery<CustomerCall[]>({
    queryKey: ["/api/calls/by-customer", trimmed],
    enabled,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/calls/by-customer?name=${encodeURIComponent(trimmed)}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  if (!enabled) {
    return (
      <SbCard icon={HistoryIcon} iconColor="muted" title="Customer History" empty>
        <p className="text-[11.5px] text-muted-foreground/70 leading-relaxed">
          Type a customer name above to see their recent calls.
        </p>
      </SbCard>
    );
  }
  if (isLoading) {
    return (
      <SbCard icon={HistoryIcon} iconColor="sky" title="Customer History">
        <p className="text-[11.5px] text-muted-foreground">Searching…</p>
      </SbCard>
    );
  }
  if (!calls || calls.length === 0) {
    return (
      <SbCard icon={HistoryIcon} iconColor="emerald" title="Customer History">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
          <p className="text-[11.5px] text-foreground/80 leading-relaxed">
            <strong>New customer.</strong> No prior calls on file for this name.
          </p>
        </div>
      </SbCard>
    );
  }
  return (
    <SbCard icon={HistoryIcon} iconColor="sky" title="Customer History">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] font-semibold text-foreground truncate">{trimmed}</p>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold whitespace-nowrap">
          {calls.length} prior call{calls.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-1">
        {calls.slice(0, 3).map((c) => (
          <Link
            key={c.id}
            href={`/calls/${c.id}`}
            className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors"
            data-testid={`sb-customer-call-${c.id}`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] text-foreground/90 truncate">
                <span className="font-mono text-muted-foreground">#{c.id}</span> · {c.status}
                {c.productModel && <span className="text-muted-foreground"> · {c.productModel}</span>}
              </p>
              <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">
                {formatDate(c.callDate)}
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
              {relativeDays(c.callDate)}
            </span>
          </Link>
        ))}
      </div>
      {calls.length > 3 && (
        <p className="text-[10.5px] text-muted-foreground/70 mt-2 text-center">
          +{calls.length - 3} more
        </p>
      )}
    </SbCard>
  );
}

// ─── Equipment history (by serial) + warranty calc ─────────────────────────

function EquipmentHistory({
  serial, manufacturer, productType, installationDate,
}: {
  serial: string;
  manufacturer: string | null;
  productType: string | null;
  installationDate: string | null;
}) {
  const trimmed = (serial || "").trim();
  const enabled = trimmed.length >= 3;
  const { data: calls } = useQuery<SerialCall[]>({
    queryKey: ["/api/calls/by-serial", trimmed],
    enabled,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/calls/by-serial?serial=${encodeURIComponent(trimmed)}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  // Compute warranty status (works without a serial too — only needs install date + mfr + type)
  let warranty: ReturnType<typeof getWarrantyStatus> | null = null;
  if (installationDate && manufacturer) {
    warranty = getWarrantyStatus(installationDate, manufacturer, productType || "Residential");
  }

  const hasWarranty = warranty && warranty.status !== "unknown";
  if (!enabled && !hasWarranty) {
    return (
      <SbCard icon={Wrench} iconColor="muted" title="Equipment History" empty>
        <p className="text-[11.5px] text-muted-foreground/70 leading-relaxed">
          Enter a serial number or install date to see prior visits and warranty status.
        </p>
      </SbCard>
    );
  }

  return (
    <SbCard icon={Wrench} iconColor="violet" title="Equipment History">
      {/* Prior visits on this exact serial */}
      {enabled && calls && calls.length > 0 && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11.5px] font-semibold text-foreground">Prior visits on this unit</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold">
              {calls.length}
            </span>
          </div>
          <div className="space-y-1">
            {calls.slice(0, 2).map((c) => (
              <Link
                key={c.id}
                href={`/calls/${c.id}`}
                className="block text-[11px] py-1 px-2 rounded-md hover:bg-muted/40 transition-colors"
              >
                <span className="font-mono text-muted-foreground">#{c.id}</span> · {formatDate(c.callDate)} · {c.status}
                {c.issueDescription && (
                  <p className="text-[10.5px] text-muted-foreground/70 truncate mt-0.5">
                    {c.issueDescription}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
      {enabled && calls && calls.length === 0 && (
        <div className="mb-2.5 flex items-start gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
          <p className="text-[11.5px] text-foreground/80 leading-relaxed">
            <strong>First visit</strong> — no prior calls for serial <span className="font-mono">{trimmed}</span>.
          </p>
        </div>
      )}

      {/* Warranty calculation */}
      {warranty && warranty.status !== "unknown" && (
        <div className={`pt-2 border-t border-border/40 ${enabled && calls && calls.length > 0 ? "" : "border-t-0 pt-0"}`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11.5px] font-semibold text-foreground flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Warranty
            </p>
            <span className={`text-[10.5px] px-2 py-0.5 rounded-full font-semibold ${
              warranty.status === "in-warranty"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
            }`}>
              {warranty.status === "in-warranty" ? "in warranty" : "expired"}
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground/80 leading-relaxed">
            {manufacturer} · {productType || "Residential"} · {warranty.warrantyYears} yr term
          </p>
          {warranty.status === "in-warranty" && warranty.expiresDate && warranty.daysRemaining != null && (
            <>
              {(() => {
                const total = warranty.warrantyYears * 365;
                const left = warranty.daysRemaining;
                const pct = Math.max(0, Math.min(100, (left / total) * 100));
                const yrs = Math.floor(left / 365);
                const mos = Math.floor((left % 365) / 30);
                const remaining = yrs > 0 ? `${yrs}y ${mos}mo left` : `${mos}mo left`;
                return (
                  <div className="mt-2">
                    <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                      expires <strong className="text-foreground/80">{formatDate(warranty.expiresDate)}</strong>
                      {" · "}{remaining}
                    </p>
                  </div>
                );
              })()}
            </>
          )}
          {warranty.status === "out-of-warranty" && warranty.expiresDate && (
            <p className="text-[10px] text-muted-foreground/70 mt-1.5">
              expired <strong className="text-foreground/80">{formatDate(warranty.expiresDate)}</strong>
            </p>
          )}
        </div>
      )}
    </SbCard>
  );
}

// ─── Scheduling hint ───────────────────────────────────────────────────────

function ScheduleHint({ scheduledDate, scheduledTime }: { scheduledDate: string | null; scheduledTime: string | null }) {
  if (!scheduledDate) {
    return (
      <SbCard icon={CalendarIcon} iconColor="muted" title="Scheduling" empty>
        <p className="text-[11.5px] text-muted-foreground/70 leading-relaxed">
          Set a scheduled date once you know when the tech is going on-site.
        </p>
      </SbCard>
    );
  }
  return (
    <SbCard icon={CalendarIcon} iconColor="amber" title="Scheduling">
      <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-2">
        <p className="text-[11.5px] text-foreground/90 leading-relaxed">
          Scheduled for{" "}
          <strong className="text-amber-700 dark:text-amber-300">{formatDate(scheduledDate)}</strong>
          {scheduledTime && (
            <> at <strong className="text-amber-700 dark:text-amber-300">{scheduledTime}</strong></>
          )}.
        </p>
      </div>
    </SbCard>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export interface NewCallSidebarProps {
  customerName: string;
  jobSiteName: string;
  productSerial: string;
  manufacturer: string;
  productType: string;
  installationDate: string;
  scheduledDate: string;
  scheduledTime: string;
}

export function NewCallSidebar(p: NewCallSidebarProps) {
  // Use the more specific name if customer is empty
  const lookupName = (p.customerName || p.jobSiteName || "").trim();
  return (
    <div className="space-y-3">
      <CustomerHistory customerName={lookupName} />
      <EquipmentHistory
        serial={p.productSerial}
        manufacturer={p.manufacturer || null}
        productType={p.productType || null}
        installationDate={p.installationDate || null}
      />
      <ScheduleHint
        scheduledDate={p.scheduledDate || null}
        scheduledTime={p.scheduledTime || null}
      />
      <SbCard icon={Lightbulb} iconColor="cyan" title="Quick Tips">
        <ul className="text-[11.5px] text-muted-foreground/80 leading-relaxed space-y-1.5 pl-1">
          <li>• Required: Call Date · Status · Manufacturer · Created By</li>
          <li>• Add photos and parts inline — no separate page</li>
          <li>• File the warranty claim later from the call detail page</li>
        </ul>
      </SbCard>
    </div>
  );
}
