export const RelicCondition = ["STABLE","FRAGILE","DAMAGED","IN_RESTORATION","SEALED"] as const;
export type RelicCondition = (typeof RelicCondition)[number];
export const RelicConditionText: Record<RelicCondition, string> = Object.fromEntries(RelicCondition.map((value) => [value, value.replace(/_/g, " ")])) as Record<RelicCondition, string>;
