/**
 * 新建病害状态污染回归
 *
 * 缺陷：POST /api/damage-record 曾直接采信请求体 status，可新建出 IN_PLAN/CLOSED
 *      等锁定/结案病害，绕过转办闭环。
 * 修复：新建只能落 OPEN；携带任何锁定/结案状态一律 400 拒绝且不产生记录；
 *      repository 强制 OPEN 做纵深防御。
 *
 * 本测试硬性要求：
 *  - 真实文件持久化（SQLite/WAL），独立进程跑真实 HTTP 服务，测试端走网络，不用
 *    :memory:/mock/单连接串行化；
 *  - 另开 readonly 独立连接做病害/方案行级指纹；
 *  - 污染请求（含重复、并发创建）不得产生记录、不得混入列表；已有病害与方案历史原样；
 *  - 正常 OPEN 新建随后能完整转办→批准→归档；整套连跑两遍结果一致。
 *
 * 运行：cd backend && npm run test:create-pollution
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

const LOCKED_OR_CLOSED = ["IN_PLAN", "REJECTED", "CLOSED"];
const EXPECTED_STAGES = 13;

interface Stage {
  stage: string;
  http: number;
  code?: string;
  inserted: number;
  ok: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const startServer = (file: string, port: number) =>
  new Promise<{ stop: () => Promise<void> }>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, "src/main.ts"], {
      cwd: BACKEND_DIR,
      detached: true,
      env: { ...process.env, DB_PATH: file, PORT: String(port), SEED_ON_BOOT: "true" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => reject(new Error("start timeout\n" + err)), 20000);
    const poll = async () => {
      for (let i = 0; i < 60; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) {
            clearTimeout(timer);
            let done = () => {};
            const closed = new Promise<void>((r) => (done = r));
            const force = setTimeout(done, 4000);
            child.on("close", () => {
              clearTimeout(force);
              done();
            });
            resolve({
              stop: async () => {
                try {
                  process.kill(-child.pid!, "SIGKILL");
                } catch {
                  child.kill("SIGKILL");
                }
                await closed;
              },
            });
            return;
          }
        } catch {
          /* waiting */
        }
        await sleep(200);
      }
      reject(new Error("health never ready\n" + err));
    };
    void poll();
  });

