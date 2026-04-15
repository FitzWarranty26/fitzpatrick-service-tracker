export function PhoneLink({ phone }: { phone: string | null | undefined }) {
  if (!phone) return <span>—</span>;
  const digits = phone.replace(/[^\d+]/g, "");
  return <a href={`tel:${digits}`} className="text-[hsl(200,72%,40%)] hover:underline">{phone}</a>;
}
