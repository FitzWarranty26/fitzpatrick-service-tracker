import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { getUser, isManager, logout } from "@/lib/auth";
import {
  LayoutDashboard, ClipboardList, CalendarClock, Calendar, PlusCircle, Sun, Moon, Menu, X, BarChart3, FileBarChart, MapPin, Users, Search, MoreHorizontal, Shield, ScrollText, LogOut, Receipt
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OfflineIndicatorDesktop, OfflineIndicatorMobile } from "@/components/OfflineIndicator";
import logoWhite from "@assets/logo-white.jpg";
import logoDark from "@assets/logo-dark.jpg";

const baseNavItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/calls", icon: ClipboardList, label: "Service Calls" },
  { href: "/scheduled", icon: CalendarClock, label: "Scheduled" },
  { href: "/new", icon: PlusCircle, label: "New Call" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/reports", icon: FileBarChart, label: "Reports" },
  { href: "/contacts", icon: Users, label: "Contacts" },
  { href: "/map", icon: MapPin, label: "Map" },
  { href: "/calendar", icon: Calendar, label: "Calendar" },
  { href: "/invoices", icon: Receipt, label: "Invoices" },
];

const managerNavItems = [
  { href: "/team", icon: Shield, label: "Team" },
  { href: "/audit-log", icon: ScrollText, label: "Activity Log" },
];

function getNavItems() {
  return isManager() ? [...baseNavItems, ...managerNavItems] : baseNavItems;
}

// Export logo paths for use in other components (e.g. PDF reports)
export { logoWhite, logoDark };

