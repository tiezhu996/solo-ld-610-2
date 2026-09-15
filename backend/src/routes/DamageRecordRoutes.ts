import { Router } from "express";
import { damageRecordController } from "../controllers/DamageRecordController";

const router = Router();

// 病害登记（闭环上游动作，不是转办入口）
router.get("/", damageRecordController.list);
router.post("/", damageRecordController.create);

// —— 病害 -> 修复方案闭环：仅这两条入口 ——
// 唯一提交入口
router.post("/:id/transfer", damageRecordController.transfer);
// 唯一状态回读入口
router.get("/:id/transfer", damageRecordController.transferStatus);

export default router;
