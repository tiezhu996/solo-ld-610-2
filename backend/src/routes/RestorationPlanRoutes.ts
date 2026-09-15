import { Router } from "express";
import { restorationPlanController } from "../controllers/RestorationPlanController";
import { rbacMiddleware } from "../middlewares/rbacMiddleware";

const router = Router();

// 注意：没有通用的 POST /。修复方案只能经由
// "病害转办"唯一入口 POST /api/damage-record/:id/transfer 产生。
router.get("/", restorationPlanController.list);

// 审批动作（非转办提交入口）。rbac 中间件按角色放行。
router.post("/:id/approve", rbacMiddleware(["EXPERT", "ADMIN"]), restorationPlanController.approve);
router.post("/:id/reject", rbacMiddleware(["EXPERT", "ADMIN"]), restorationPlanController.reject);
router.post("/:id/archive", rbacMiddleware(["ARCHIVIST", "ADMIN"]), restorationPlanController.archive);

export default router;