// worker 模式：独立进程发起一次污染创建（用于并发创建场景）
if (process.argv[2] === "pollute-worker") {
  const [, , , base, marker, status] = process.argv;
  (async () => {
    try {
      const res = await fetch(`${base}/api/damage-record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ relic_id: 1, damage_type: marker, status }),
      });
      const body = await res.json().catch(() => ({}));
      console.log(JSON.stringify({ http: res.status, code: body.code }));
    } catch (e) {
      console.log(JSON.stringify({ http: -1, code: (e as Error).message }));
    }
    process.exit(0);
  })();
} else {
  void main();
}

async function runOnce(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relic-poll-"));
  const file = path.join(dir, "poll.db");
  const port = label === "RUN1" ? 31221 : 31222;
  const base = `http://127.0.0.1:${port}`;

  const server = await startServer(file, port);
  const ro = new Database(file, { readonly: true, fileMustExist: true });

  const stages: Stage[] = [];
  const failures: string[] = [];
  const rec = (s: Stage) => {
    stages.push(s);
    if (!s.ok) {
      failures.push(`${s.stage} http=${s.http} code=${s.code} 污染记录=${s.inserted}`);
      console.error(`  ✗ ${s.stage} http=${s.http} code=${s.code} inserted=${s.inserted}`);
    }
  };

  const call = async (body: unknown) => {
    const res = await fetch(`${base}/api/damage-record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let parsed: any = {};
    try {
      parsed = await res.json();
    } catch {
      /* non-json */
    }
    return { http: res.status, code: parsed?.code as string | undefined, id: parsed?.id as number | undefined };
  };

  // 已有种子病害/方案（id 1..3）的行级指纹
  const seedFingerprint = () =>
    JSON.stringify({
      dmg: ro.prepare(`SELECT * FROM damage_record WHERE id<=3 ORDER BY id`).all().map(JSON.stringify),
      plan: ro.prepare(`SELECT * FROM restoration_plan WHERE damage_record_id<=3 ORDER BY id`).all().map(JSON.stringify),
    });

  const countMarker = (marker: string) =>
    (ro.prepare(`SELECT COUNT(*) n FROM damage_record WHERE damage_type=?`).get(marker) as { n: number }).n;

  const maxDamageId = () =>
    (ro.prepare(`SELECT COALESCE(MAX(id),0) m FROM damage_record`).get() as { m: number }).m;

  try {
    const before = seedFingerprint();
    const startMax = maxDamageId();

    // 1) 单个污染状态：逐个必须 400 且零插入
    for (const status of [...LOCKED_OR_CLOSED, "HACKED", "in_plan", " closed "]) {
      const marker = `POLL_SINGLE_${status.replace(/\s/g, "")}`;
      const r = await call({ relic_id: 1, damage_type: marker, status });
      const inserted = countMarker(marker);
      rec({
        stage: `污染状态[${status}]被拒且零记录`,
        http: r.http,
        code: r.code,
        inserted,
        ok: r.http === 400 && r.code === "DAMAGE_INVALID_INITIAL_STATUS" && inserted === 0 && r.id === undefined,
      });
    }

    // 2) 重复提交同一污染请求：依然 0 记录
    {
      const marker = "POLL_REPEAT";
      const rs = await Promise.all(
        Array.from({ length: 5 }, () => call({ relic_id: 1, damage_type: marker, status: "CLOSED" })),
      );
      const inserted = countMarker(marker);
      rec({
        stage: "重复污染提交(5 次)全部被拒零记录",
        http: rs[0].http,
        code: rs[0].code,
        inserted,
        ok: rs.every((r) => r.http === 400 && r.code === "DAMAGE_INVALID_INITIAL_STATUS") && inserted === 0,
      });
    }

    // 3) 并发创建：N 个独立进程同时提交污染请求
    {
      const marker = "POLL_CONCURRENT";
      const N = 12;
      const workers = await Promise.all(
        Array.from({ length: N }, () =>
          new Promise<{ http: number; code?: string }>((resolve) => {
            const c = spawn(process.execPath, [TSX_CLI, __filename, "pollute-worker", base, marker, "IN_PLAN"], {
              cwd: BACKEND_DIR,
              stdio: ["ignore", "pipe", "inherit"],
            });
            let out = "";
            c.stdout.on("data", (d) => (out += d.toString()));
            c.on("close", () => {
              try {
                resolve(JSON.parse(out.trim().split("\n").pop() || "{}"));
              } catch {
                resolve({ http: -1 });
              }
            });
          }),
        ),
      );
      const inserted = countMarker(marker);
      rec({
        stage: `并发污染创建(${N} 独立进程)全部被拒零记录`,
        http: workers[0].http,
        code: workers[0].code,
        inserted,
        ok: workers.every((w) => w.http === 400 && w.code === "DAMAGE_INVALID_INITIAL_STATUS") && inserted === 0,
      });
    }

    // 4) 列表不混入污染：所有 id>startMax 的病害必须是 OPEN
    {
      const nonOpenNew = ro
        .prepare(`SELECT COUNT(*) n FROM damage_record WHERE id>? AND status!='OPEN'`)
        .get(startMax) as { n: number };
      rec({
        stage: "失败污染请求未混入列表（新增病害均 OPEN）",
        http: 200,
        inserted: nonOpenNew.n,
        ok: nonOpenNew.n === 0,
      });
    }

    // 5) 正常新建：缺省 status / 显式 OPEN 都应 201 且落 OPEN
    const validMarkers: string[] = [];
    for (const [m, status] of [
      ["POLL_VALID_DEFAULT", undefined],
      ["POLL_VALID_OPEN", "OPEN"],
    ] as const) {
      const body: Record<string, unknown> = { relic_id: 1, damage_type: m, severity: "LOW" };
      if (status !== undefined) body.status = status;
      const r = await call(body);
      const row = ro.prepare(`SELECT status FROM damage_record WHERE damage_type=?`).get(m) as
        | { status: string }
        | undefined;
      validMarkers.push(m);
      rec({
        stage: `正常新建[${m}]落 OPEN`,
        http: r.http,
        inserted: r.id ? 1 : 0,
        ok: r.http === 201 && typeof r.id === "number" && row?.status === "OPEN",
      });
    }

    // 6) 已有病害与方案历史保持原样
    {
      const after = seedFingerprint();
      rec({
        stage: "已有病害(1..3)与方案历史逐字节不变",
        http: 200,
        inserted: before === after ? 0 : 1,
        ok: before === after,
      });
    }

    // 7) 正常新建随后能完整 转办→批准→归档
    {
      const allGood: boolean[] = [];
      for (const m of validMarkers) {
        const dmg = ro.prepare(`SELECT id FROM damage_record WHERE damage_type=?`).get(m) as { id: number };
        const t = await fetch(`${base}/api/damage-record/${dmg.id}/transfer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan_title: `${m}-方案` }),
        });
        const tj = await t.json();
        const pid = tj.plan?.id;
        const ap = await fetch(`${base}/api/restoration-plan/${pid}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-role": "ADMIN" },
        });
        const ar = await fetch(`${base}/api/restoration-plan/${pid}/archive`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-role": "ADMIN" },
        });
        const rb = await (await fetch(`${base}/api/damage-record/${dmg.id}/transfer`)).json();
        allGood.push(
          t.status === 201 &&
            ap.status === 200 &&
            ar.status === 200 &&
            rb.damage.status === "CLOSED" &&
            rb.activePlan === null &&
            rb.history[0].approval_status === "ARCHIVED",
        );
      }
      rec({
        stage: "正常 OPEN 新建后完整闭环收口",
        http: 200,
        inserted: allGood.filter(Boolean).length,
        ok: allGood.length === 2 && allGood.every(Boolean),
      });
    }

    if (failures.length) for (const f of failures) console.error("  ✗ " + f);
    return { stages, failures };
  } finally {
    ro.close();
    await server.stop();
  }
}

const digest = (stages: Stage[]) =>
  JSON.stringify(stages.map((s) => ({ stage: s.stage, http: s.http, code: s.code, inserted: s.inserted, ok: s.ok })));

async function main() {
  const r1 = await runOnce("RUN1");
  const r2 = await runOnce("RUN2");
  const same = digest(r1.stages) === digest(r2.stages);

  console.log(`\n===== 明细（${r1.stages.length} 阶段）=====`);
  for (const s of r1.stages) {
    console.log(`${s.ok ? "✓" : "✗"} ${s.stage.padEnd(42)} HTTP ${String(s.http).padStart(3)} ${s.code ?? ""} 污染记录=${s.inserted}`);
  }
  console.log(`\n两遍连续运行摘要一致：${same ? "是" : "否"}`);

  const allOk =
    same &&
    [r1, r2].every((r) => r.failures.length === 0 && r.stages.length === EXPECTED_STAGES && r.stages.every((s) => s.ok));
  if (!allOk) {
    if (!same) {
      console.error("RUN1:", digest(r1.stages));
      console.error("RUN2:", digest(r2.stages));
    }
    console.error("❌ 状态污染回归失败");
    process.exit(1);
  }
  console.log(`\n全部通过：${r1.stages.length} 阶段 × 2 遍；污染请求零写入/不混入列表，正常新建闭环收口。`);
  assert.ok(true);
}
