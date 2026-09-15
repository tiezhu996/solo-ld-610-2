import express from "express";
import cors from "cors";
import { config } from "./config/env";
import { getDb } from "./db/sqlite";
import { runSeed } from "./db/seedData";
import { authMiddleware } from "./middlewares/authMiddleware";
import { auditLogMiddleware } from "./middlewares/auditLogMiddleware";
import { requestLoggerMiddleware } from "./middlewares/requestLoggerMiddleware";
import { errorHandlerMiddleware } from "./middlewares/errorHandlerMiddleware";
import relicItemRoutes from "./routes/RelicItemRoutes";
import damageRecordRoutes from "./routes/DamageRecordRoutes";
import restorationPlanRoutes from "./routes/RestorationPlanRoutes";
import restorationStepRoutes from "./routes/RestorationStepRoutes";
import imageVersionRoutes from "./routes/ImageVersionRoutes";

// 启动即建立/初始化持久库（含部分唯一索引），并幂等灌入种子。
getDb(config.dbPath);
if (config.seedOnBoot) {
  const { seeded } = runSeed();
  console.log(seeded ? "seed data inserted" : "seed data already present, skipped");
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLoggerMiddleware);
app.use(authMiddleware);
app.use(auditLogMiddleware);
app.get("/health", (_req, res) => res.json({ status: "ok", service: "relic-restore" }));
app.use("/api/relic-item", relicItemRoutes);
app.use("/api/damage-record", damageRecordRoutes);
app.use("/api/restoration-plan", restorationPlanRoutes);
app.use("/api/restoration-step", restorationStepRoutes);
app.use("/api/image-version", imageVersionRoutes);
app.use(errorHandlerMiddleware);
app.listen(config.port, () => console.log("relic-restore backend listening on", config.port));
