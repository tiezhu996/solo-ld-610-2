export const DamageSeverity = ["LOW","MEDIUM","HIGH","CRITICAL"] as const;
export type DamageSeverity = (typeof DamageSeverity)[number];
