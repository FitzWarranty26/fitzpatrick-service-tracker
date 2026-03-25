import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ClipboardList, PlusCircle, Sun, Moon, Menu, X, ChevronRight, Wrench, BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import logoWhite from "@assets/logo-white.jpg";
import logoDark from "@assets/logo-dark.jpg";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/calls", icon: ClipboardList, label: "Service Calls" },
  { href: "/new", icon: PlusCircle, label: "New Call" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
];

// Export logo paths for use in other components (e.g. PDF reports)
export { logoWhite, logoDark };

export function ThemeToggle() {
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

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      data-testid="theme-toggle"
      className="w-9 h-9 text-slate-300 hover:text-white hover:bg-sidebar-accent"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
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
      <aside className="hidden md:flex flex-col w-64 flex-shrink-0 bg-[hsl(217,32%,15%)] text-white border-r border-[hsl(217,28%,20%)]">
        {/* Logo */}
        <div className="flex items-center px-4 py-4 border-b border-sidebar-border">
          <img
            src={logoWhite}
            alt="Fitzpatrick Warranty Service, LLC"
            className="h-12 w-auto object-contain"
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1" aria-label="Main navigation">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[hsl(217,28%,22%)] text-white"
                    : "text-slate-300 hover:bg-[hsl(217,28%,22%)] hover:text-white"
                )}
              >
                <Icon className="w-4.5 h-4.5" size={18} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-4 border-t border-[hsl(217,28%,20%)] flex items-center justify-between">
          <span className="text-xs text-slate-300 font-medium">kevin@fitzpatricksales.com</span>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14 bg-[hsl(217,32%,15%)] text-white border-b border-[hsl(217,28%,20%)]">
        <div className="flex items-center">
          <img
            src={logoWhite}
            alt="Fitzpatrick Warranty Service, LLC"
            className="h-8 w-auto object-contain"
          />
        </div>
        <div className="flex items-center gap-1">
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
            className="absolute top-14 left-0 right-0 bg-[hsl(217,32%,15%)] text-white border-b border-[hsl(217,28%,20%)] p-3 space-y-1"
            onClick={e => e.stopPropagation()}
          >
            {navItems.map(({ href, icon: Icon, label }) => {
              const isActive = href === "/" ? location === "/" : location.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                    isActive ? "bg-[hsl(217,28%,22%)] text-white" : "text-slate-300 hover:bg-[hsl(217,28%,22%)] hover:text-white"
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
        <div className="flex-1 pt-14 md:pt-0">
          {children}
        </div>

        {/* Mobile Bottom Nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex bg-[hsl(217,32%,15%)] text-white border-t border-[hsl(217,28%,20%)]" aria-label="Bottom navigation">
          {navItems.map(({ href, icon: Icon, label }) => {
            const isActive = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center py-2 text-xs font-medium gap-1 transition-colors",
                  isActive ? "text-white" : "text-slate-400 hover:text-white"
                )}
              >
                <Icon size={20} />
                {label}
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
