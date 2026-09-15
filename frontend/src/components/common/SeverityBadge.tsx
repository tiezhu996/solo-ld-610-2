import { StatusBadge } from "./StatusBadge";

export function SeverityBadge({ title = "SeverityBadge", value = "READY" }: { title?: string; value?: string }) {
  return <div className="shared-widget"><strong>{title}</strong><StatusBadge value={value} /></div>;
}
