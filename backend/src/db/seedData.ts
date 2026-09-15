import type { Database } from "better-sqlite3";
import { getDb } from "./sqlite";
import { relicItemRepository } from "../repositories/RelicItemRepository";

/**
 * 幂等种子：库为空时写入 1 件文物 + 3 条不同状态的病害，便于演示闭环。
 * 重复启动不会重复插入（以 relic_item 是否为空为闸门，并在单事务内完成）。
 */
export const runSeed = (conn?: Database): { seeded: boolean } => {
  const db = conn ?? getDb();
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM relic_item`).get() as { n: number }).n;
  if (count > 0) {
    return { seeded: false };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const relic = relicItemRepository.insert({
      relic_code: "RLC-0001",
      name: "青釉莲瓣纹瓷碗",
      era: "南宋",
      material: "瓷器",
      collection_level: "ONE",
      storage_location: "陶瓷库 A-12",
      current_condition: "DAMAGED",
    });

    const now = new Date().toISOString();
    const insertDamage = db.prepare(
      `INSERT INTO damage_record
         (relic_id, damage_type, position_desc, severity, discovered_by, discovered_at, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // 1) 待转办 2) 已被在途方案锁定 3) 曾被驳回、可再次转办
    insertDamage.run(relic.id, "CRACK", "口沿处 3cm 冲裂", "HIGH", "修复师-林砚", now, "/mock/crack-1.png", "OPEN");
    insertDamage.run(relic.id, "GLAZE_LOSS", "碗心釉面剥落约 4cm²", "MEDIUM", "修复师-林砚", now, "/mock/glaze-2.png", "IN_PLAN");
    insertDamage.run(relic.id, "CHIP", "圈足小磕缺", "LOW", "档案员-苏白", now, "/mock/chip-3.png", "REJECTED");

    const damageIds = db.prepare(`SELECT id FROM damage_record ORDER BY id`).all() as Array<{ id: number }>;

    // 给"在途"病害补一条 SUBMITTED 方案，与状态保持一致（满足部分唯一索引）。
    db.prepare(
      `INSERT INTO restoration_plan
         (relic_id, damage_record_id, plan_title, method, risk_assessment, approval_status, owner_id, reject_reason, plan_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?, NULL, 1, ?, ?)`,
    ).run(
      relic.id,
      damageIds[1].id,
      "釉面回贴与随色修复方案",
      "清理、黏合、矿物颜料随色",
      "溶剂风险中等，需小面试验",
      7,
      now,
      now,
    );

    // 给"曾被驳回"病害保留一条 REJECTED 历史方案（不占唯一索引）。
    db.prepare(
      `INSERT INTO restoration_plan
         (relic_id, damage_record_id, plan_title, method, risk_assessment, approval_status, owner_id, reject_reason, plan_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'REJECTED', ?, ?, 1, ?, ?)`,
    ).run(
      relic.id,
      damageIds[2].id,
      "补配复原（初稿）",
      "石膏补配后做旧",
      "补配材料可逆性不足",
      7,
      "驳回：补配材料可逆性不足，请改用可逆材料后重新提交",
      now,
      now,
    );

    db.exec("COMMIT");
    return { seeded: true };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};
