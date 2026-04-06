import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, CalendarDays, List } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CalendarCall {
  id: number;
  callDate: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  customerName: string | null;
  jobSiteName: string | null;
  jobSiteCity: string | null;
  jobSiteState: string | null;
  manufacturer: string;
  status: string;
  createdByUsername: string | null;
}

interface CalendarUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  "Scheduled":      "bg-amber-100 border-amber-400 text-amber-800 dark:bg-amber-900/30 dark:border-amber-600 dark:text-amber-300",
  "In Progress":    "bg-sky-100 border-sky-400 text-sky-800 dark:bg-sky-900/30 dark:border-sky-600 dark:text-sky-300",
  "Pending Parts":  "bg-orange-100 border-orange-400 text-orange-800 dark:bg-orange-900/30 dark:border-orange-600 dark:text-orange-300",
  "Completed":      "bg-emerald-100 border-emerald-400 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-600 dark:text-emerald-300",
  "Escalated":      "bg-red-100 border-red-400 text-red-800 dark:bg-red-900/30 dark:border-red-600 dark:text-red-300",
};

const DOT_COLORS: Record<string, string> = {
  "Scheduled":     "bg-amber-400",
  "In Progress":   "bg-sky-400",
  "Pending Parts": "bg-orange-400",
  "Completed":     "bg-emerald-400",
  "Escalated":     "bg-red-400",
};

