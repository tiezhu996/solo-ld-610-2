export function StatusBadge({ value }: { value: string }) {
  return <span className={"badge " + String(value).toLowerCase().replace(/_/g, "-")}>{String(value).replace(/_/g, " ")}</span>;
}
