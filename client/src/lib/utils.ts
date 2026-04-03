import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return "";
  try {
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return timeStr;
    const period = h >= 12 ? "PM" : "AM";
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
  } catch {
    return timeStr;
  }
}

export function formatDateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoStr;
  }
}

export function getStatusClass(status: string): string {
  const map: Record<string, string> = {
    "Scheduled": "status-scheduled",
    "In Progress": "status-in-progress",
    "Completed": "status-completed",
    "Pending Parts": "status-pending-parts",
    "Escalated": "status-escalated",
  };
  return map[status] ?? "status-scheduled";
}

export function getClaimClass(claimStatus: string): string {
  const map: Record<string, string> = {
    "Not Filed": "claim-not-filed",
    "Submitted": "claim-submitted",
    "Approved": "claim-approved",
    "Denied": "claim-denied",
    "Pending Review": "claim-pending-review",
  };
  return map[claimStatus] ?? "claim-not-filed";
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}
