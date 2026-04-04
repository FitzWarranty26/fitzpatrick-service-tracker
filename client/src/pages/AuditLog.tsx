import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, ChevronLeft, ChevronRight } from "lucide-react";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  login: { label: "Login", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  login_failed: { label: "Login Failed", color: "text-red-600 bg-red-50 border-red-200" },
  password_changed: { label: "Password Changed", color: "text-amber-600 bg-amber-50 border-amber-200" },
  created_call: { label: "Created Call", color: "text-sky-600 bg-sky-50 border-sky-200" },
  edited_call: { label: "Edited Call", color: "text-blue-600 bg-blue-50 border-blue-200" },
  deleted_call: { label: "Deleted Call", color: "text-red-600 bg-red-50 border-red-200" },
  added_photo: { label: "Added Photo", color: "text-violet-600 bg-violet-50 border-violet-200" },
  deleted_photo: { label: "Deleted Photo", color: "text-red-600 bg-red-50 border-red-200" },
  added_part: { label: "Added Part", color: "text-teal-600 bg-teal-50 border-teal-200" },
  deleted_part: { label: "Deleted Part", color: "text-red-600 bg-red-50 border-red-200" },
  added_note: { label: "Added Note", color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  created_contact: { label: "Created Contact", color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  edited_contact: { label: "Edited Contact", color: "text-blue-600 bg-blue-50 border-blue-200" },
  created_user: { label: "Created User", color: "text-violet-600 bg-violet-50 border-violet-200" },
  edited_user: { label: "Edited User", color: "text-blue-600 bg-blue-50 border-blue-200" },
  deactivated_user: { label: "Deactivated User", color: "text-red-600 bg-red-50 border-red-200" },
  ran_backup: { label: "Ran Backup", color: "text-slate-600 bg-slate-50 border-slate-200" },
};

interface AuditEntry {
  id: number;
  userId: number | null;
  username: string;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

export default function AuditLog() {
  const [actionFilter, setActionFilter] = useState("__all__");
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  if (actionFilter !== "__all__") params.set("action", actionFilter);

  const { data, isLoading } = useQuery<{ entries: AuditEntry[]; total: number }>({
    queryKey: ["/api/audit-log", actionFilter, offset],
    queryFn: () => apiRequest("GET", `/api/audit-log?${params.toString()}`).then(r => r.json()),
  });

  const entries = data?.entries || [];
  const total = data?.total || 0;
  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;

  return (
    <main className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Activity Log</h1>
          <p className="text-sm text-muted-foreground">{total} entries</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground block mb-1">Action</label>
            <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setOffset(0); }}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Actions</SelectItem>
                {Object.entries(ACTION_LABELS).map(([key, val]) => (
                  <SelectItem key={key} value={key}>{val.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Log entries */}
      {isLoading ? (
        <div className="text-center text-muted-foreground text-sm py-12">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/40 mb-3" />
          <p className="font-medium">No activity log entries</p>
          <p className="text-sm text-muted-foreground mt-1">Actions will appear here as users interact with the system.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Time</th>
                  <th className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">User</th>
                  <th className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Action</th>
                  <th className="text-left p-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => {
                  const actionConf = ACTION_LABELS[entry.action] || { label: entry.action, color: "text-slate-600 bg-slate-50 border-slate-200" };
                  const time = new Date(entry.createdAt);
                  const timeStr = time.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  return (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{timeStr}</td>
                      <td className="p-3 font-medium whitespace-nowrap">{entry.username}</td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${actionConf.color}`}>{actionConf.label}</Badge>
                      </td>
                      <td className="p-3 text-muted-foreground max-w-xs truncate">
                        {entry.entityType && entry.entityId ? (
                          <span className="mr-2 text-xs bg-muted px-1.5 py-0.5 rounded">{entry.entityType} #{entry.entityId}</span>
                        ) : null}
                        {entry.details || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {(hasPrev || hasNext) && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={!hasPrev} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}>
                  <ChevronLeft className="w-4 h-4" /> Prev
                </Button>
                <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setOffset(o => o + PAGE_SIZE)}>
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
