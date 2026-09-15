export const DamageSeverity = ["LOW","MEDIUM","HIGH","CRITICAL"] as const;
export type DamageSeverity = (typeof DamageSeverity)[number];
export const DamageSeverityText: Record<DamageSeverity, string> = Object.fromEntries(DamageSeverity.map((value) => [value, value.replace(/_/g, " ")])) as Record<DamageSeverity, string>;
