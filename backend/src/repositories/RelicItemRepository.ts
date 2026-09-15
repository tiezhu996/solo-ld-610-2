import { getDb } from "../db/sqlite";
import type { RelicItem } from "../models/RelicItem";

const COLUMNS =
  "id, relic_code, name, era, material, collection_level, storage_location, current_condition";

export const relicItemRepository = {
  findAll(): RelicItem[] {
    return getDb().prepare(`SELECT ${COLUMNS} FROM relic_item ORDER BY id`).all() as RelicItem[];
  },

  findById(id: number): RelicItem | undefined {
    return getDb().prepare(`SELECT ${COLUMNS} FROM relic_item WHERE id = ?`).get(id) as
      | RelicItem
      | undefined;
  },

  count(): number {
    return (getDb().prepare(`SELECT COUNT(*) AS n FROM relic_item`).get() as { n: number }).n;
  },

  insert(row: Partial<RelicItem> & { relic_code: string; name: string }): RelicItem {
    const res = getDb()
      .prepare(
        `INSERT INTO relic_item
           (relic_code, name, era, material, collection_level, storage_location, current_condition)
         VALUES
           (@relic_code, @name, @era, @material, @collection_level, @storage_location, @current_condition)`,
      )
      .run({
        relic_code: row.relic_code,
        name: row.name,
        era: row.era ?? null,
        material: row.material ?? null,
        collection_level: row.collection_level ?? "THREE",
        storage_location: row.storage_location ?? null,
        current_condition: row.current_condition ?? "STABLE",
      });
    return this.findById(Number(res.lastInsertRowid))!;
  },

  save(row: Record<string, unknown>): RelicItem {
    return this.insert({
      relic_code: String(row.relic_code ?? `RLC-${Date.now()}`),
      name: String(row.name ?? "未命名文物"),
      era: row.era == null ? null : String(row.era),
      material: row.material == null ? null : String(row.material),
      collection_level: row.collection_level == null ? null : String(row.collection_level),
      storage_location: row.storage_location == null ? null : String(row.storage_location),
      current_condition: row.current_condition == null ? "STABLE" : String(row.current_condition),
    });
  },
};
