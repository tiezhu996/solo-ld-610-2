export const RelicCondition = ["STABLE","FRAGILE","DAMAGED","IN_RESTORATION","SEALED"] as const;
export type RelicCondition = (typeof RelicCondition)[number];