function formatTime(t: string | null) {
  if (!t) return "";
  // Handle "HH:MM" format
  const [h, m] = t.split(":");
  if (!h || !m) return t;
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function isoToLocal(dateStr: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const today = new Date();
  const [viewMode, setViewMode] = useState<"month" | "week" | "list">("month");
  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [filterUser, setFilterUser] = useState("__all__");
  const [selectedCall, setSelectedCall] = useState<CalendarCall | null>(null);

  // Fetch users for filter
  const { data: users = [] } = useQuery<CalendarUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      try {
        const r = await apiRequest("GET", "/api/users");
        return r.json();
      } catch { return []; }
    },
  });

  // Fetch service calls — get 3 months around current view for smooth navigation
  const fetchFrom = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  const fetchTo = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0);
  const fromStr = `${fetchFrom.getFullYear()}-${String(fetchFrom.getMonth()+1).padStart(2,"0")}-01`;
  const toStr = `${fetchTo.getFullYear()}-${String(fetchTo.getMonth()+1).padStart(2,"0")}-${String(fetchTo.getDate()).padStart(2,"0")}`;

  const { data: allCalls = [], isLoading } = useQuery<CalendarCall[]>({
    queryKey: ["/api/calendar", fromStr, toStr],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/calendar?from=${fromStr}&to=${toStr}`);
      return r.json();
    },
  });

  // Filter by user
  const calls = useMemo(() => {
    if (filterUser === "__all__") return allCalls;
    return allCalls.filter(c => c.createdByUsername === filterUser);
  }, [allCalls, filterUser]);

  // Group calls by date string (using scheduledDate, fall back to callDate)
  const callsByDate = useMemo(() => {
    const map: Record<string, CalendarCall[]> = {};
    calls.forEach(call => {
      const dateKey = call.scheduledDate || call.callDate;
      if (dateKey) {
        if (!map[dateKey]) map[dateKey] = [];
        map[dateKey].push(call);
      }
    });
    return map;
  }, [calls]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  function prevMonth() { setCurrentDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setCurrentDate(new Date(year, month + 1, 1)); }
  function prevWeek() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7)); }
  function nextWeek() { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)); }
  function goToday() { setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1)); }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  // ─── Month View ──────────────────────────────────────────────────────────

  function MonthView() {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({length: daysInMonth}, (_,i) => i+1)];
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <div className="bg-card rounded-lg border overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {DAY_NAMES.map(d => (
            <div key={d} className="p-2 text-center text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{d}</div>
          ))}
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            const dateStr = day ? `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}` : null;
            const dayCalls = dateStr ? (callsByDate[dateStr] || []) : [];
            const isToday = dateStr === todayStr;
            return (
              <div
                key={idx}
                className={`min-h-[90px] border-r border-b p-1.5 last:border-r-0 ${!day ? "bg-muted/10" : ""} ${idx % 7 === 0 ? "border-l-0" : ""}`}
              >
                {day && (
                  <>
                    <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium mb-1 ${isToday ? "bg-[hsl(200,72%,40%)] text-white" : "text-foreground"}`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayCalls.slice(0, 3).map(call => (
                        <button
                          key={call.id}
                          onClick={() => setSelectedCall(call)}
                          className={`w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded border-l-2 truncate block ${STATUS_COLORS[call.status] || STATUS_COLORS["Scheduled"]}`}
                        >
                          {call.scheduledTime ? `${formatTime(call.scheduledTime)} ` : ""}{call.customerName || call.jobSiteName || call.manufacturer}
                        </button>
                      ))}
                      {dayCalls.length > 3 && (
                        <div className="text-[10px] text-muted-foreground pl-1">+{dayCalls.length - 3} more</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Week View ───────────────────────────────────────────────────────────

  function WeekView() {
    // Get the Sunday of the current week
    const weekStart = new Date(currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const days = Array.from({length: 7}, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });

    return (
      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="grid grid-cols-7 border-b">
          {days.map((d, i) => {
            const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            const isToday = ds === todayStr;
            return (
              <div key={i} className={`p-2 text-center border-r last:border-r-0 ${isToday ? "bg-[hsl(200,72%,40%)]/10" : "bg-muted/20"}`}>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{DAY_NAMES[d.getDay()]}</div>
                <div className={`text-lg font-bold mt-0.5 ${isToday ? "text-[hsl(200,72%,40%)]" : ""}`}>{d.getDate()}</div>
                <div className="text-[9px] text-muted-foreground">{MONTH_NAMES[d.getMonth()].substring(0,3)}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 min-h-[400px]">
          {days.map((d, i) => {
            const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
            const dayCalls = callsByDate[ds] || [];
            const isToday = ds === todayStr;
            return (
              <div key={i} className={`border-r last:border-r-0 p-1.5 space-y-1 ${isToday ? "bg-[hsl(200,72%,40%)]/5" : ""}`}>
                {dayCalls.map(call => (
                  <button
                    key={call.id}
                    onClick={() => setSelectedCall(call)}
                    className={`w-full text-left text-[10px] leading-tight px-1.5 py-1 rounded border-l-2 block ${STATUS_COLORS[call.status] || STATUS_COLORS["Scheduled"]}`}
                  >
                    {call.scheduledTime && <div className="font-medium">{formatTime(call.scheduledTime)}</div>}
                    <div className="truncate">{call.customerName || call.jobSiteName || "—"}</div>
                    <div className="truncate text-[9px] opacity-75">{call.manufacturer}</div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── List View ───────────────────────────────────────────────────────────

  function ListView() {
    // Get all calls for the current month, sorted by date+time
    const monthStr = `${year}-${String(month+1).padStart(2,"0")}`;
    const monthCalls = calls
      .filter(c => (c.scheduledDate || c.callDate || "").startsWith(monthStr))
      .sort((a, b) => {
        const da = (a.scheduledDate || a.callDate) + (a.scheduledTime || "");
        const db = (b.scheduledDate || b.callDate) + (b.scheduledTime || "");
        return da.localeCompare(db);
      });

    if (monthCalls.length === 0) {
      return (
        <div className="bg-card rounded-lg border p-12 text-center">
          <CalendarDays className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium text-foreground">No scheduled calls this month</p>
          <p className="text-sm text-muted-foreground mt-1">Service calls with a scheduled date will appear here.</p>
        </div>
      );
    }

    // Group by date
    const grouped: Record<string, CalendarCall[]> = {};
    monthCalls.forEach(c => {
      const key = c.scheduledDate || c.callDate;
      if (key) {
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(c);
      }
    });

    return (
      <div className="space-y-4">
        {Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).map(([date, dayCalls]) => {
          const d = isoToLocal(date);
          const isToday = date === todayStr;
          return (
            <div key={date}>
              <div className={`flex items-center gap-3 mb-2`}>
                <div className={`w-9 h-9 rounded-xl flex flex-col items-center justify-center text-[10px] uppercase tracking-wide font-medium flex-shrink-0 ${isToday ? "bg-[hsl(200,72%,40%)] text-white" : "bg-muted text-muted-foreground"}`}>
                  <span className="text-[8px] leading-none">{DAY_NAMES[d.getDay()]}</span>
                  <span className="text-base font-bold leading-none mt-0.5">{d.getDate()}</span>
                </div>
                <span className={`text-sm font-medium ${isToday ? "text-[hsl(200,72%,40%)]" : "text-muted-foreground"}`}>
                  {MONTH_NAMES[d.getMonth()]} {d.getDate()}, {d.getFullYear()}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
                {dayCalls.map(call => (
                  <Link key={call.id} href={`/calls/${call.id}`}>
                    <div className={`bg-card border rounded-lg p-3 flex items-start gap-3 hover:border-[hsl(200,72%,40%)] transition-colors cursor-pointer border-l-4 ${STATUS_COLORS[call.status]?.split(" ").find(c => c.startsWith("border-")) || "border-l-amber-400"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {call.scheduledTime && (
                            <span className="text-xs font-medium text-muted-foreground">{formatTime(call.scheduledTime)}</span>
                          )}
                          <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[call.status]}`}>{call.status}</Badge>
                          {call.createdByUsername && (
                            <span className="text-[10px] text-muted-foreground">by {call.createdByUsername}</span>
                          )}
                        </div>
                        <div className="font-medium text-sm mt-0.5">{call.customerName || call.jobSiteName || "—"}</div>
                        {call.jobSiteName && call.customerName && (
                          <div className="text-xs text-muted-foreground">{call.jobSiteName}</div>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {call.manufacturer}
                          {(call.jobSiteCity || call.jobSiteState) && ` · ${[call.jobSiteCity, call.jobSiteState].filter(Boolean).join(", ")}`}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ─── Call Detail Popover ─────────────────────────────────────────────────

  function CallPopover() {
    if (!selectedCall) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setSelectedCall(null)}>
        <div className="bg-card rounded-xl border shadow-xl w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-base">{selectedCall.customerName || selectedCall.jobSiteName || "Service Call"}</div>
              {selectedCall.jobSiteName && selectedCall.customerName && (
                <div className="text-sm text-muted-foreground">{selectedCall.jobSiteName}</div>
              )}
            </div>
            <Badge variant="outline" className={`text-xs flex-shrink-0 ${STATUS_COLORS[selectedCall.status]}`}>{selectedCall.status}</Badge>
          </div>
          <div className="space-y-1 text-sm">
            {(selectedCall.scheduledDate || selectedCall.callDate) && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-16 flex-shrink-0">Date</span>
                <span>{isoToLocal(selectedCall.scheduledDate || selectedCall.callDate).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}{selectedCall.scheduledTime ? ` at ${formatTime(selectedCall.scheduledTime)}` : ""}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16 flex-shrink-0">Manufacturer</span>
              <span>{selectedCall.manufacturer}</span>
            </div>
            {(selectedCall.jobSiteCity || selectedCall.jobSiteState) && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-16 flex-shrink-0">Location</span>
                <span>{[selectedCall.jobSiteCity, selectedCall.jobSiteState].filter(Boolean).join(", ")}</span>
              </div>
            )}
            {selectedCall.createdByUsername && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-16 flex-shrink-0">Created by</span>
                <span>{selectedCall.createdByUsername}</span>
              </div>
            )}
          </div>
          <Link href={`/calls/${selectedCall.id}`}>
            <Button size="sm" className="w-full bg-[hsl(200,72%,40%)] hover:bg-[hsl(200,72%,35%)]" onClick={() => setSelectedCall(null)}>
              Open Call
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <main className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">Scheduled service calls by date</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* User filter */}
          <Select value={filterUser} onValueChange={setFilterUser}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="All Team Members" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Team Members</SelectItem>
              {users.filter(u => u.active !== 0).map(u => (
                <SelectItem key={u.id} value={u.username}>{u.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            {(["month","week","list"] as const).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize border-r last:border-r-0 transition-colors ${viewMode === v ? "bg-[hsl(200,72%,40%)] text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={viewMode === "week" ? prevWeek : prevMonth}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToday} className="text-xs">Today</Button>
        <Button variant="outline" size="sm" onClick={viewMode === "week" ? nextWeek : nextMonth}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <span className="font-semibold text-base">
          {viewMode === "week"
            ? (() => {
                const ws = new Date(currentDate);
                ws.setDate(ws.getDate() - ws.getDay());
                const we = new Date(ws); we.setDate(we.getDate() + 6);
                return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()} – ${ws.getMonth() !== we.getMonth() ? MONTH_NAMES[we.getMonth()]+" " : ""}${we.getDate()}, ${we.getFullYear()}`;
              })()
            : `${MONTH_NAMES[month]} ${year}`
          }
        </span>
      </div>

      {/* Status legend */}
      <div className="flex gap-3 flex-wrap">
        {Object.entries(DOT_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${color}`} />
            <span className="text-xs text-muted-foreground">{status}</span>
          </div>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading calendar...</div>
      )}

      {/* Views */}
      {!isLoading && viewMode === "month" && <MonthView />}
      {!isLoading && viewMode === "week" && <WeekView />}
      {!isLoading && viewMode === "list" && <ListView />}

      {/* Call detail popover */}
      <CallPopover />
    </main>
  );
}
