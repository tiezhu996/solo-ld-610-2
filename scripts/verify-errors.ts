/**
 * 转办闭环：异常与约束回归
 *
 * 硬性约束（按需求）：
 *  - 走真实文件持久化（SQLite/WAL），不用 :memory:、不用 mock、不用单连接串行化替代；
 *  - 被测服务是独立进程（真实 HTTP server），测试端通过网络调用；
 *  - 另开与服务进程无关的独立连接：一条 readonly 做行级指纹，一条读写做唯一约束探针；
 *  - 每个失败用例断言：HTTP/错误码稳定 + 病害与方案历史前后逐字节不变 + 记录可回读后果；
 *  - 失败后仍能继续正常转办；整套连跑两遍，摘要完全一致。
 *
 * 运行：cd backend && npm run test:errors
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const BACKEND_DIR = path.join(__dirname, "..", "backend");
const requireFromBackend = createRequire(path.join(BACKEND_DIR, "package.json"));
const Database = requireFromBackend("better-sqlite3") as typeof import("better-sqlite3");
const TSX_CLI = path.join(BACKEND_DIR, "node_modules", "tsx", "dist", "cli.mjs");

const ACTIVE = new Set(["SUBMITTED", "APPROVED"]);

interface StageResult {
  stage: string;
  http: number;
  code?: string;
  changed: boolean;
  readback: string;
  ok: boolean;
}

interface Failure {
  stage: string;
  detail: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const startServer = (file: string, port: number) =>
  new Promise<{ stop: () => Promise<void> }>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, "src/main.ts"], {
      cwd: BACKEND_DIR,
      detached: true,
      env: { ...process.env, DB_PATH: file, PORT: String(port), SEED_ON_BOOT: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => reject(new Error("server start timeout\n" + err)), 20000);
    const poll = async () => {
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`);
          if (res.ok) {
            clearTimeout(timer);
            let done = () => {};
            const closed = new Promise<void>((res) => (done = res));
            const forceTimer = setTimeout(done, 4000);
            child.on("close", () => {
              clearTimeout(forceTimer);
              done();
            });
            resolve({
              stop: async () => {
                // 杀整个独立进程组（SIGKILL），保证不残留孤儿 tsx/server
                try {
                  process.kill(-child.pid!, "SIGKILL");
                } catch {
                  try {
                    child.kill("SIGKILL");
                  } catch {
                    /* already gone */
                  }
                }
                await closed;
              },
            });
            return;
          }
        } catch {
          /* not up yet */
        }
        await sleep(200);
      }
      clearTimeout(timer);
      reject(new Error("health never became ready\n" + err));
    };
    void poll();
  });

