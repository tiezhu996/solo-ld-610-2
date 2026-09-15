import type { DamageStatus } from "../constants/DamageStatus";

export interface DamageRecord {
  id: number;
  relic_id: number;
  damage_type: string;
  position_desc: string;
  severity: string;
  discovered_by: string;
  discovered_at: string;
  image_url: string;
  status: DamageStatus | string;
}