interface SearchResults {
  calls: Array<{ id: number; callDate: string; customerName: string | null; manufacturer: string; productModel: string | null; status: string }>;
  contacts: Array<{ id: number; contactType: string; contactName: string; companyName: string | null; phone: string | null }>;
  activities: Array<{ id: number; serviceCallId: number; note: string; createdAt: string }>;
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); setOpen(false); return; }
    try {
      const res = await apiRequest("GET", `/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data);
      setOpen(true);
    } catch {
      setResults(null);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(timerRef.current);
    if (v.length < 2) { setResults(null); setOpen(false); return; }
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const navigate = (path: string) => {
    window.location.hash = path;
    setOpen(false);
    setQuery("");
    setResults(null);
  };

  const totalResults = results ? results.calls.length + results.contacts.length + results.activities.length : 0;

  return (
    <div ref={containerRef} className="relative px-3 mb-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        <Input
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results && query.length >= 2) setOpen(true); }}
          placeholder="Search…"
          className="h-8 pl-8 text-xs bg-[hsl(220,22%,20%)] border-[hsl(220,22%,22%)] text-white placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-blue-500"
          data-testid="global-search-input"
        />
      </div>
      {open && results && totalResults > 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg max-h-80 overflow-y-auto" data-testid="global-search-results">
          {results.calls.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-3 pt-2 pb-1">Service Calls</p>
              {results.calls.map(c => (
                <button key={`c-${c.id}`} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors" onClick={() => navigate(`/calls/${c.id}`)} data-testid={`search-result-call-${c.id}`}>
                  <span className="font-medium text-foreground">{c.customerName || "Call"} #{c.id}</span>
                  <span className="text-xs text-muted-foreground ml-2">{formatDate(c.callDate)} · {c.manufacturer}</span>
                </button>
              ))}
            </div>
          )}
          {results.contacts.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-3 pt-2 pb-1">Contacts</p>
              {results.contacts.map(c => (
                <button key={`ct-${c.id}`} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors" onClick={() => navigate("/contacts")} data-testid={`search-result-contact-${c.id}`}>
                  <span className="font-medium text-foreground">{c.contactName}</span>
                  {c.companyName && <span className="text-muted-foreground ml-1">({c.companyName})</span>}
                  <span className="text-xs text-muted-foreground ml-2">{c.contactType}</span>
                </button>
              ))}
            </div>
          )}
          {results.activities.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-3 pt-2 pb-1">Activity Notes</p>
              {results.activities.map(a => (
                <button key={`a-${a.id}`} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors" onClick={() => navigate(`/calls/${a.serviceCallId}`)} data-testid={`search-result-activity-${a.id}`}>
                  <span className="text-foreground">{a.note.length > 80 ? a.note.slice(0, 80) + "…" : a.note}</span>
                  <span className="text-xs text-muted-foreground ml-2">Call #{a.serviceCallId}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {open && results && totalResults === 0 && query.length >= 2 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg p-3">
          <p className="text-sm text-muted-foreground text-center">No results found</p>
        </div>
      )}
    </div>
  );
}

export function ThemeToggle({ variant = "sidebar" }: { variant?: "sidebar" | "main" }) {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  const toggle = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (newDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const styles = variant === "main"
    ? "w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-muted"
    : "w-9 h-9 text-slate-300 hover:text-white hover:bg-sidebar-accent";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      data-testid="theme-toggle"
      className={styles}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

const primaryNavItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/calls", icon: ClipboardList, label: "Calls" },
  { href: "/scheduled", icon: CalendarClock, label: "Scheduled" },
  { href: "/new", icon: PlusCircle, label: "New Call" },
];

const moreNavItems = [
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/reports", icon: FileBarChart, label: "Reports" },
  { href: "/contacts", icon: Users, label: "Contacts" },
  { href: "/map", icon: MapPin, label: "Map" },
];

function MobileBottomNav({ location }: { location: string }) {
  const [showMore, setShowMore] = useState(false);
  const moreIsActive = moreNavItems.some(item => location.startsWith(item.href));

  return (
    <>
      {/* More menu overlay */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setShowMore(false)}>
          <div
            className="absolute bottom-[60px] left-0 right-0 bg-[hsl(220,22%,14%)] border-t border-[hsl(220,22%,18%)] rounded-t-xl p-2"
            onClick={e => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-1">
              {moreNavItems.map(({ href, icon: Icon, label }) => {
                const isActive = location.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setShowMore(false)}
                    className={cn(
                      "flex flex-col items-center justify-center py-3 rounded-lg text-xs font-medium gap-1 transition-colors",
                      isActive ? "text-white bg-[hsl(220,22%,20%)]" : "text-slate-400 hover:text-white"
                    )}
                  >
                    <Icon size={22} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex bg-[hsl(220,22%,14%)] text-white border-t border-[hsl(220,22%,18%)]" aria-label="Bottom navigation">
        {primaryNavItems.map(({ href, icon: Icon, label }) => {
          const isActive = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium gap-0.5 transition-colors",
                isActive ? "text-white" : "text-slate-400 hover:text-white"
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setShowMore(!showMore)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center py-2 text-[10px] font-medium gap-0.5 transition-colors",
            showMore || moreIsActive ? "text-white" : "text-slate-400 hover:text-white"
          )}
          data-testid="button-more-nav"
        >
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>
    </>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Apply dark mode based on system preference on mount
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  return (
    <div className="min-h-dvh flex bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 flex-shrink-0 bg-[hsl(220,22%,14%)] text-white border-r border-[hsl(220,22%,18%)]">
        {/* Logo */}
        <div className="flex items-center px-4 py-3.5 border-b border-sidebar-border">
          <div className="bg-[hsl(220,24%,17%)] rounded-xl px-3 py-2 border border-white/[0.06]">
            <img
              src={logoWhite}
              alt="Fitzpatrick Warranty Service, LLC"
              className="h-10 w-auto object-contain"
            />
          </div>
        </div>

        {/* Search */}
        <GlobalSearch />

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1" aria-label="Main navigation">
          {getNavItems().map(({ href, icon: Icon, label }) => {
            const isActive = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[hsl(220,22%,20%)] text-white"
                    : "text-slate-300 hover:bg-[hsl(220,22%,20%)] hover:text-white"
                )}
              >
                <Icon className="w-4.5 h-4.5" size={18} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-4 border-t border-[hsl(220,22%,18%)] space-y-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs text-slate-300 font-medium truncate">{getUser()?.displayName || "User"}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">{getUser()?.role || ""}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => { await logout(); window.location.reload(); }}
              title="Sign out"
              className="w-8 h-8 text-slate-500 hover:text-red-400 hover:bg-red-400/10 flex-shrink-0"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
          <OfflineIndicatorDesktop />
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14 bg-[hsl(220,22%,14%)] text-white border-b border-[hsl(220,22%,18%)]">
        <div className="flex items-center">
          <div className="bg-[hsl(220,24%,17%)] rounded-lg px-2.5 py-1.5 border border-white/[0.06]">
            <img
              src={logoWhite}
              alt="Fitzpatrick Warranty Service, LLC"
              className="h-7 w-auto object-contain"
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <OfflineIndicatorMobile />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-sidebar-accent"
            onClick={() => setMobileMenuOpen(v => !v)}
            aria-label="Toggle menu"
            data-testid="mobile-menu-toggle"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute top-14 left-0 right-0 bg-[hsl(220,22%,14%)] text-white border-b border-[hsl(220,22%,18%)] p-3 space-y-1"
            onClick={e => e.stopPropagation()}
          >
            {getNavItems().map(({ href, icon: Icon, label }) => {
              const isActive = href === "/" ? location === "/" : location.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                    isActive ? "bg-[hsl(220,22%,20%)] text-white" : "text-slate-300 hover:bg-[hsl(220,22%,20%)] hover:text-white"
                  )}
                >
                  <Icon size={18} />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-auto">
        {/* Desktop top bar with theme toggle */}
        <div className="hidden md:flex items-center justify-end px-6 py-2 border-b border-border bg-background">
          <ThemeToggle variant="main" />
        </div>
        <div className="flex-1 pt-14 md:pt-0">
          {children}
        </div>

        {/* Mobile Bottom Nav — 4 primary items + More */}
        <MobileBottomNav location={location} />
      </main>
    </div>
  );
}