async function runOnce(label: string): Promise<{ summary: StageResult[]; failures: Failure[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relic-err-"));
  const file = path.join(dir, "err.db");
  const port = label === "RUN1" ? 31201 : 31202;
  const base = `http://127.0.0.1:${port}`;

  const server = await startServer(file, port);

  // —— 与服务进程完全无关的独立连接：只读指纹 + 读写约束探针 ——
  const roConn = new Database(file, { readonly: true, fileMustExist: true });
  const rwConn = new Database(file);
  rwConn.pragma("busy_timeout = 10000");

  const failures: Failure[] = [];
  const stages: StageResult[] = [];
  const fail = (stage: string, detail: string) => {
    failures.push({ stage, detail });
    console.error(`  ✗ [${stage}] ${detail}`);
  };

  const fingerprint = () =>
    JSON.stringify({
      damage: roConn
        .prepare(`SELECT * FROM damage_record ORDER BY id`)
        .all()
        .map((r) => JSON.stringify(r)),
      plan: roConn
        .prepare(`SELECT * FROM restoration_plan ORDER BY id`)
        .all()
        .map((r) => JSON.stringify(r)),
    });

  const readbackDigest = async (damageId: number | string): Promise<string> => {
    try {
      const res = await call("GET", `${base}/api/damage-record/${damageId}/transfer`);
      if (res.status !== 200) return `READBACK_HTTP_${res.status}/${(res.body as { code?: string }).code}`;
      const b = res.body as {
        damage: { status: string };
        activePlan: { id: number } | null;
        history: Array<{ id: number; approval_status: string }>;
      };
      return `damage=${b.damage.status}|active=${b.activePlan ? b.activePlan.id : "none"}|hist=[${b.history
        .map((h) => `${h.id}:${h.approval_status}`)
        .join(",")}]`;
    } catch (e) {
      return `READBACK_ERR/${(e as Error).message}`;
    }
  };

  const call = async (
    method: string,
    url: string,
    body?: unknown,
    role?: string,
  ): Promise<{ status: number; body: unknown }> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (role) headers["x-role"] = role;
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  };

  /**
   * 失败用例统一断言：
   * 期望 http/code；调用前后病害+方案指纹必须一致；记录调用后的可回读后果。
   */
  const expectFailure = async (
    stage: string,
    fn: () => Promise<{ status: number; body: unknown }>,
    expected: { http: number; code: string },
    readbackDamageId: number | string,
  ) => {
    const before = fingerprint();
    const res = await fn();
    const after = fingerprint();
    const code = (res.body as { code?: string })?.code;
    const changed = before !== after;
    const readback = await readbackDigest(readbackDamageId);
    const ok = res.status === expected.http && code === expected.code && !changed;
    if (!ok) {
      fail(
        stage,
        `期望 HTTP ${expected.http}/${expected.code}，实际 ${res.status}/${code}；行级变化=${changed}`,
      );
    }
    stages.push({ stage, http: res.status, code, changed, readback, ok });
    return res;
  };

  /** 成功用例（用于证明失败后仍可正常转办/流转），不做指纹不变断言。 */
  const expectSuccess = async (
    stage: string,
    fn: () => Promise<{ status: number; body: unknown }>,
    expectedHttp: number,
  ) => {
    const res = await fn();
    const ok = res.status === expectedHttp;
    if (!ok) fail(stage, `期望 HTTP ${expectedHttp}，实际 ${res.status}：${JSON.stringify(res.body)}`);
    stages.push({
      stage,
      http: res.status,
      changed: true,
      readback: "success-path",
      ok,
    });
    return res;
  };

  const createDamage = async (status: string) => {
    const res = await call("POST", `${base}/api/damage-record`, {
      relic_id: 1,
      damage_type: "CRACK",
      severity: "HIGH",
      discovered_by: "regression",
      status,
    });
    return (res.body as { id: number }).id;
  };

  try {
    // 0) 基线：服务种子就绪
    {
      const list = await call("GET", `${base}/api/damage-record`);
      const rows = list.body as Array<{ id: number }>;
      if (!Array.isArray(rows) || rows.length < 3) throw new Error("种子数据异常，无法开始回归");
    }

    // —— A. 无效病害编号 ——
    await expectFailure(
      "A1 转办非数字病害编号",
      () => call("POST", `${base}/api/damage-record/abc/transfer`, { plan_title: "x" }),
      { http: 400, code: "VALIDATION_FAILED" },
      "abc",
    );
    await expectFailure(
      "A2 转办编号 0",
      () => call("POST", `${base}/api/damage-record/0/transfer`, { plan_title: "x" }),
      { http: 400, code: "VALIDATION_FAILED" },
      0,
    );
    await expectFailure(
      "A3 回读不存在病害 999999",
      () => call("GET", `${base}/api/damage-record/999999/transfer`),
      { http: 404, code: "DAMAGE_NOT_FOUND" },
      999999,
    );
    await expectFailure(
      "A4 转办不存在病害 999999",
      () => call("POST", `${base}/api/damage-record/999999/transfer`, { plan_title: "x" }),
      { http: 404, code: "DAMAGE_NOT_FOUND" },
      999999,
    );

    // —— B. 空标题 ——
    const dEmpty = await createDamage("OPEN");
    await expectFailure(
      "B1 空标题转办",
      () => call("POST", `${base}/api/damage-record/${dEmpty}/transfer`, { plan_title: "   " }),
      { http: 400, code: "VALIDATION_FAILED" },
      dEmpty,
    );
    // 失败后该病害仍可正常转办（关键恢复性断言）
    const recovered = await expectSuccess(
      "B2 空标题失败后正常转办",
      () =>
        call("POST", `${base}/api/damage-record/${dEmpty}/transfer`, {
          plan_title: "恢复性正常方案",
          owner_id: 7,
        }),
      201,
    );
    if ((recovered.body as { created?: boolean }).created !== true) {
      fail("B2 空标题失败后正常转办", "应当 created=true");
    }

    // —— C. 已结案后再转办 ——
    const dClosed = await createDamage("OPEN");
    const tClosed = await call("POST", `${base}/api/damage-record/${dClosed}/transfer`, {
      plan_title: "将被归档",
    });
    const pClosed = (tClosed.body as { plan: { id: number } }).plan.id;
    await call("POST", `${base}/api/restoration-plan/${pClosed}/approve`, {}, "ADMIN");
    await call("POST", `${base}/api/restoration-plan/${pClosed}/archive`, {}, "ADMIN");
    await expectFailure(
      "C1 已结案病害再转办",
      () => call("POST", `${base}/api/damage-record/${dClosed}/transfer`, { plan_title: "结案后" }),
      { http: 409, code: "DAMAGE_CLOSED" },
      dClosed,
    );

    // —— D. 非法状态跳转 / 重复审批 ——
    const dTrans = await createDamage("OPEN");
    const tTrans = await call("POST", `${base}/api/damage-record/${dTrans}/transfer`, {
      plan_title: "跳转用方案",
    });
    const pTrans = (tTrans.body as { plan: { id: number } }).plan.id;

    await expectFailure(
      "D1 SUBMITTED 直接归档（跳过批准）",
      () => call("POST", `${base}/api/restoration-plan/${pTrans}/archive`, {}, "ADMIN"),
      { http: 409, code: "PLAN_STATUS_CONFLICT" },
      dTrans,
    );

    // 合法驳回后，再批准/归档/驳回都应冲突
    await call("POST", `${base}/api/restoration-plan/${pTrans}/reject`, { reason: "r" }, "ADMIN");
    await expectFailure(
      "D2 驳回后再批准",
      () => call("POST", `${base}/api/restoration-plan/${pTrans}/approve`, {}, "ADMIN"),
      { http: 409, code: "PLAN_STATUS_CONFLICT" },
      dTrans,
    );
    await expectFailure(
      "D3 重复驳回",
      () => call("POST", `${base}/api/restoration-plan/${pTrans}/reject`, { reason: "r2" }, "ADMIN"),
      { http: 409, code: "PLAN_STATUS_CONFLICT" },
      dTrans,
    );
    await expectFailure(
      "D4 驳回后再归档",
      () => call("POST", `${base}/api/restoration-plan/${pTrans}/archive`, {}, "ADMIN"),
      { http: 409, code: "PLAN_STATUS_CONFLICT" },
      dTrans,
    );
    // 驳回留痕后，病害可再次正常转办
    const reRefer = await expectSuccess(
      "D5 驳回留痕后再次正常转办",
      () => call("POST", `${base}/api/damage-record/${dTrans}/transfer`, { plan_title: "重做方案" }),
      201,
    );
    if ((reRefer.body as { plan?: { id: number } }).plan?.id === pTrans) {
      fail("D5 驳回留痕后再次正常转办", "必须生成新方案而非回读已驳回方案");
    }

    // 重复批准
    const dAppr = await createDamage("OPEN");
    const tAppr = await call("POST", `${base}/api/damage-record/${dAppr}/transfer`, {
      plan_title: "批准用方案",
    });
    const pAppr = (tAppr.body as { plan: { id: number } }).plan.id;
    await call("POST", `${base}/api/restoration-plan/${pAppr}/approve`, {}, "EXPERT");
    await expectFailure(
      "D6 重复批准",
      () => call("POST", `${base}/api/restoration-plan/${pAppr}/approve`, {}, "EXPERT"),
      { http: 409, code: "PLAN_STATUS_CONFLICT" },
      dAppr,
    );

    // 对已归档方案的任何流转都冲突
    await expectFailure(
      "D7 已归档方案再批准",
      () => call("POST", `${base}/api/restoration-plan/${pClosed}/approve`, {}, "ADMIN"),
      { http: 409, code: "PLAN_STATUS_CONFLICT" },
      dClosed,
    );
    await expectFailure(
      "D8 已归档方案再驳回",
      () => call("POST", `${base}/api/restoration-plan/${pClosed}/reject`, {}, "ADMIN"),
      { http: 409, code: "PLAN_STATUS_CONFLICT" },
      dClosed,
    );

    // —— E. 无效方案编号（需带可通过 RBAC 的角色，否则会先被 403 拦截）——
    await expectFailure(
      "E1 批准编号 0",
      () => call("POST", `${base}/api/restoration-plan/0/approve`, {}, "ADMIN"),
      { http: 400, code: "VALIDATION_FAILED" },
      dTrans,
    );
    await expectFailure(
      "E2 批准不存在方案 999999",
      () => call("POST", `${base}/api/restoration-plan/999999/approve`, {}, "ADMIN"),
      { http: 404, code: "PLAN_NOT_FOUND" },
      dTrans,
    );
    await expectFailure(
      "E3 驳回不存在方案 999999",
      () => call("POST", `${base}/api/restoration-plan/999999/reject`, {}, "ADMIN"),
      { http: 404, code: "PLAN_NOT_FOUND" },
      dTrans,
    );

    // —— F. RBAC：无权角色不得流转，数据不变 ——
    await expectFailure(
      "F1 GUEST 驳回被拒",
      () => call("POST", `${base}/api/restoration-plan/${pAppr}/reject`, {}, "GUEST"),
      { http: 403, code: "RBAC_DENIED" },
      dAppr,
    );

    // —— G. 数据库唯一约束（独立读写连接绕过服务直插第二条在途方案）——
    {
      const stage = "G1 独立连接直插第二条在途方案";
      const before = fingerprint();
      const relicId = 1;
      const ts = new Date().toISOString();
      let blocked = false;
      try {
        rwConn
          .prepare(
            `INSERT INTO restoration_plan
              (relic_id, damage_record_id, plan_title, method, risk_assessment, approval_status, owner_id, reject_reason, plan_version, created_at, updated_at)
             VALUES (?, ?, 'bypass', 'x', 'x', 'SUBMITTED', 1, NULL, 1, ?, ?)`,
          )
          .run(relicId, dAppr, ts, ts);
      } catch (e) {
        blocked = (e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
      }
      const after = fingerprint();
      const activeCount = (
        roConn
          .prepare(
            `SELECT COUNT(*) n FROM restoration_plan WHERE damage_record_id=? AND approval_status IN ('SUBMITTED','APPROVED')`,
          )
          .get(dAppr) as { n: number }
      ).n;
      const ok = blocked && before === after && activeCount === 1;
      if (!ok) fail(stage, `blocked=${blocked} 变化=${before !== after} 在途数=${activeCount}`);
      stages.push({
        stage,
        http: 0,
        code: "SQLITE_CONSTRAINT_UNIQUE",
        changed: before !== after,
        readback: await readbackDigest(dAppr),
        ok,
      });
    }

    // —— H. 收尾：错误用例之后，全新病害仍可走完整 转办→批准→归档 ——
    const dEnd = await createDamage("OPEN");
    const tEnd = await call("POST", `${base}/api/damage-record/${dEnd}/transfer`, {
      plan_title: "收尾完整链路",
    });
    const pEnd = (tEnd.body as { plan: { id: number } }).plan.id;
    const ap = await call("POST", `${base}/api/restoration-plan/${pEnd}/approve`, {}, "ADMIN");
    const ar = await call("POST", `${base}/api/restoration-plan/${pEnd}/archive`, {}, "ADMIN");
    const finalRead = JSON.parse(
      ((await (await fetch(`${base}/api/damage-record/${dEnd}/transfer`)).text())),
    ) as { damage: { status: string }; activePlan: unknown; history: Array<{ approval_status: string }> };
    const endOk =
      tEnd.status === 201 &&
      ap.status === 200 &&
      ar.status === 200 &&
      finalRead.damage.status === "CLOSED" &&
      finalRead.activePlan === null &&
      finalRead.history[0].approval_status === "ARCHIVED";
    if (!endOk) fail("H1 错误用例后完整闭环仍收口", JSON.stringify({ tEnd: tEnd.status, ap: ap.status, ar: ar.status, finalRead }));
    stages.push({ stage: "H1 错误用例后完整闭环仍收口", http: ar.status, changed: true, readback: await readbackDigest(dEnd), ok: endOk });
  } catch (e) {
    failures.push({ stage: "HARNESS", detail: (e as Error).stack ?? String(e) });
  } finally {
    roConn.close();
    rwConn.close();
    await server.stop();
  }

  return { summary: stages, failures };
}

function digest(summary: StageResult[]): string {
  // 仅保留稳定字段：阶段、HTTP、错误码、是否变更、ok；不含时间戳与自增绝对值之外的易变信息
  return JSON.stringify(
    summary.map((s) => ({ stage: s.stage, http: s.http, code: s.code, changed: s.changed, ok: s.ok })),
    null,
    0,
  );
}

async function main() {
  const run1 = await runOnce("RUN1");
  console.log(`\n===== RUN1 明细（含失败阶段与可回读后果）=====`);
  for (const s of run1.summary) {
    console.log(
      `${s.ok ? "✓" : "✗"} ${s.stage.padEnd(34)} HTTP ${String(s.http).padStart(3)} ${s.code ?? ""} 变更=${s.changed}\n     回读 => ${s.readback}`,
    );
  }

  const run2 = await runOnce("RUN2");
  const same = digest(run1.summary) === digest(run2.summary);
  const allOk =
    run1.failures.length === 0 &&
    run2.failures.length === 0 &&
    run1.summary.every((s) => s.ok) &&
    run2.summary.every((s) => s.ok) &&
    same;

  console.log(`\nRUN1 用例 ${run1.summary.length}，失败 ${run1.failures.length}`);
  console.log(`RUN2 用例 ${run2.summary.length}，失败 ${run2.failures.length}`);
  console.log(`两遍连续运行摘要一致：${same ? "是" : "否"}`);

  if (!same) {
    console.error("两次运行摘要不一致：");
    console.error("RUN1:", digest(run1.summary));
    console.error("RUN2:", digest(run2.summary));
  }
  if (!allOk) {
    console.error("\n❌ 异常与约束回归存在失败阶段：");
    for (const f of [...run1.failures, ...run2.failures]) console.error(` - [${f.stage}] ${f.detail}`);
    process.exit(1);
  }
  console.log(`\n全部通过：${run1.summary.length} 个阶段 × 2 遍连续运行，错误稳定/零越权写入/失败后可恢复。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
