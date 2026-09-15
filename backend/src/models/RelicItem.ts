export interface RelicItem {
  id: number;
  relic_code: string;
  name: string;
  era: string | null;
  material: string | null;
  collection_level: string | null;
  storage_location: string | null;
  current_condition: string;
}
