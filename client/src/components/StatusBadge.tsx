import { cn, getStatusClass, getClaimClass } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        getStatusClass(status)
      )}
      data-testid={`status-badge-${status.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {status}
    </span>
  );
}

export function ClaimBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        getClaimClass(status)
      )}
      data-testid={`claim-badge-${status.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {status}
    </span>
  );
}
