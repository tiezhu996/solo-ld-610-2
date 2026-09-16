/**
 * 转办闭环崩溃恢复回归
 *
 * 在 转办 / 驳回 / 归档 三类写操作的 COMMIT 前、后分别 SIGKILL 整个服务进程
 * （等同掉电/kill -9），随后：
 *   1) 用与服务进程无关的独立直连在"重启前"读取已落盘状态；
 *   2) 用全新进程重启同一文件库，通过唯一回读入口 HTTP GET 校验"重启后"状态；
 * 断言两者都只按最近一次已提交版本收口——提交前崩溃整体回滚无半更新，提交后
 * 崩溃完整保留，且不出现重复在途方案。另含一个注入门控对照（未开关注入不生效）。
 *
 * 强制：真实文件持久化 + 独立进程 + 独立连接，不用 :memory:/mock/单连接串行化。
 * 连跑两遍，场景级结构摘要完全一致。
 *
 * 运行：cd backend && npm run test:crash-recovery
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

const BACKEND_DIR = path.join(__dirname, "..", "backend");
const requireFromBackend = createRequire(path.join(BACKEND_DIR, "package.json"));
const Database = requireFromBackend("better-sqlite3") as typeof import("better-sqlite3");
const TSX_CLI = path.join(BACKEND_DIR, "node_modules", "tsx", "dist", "cli.mjs");
const ACTIVE = new Set(["SUBMITTED", "APPROVED"]);

type Phase = "beforeCommit" | "afterCommit";
interface ScenarioResult {
  name: string;
  crashed: boolean;
  /** 重启前独立直连读到的结构态 */
  pre: StructuralState;
  /** 重启后 HTTP 回读到的结构态 */
  post: StructuralState;
  /** 失败后恢复动作是否成功 */
  recoverOk: boolean;
  ok: boolean;
  failureStage?: string;
  readback: string;
}

interface StructuralState {
  damage: string;
  activeCount: number;
  planStatuses: string[]; // 该病害全部方案状态，按 id 升序
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let portCursor = 31300;

const startServer = (file: string, injectionOn: boolean) => {
  const port = ++portCursor;
  const child: ChildProcess = spawn(process.execPath, [TSX_CLI, "src/main.ts"], {
    cwd: BACKEND_DIR,
    detached: true,
    env: {
      ...process.env,
      DB_PATH: file,
      PORT: String(port),
      SEED_ON_BOOT: "true",
      CRASH_INJECTION_ENABLED: injectionOn ? "true" : "false",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const base = `http://127.0.0.1:${port}`;
  const ready = (async () => {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch {
        /* waiting */
      }
      await sleep(150);
    }
    throw new Error(`server on ${port} never became ready`);
  })();
  return {
    child,
    base,
    ready,
    stop: async () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* gone */
        }
      }
      await sleep(200);
    },
  };
};

/** 发起请求；服务进程被 SIGKILL 时 fetch 以连接错误 reject，这正是预期的"已崩溃"。 */
const req = async (
  base: string,
  method: string,
  urlPath: string,
  opts: { body?: unknown; role?: string; crash?: Phase } = {},
): Promise<{ http: number; json: any; connectionDied: boolean }> => {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.role) headers["x-role"] = opts.role;
    if (opts.crash) headers["x-crash-phase"] = opts.crash;
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { http: res.status, json, connectionDied: false };
  } catch (e) {
    return { http: 0, json: null, connectionDied: /terminated|reset|fetch failed|ECONN/i.test((e as Error).message) };
  }
};

/** 独立直连读取某病害的结构态（与服务进程无关）。 */
const readStructural = (file: string, damageId: number): StructuralState => {
  const conn = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const d = conn.prepare(`SELECT status FROM damage_record WHERE id=?`).get(damageId) as { status: string };
    const plans = conn
      .prepare(`SELECT approval_status FROM restoration_plan WHERE damage_record_id=? ORDER BY id`)
      .all(damageId) as Array<{ approval_status: string }>;
    return {
      damage: d.status,
      activeCount: plans.filter((p) => ACTIVE.has(p.approval_status)).length,
      planStatuses: plans.map((p) => p.approval_status),
    };
  } finally {
    conn.close();
  }
};

const readbackHttp = async (base: string, damageId: number) => {
  const r = await req(base, "GET", `/api/damage-record/${damageId}/transfer`);
  if (r.http !== 200) return { http: r.http, state: null, text: JSON.stringify(r.json) };
  const b = r.json;
  const state: StructuralState = {
    damage: b.damage.status,
    activeCount: b.activePlan ? 1 : 0,
    planStatuses: (b.history as Array<{ approval_status: string }>)
      .slice()
      .reverse()
      .map((p) => p.approval_status), // history 为 id 倒序，转成升序与直连对齐
  };
  return { http: 200, state, text: `${state.damage}/active=${state.activeCount}/[${state.planStatuses.join(",")}]` };
};

/** 等待进程确已退出（SIGKILL 后）。 */
const waitDead = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
};

interface CrashSpec {
  name: string;
  op: "transfer" | "reject" | "archive";
  phase: Phase;
}
const SPECS: CrashSpec[] = [
  { name: "T1 转办·提交前", op: "transfer", phase: "beforeCommit" },
  { name: "T2 转办·提交后", op: "transfer", phase: "afterCommit" },
  { name: "R1 驳回·提交前", op: "reject", phase: "beforeCommit" },
  { name: "R2 驳回·提交后", op: "reject", phase: "afterCommit" },
  { name: "A1 归档·提交前", op: "archive", phase: "beforeCommit" },
  { name: "A2 归档·提交后", op: "archive", phase: "afterCommit" },
];

/**
 * 把某病害推进到目标操作的前置态：
 *  transfer：需要 OPEN（用种子 id=1，其初始 OPEN）
 *  reject  ：需要在途 SUBMITTED（转办一次）
 *  archive ：需要在途 APPROVED（转办+批准）
 */
const prepareDamage = async (base: string, op: CrashSpec["op"]): Promise<number> => {
  // 每次都新建一条 OPEN 病害，保证场景互不干扰、结构可比较
  const created = await req(base, "POST", `/api/damage-record`, {
    body: { relic_id: 1, damage_type: `CRASH_${op}_${Math.floor(performanceSkew())}` },
  });
  const damageId = created.json.id as number;
  if (op === "transfer") return damageId;
  const t = await req(base, "POST", `/api/damage-record/${damageId}/transfer`, {
    body: { plan_title: "crash-plan", owner_id: 7 },
  });
  const pid = t.json.plan.id as number;
  if (op === "reject") return damageId;
  await req(base, "POST", `/api/restoration-plan/${pid}/approve`, { role: "ADMIN" });
  return damageId;
};

// 单调序号，避免并发/重名（不依赖 Date.now 精度）
let seq = 0;
const performanceSkew = () => {
  seq += 1;
  return seq;
};

/** 触发带崩溃注入的目标操作，并返回当前在途方案 id（reject/archive 需要）。 */
const fireCrashingOp = async (base: string, op: CrashSpec["op"], damageId: number, phase: Phase) => {
  if (op === "transfer") {
    return req(base, "POST", `/api/damage-record/${damageId}/transfer`, {
      body: { plan_title: "crashing-transfer", owner_id: 7 },
      crash: phase,
    });
  }
  const rb = await req(base, "GET", `/api/damage-record/${damageId}/transfer`);
  const pid = rb.json.activePlan.id as number;
  const endpoint = op === "reject" ? "reject" : "archive";
  return req(base, "POST", `/api/restoration-plan/${pid}/${endpoint}`, {
    body: { reason: "crash reject" },
    role: "ADMIN",
    crash: phase,
  });
};

/**
 * 崩溃后的预期可恢复动作，按崩溃前落盘态在 verifyResumeWorks 中验证：
 * 失败后仍能继续正常转办或收口。
 */
const equalState = (a: StructuralState, b: StructuralState) =>
  a.damage === b.damage && a.activeCount === b.activeCount && JSON.stringify(a.planStatuses) === JSON.stringify(b.planStatuses);

const STATE_BY_OP_PHASE: Record<string, StructuralState> = {
  // 提交前崩溃：事务未提交，回滚到前置态
  "transfer|beforeCommit": { damage: "OPEN", activeCount: 0, planStatuses: [] },
  "reject|beforeCommit": { damage: "IN_PLAN", activeCount: 1, planStatuses: ["SUBMITTED"] },
  "archive|beforeCommit": { damage: "IN_PLAN", activeCount: 1, planStatuses: ["APPROVED"] },
  // 提交后崩溃：新态已落盘
  "transfer|afterCommit": { damage: "IN_PLAN", activeCount: 1, planStatuses: ["SUBMITTED"] },
  "reject|afterCommit": { damage: "REJECTED", activeCount: 0, planStatuses: ["REJECTED"] },
  "archive|afterCommit": { damage: "CLOSED", activeCount: 0, planStatuses: ["ARCHIVED"] },
};

async function runScenario(spec: CrashSpec): Promise<ScenarioResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relic-crash-"));
  const file = path.join(dir, "crash.db");

  const srv = startServer(file, true);
  await srv.ready;

  let damageId = -1;
  let crashed = false;
  let failureStage: string | undefined;

  try {
    damageId = await prepareDamage(srv.base, spec.op);
    const fired = await fireCrashingOp(srv.base, spec.op, damageId, spec.phase);
    // 注入会 SIGKILL：连接必须死亡。afterCommit 在响应返回前 kill，故两种 phase 都死。
    crashed = fired.connectionDied === true || fired.http === 0;
    if (!crashed) {
      failureStage = "注入未导致进程终止（SIGKILL 未生效）";
    }
    await waitDead(srv.child);
  } catch (e) {
    failureStage = `崩溃触发阶段异常: ${(e as Error).message}`;
  } finally {
    await srv.stop();
  }

  // 重启前：独立直连读已落盘状态
  const pre = readStructural(file, damageId);
  const expected = STATE_BY_OP_PHASE[`${spec.op}|${spec.phase}`];
  if (!equalState(pre, expected)) {
    failureStage = failureStage ?? `重启前状态=${JSON.stringify(pre)}，期望=${JSON.stringify(expected)}（疑似半更新）`;
  }
  if (pre.activeCount > 1) {
    failureStage = failureStage ?? "重启前出现重复在途方案";
  }

  // 重启：全新进程打开同一文件库
  const srv2 = startServer(file, true);
  let post: StructuralState = { damage: "?", activeCount: -1, planStatuses: [] };
  let readback = "";
  let recoverOk = false;
  try {
    await srv2.ready;
    const rb = await readbackHttp(srv2.base, damageId);
    readback = rb.text;
    if (rb.http !== 200 || !rb.state) {
      failureStage = failureStage ?? `重启后回读 HTTP ${rb.http}`;
    } else {
      post = rb.state;
      if (!equalState(post, pre)) {
        failureStage = failureStage ?? `重启改变状态：重启前=${JSON.stringify(pre)} 重启后=${JSON.stringify(post)}`;
      }
      if (!equalState(post, expected)) {
        failureStage = failureStage ?? `重启后状态不符期望：${JSON.stringify(post)} != ${JSON.stringify(expected)}`;
      }
    }

    // 失败后可恢复性验证
    recoverOk = await verifyResumeWorks(srv2.base, damageId, spec);
    if (!recoverOk) failureStage = failureStage ?? "失败后无法继续正常转办/收口";
  } finally {
    await srv2.stop();
  }

  return {
    name: spec.name,
    crashed,
    pre,
    post,
    recoverOk,
    ok: !failureStage && crashed,
    failureStage,
    readback,
  };
}

/**
 * 按崩溃收口态验证业务可继续：
 *  CLOSED   -> 再转办稳定 409 DAMAGE_CLOSED（终态正确收口）
 *  OPEN     -> 可正常转办（201）
 *  REJECTED -> 可再次转办（201）
 *  IN_PLAN  -> 在途方案仍在，可继续 批准/驳回 正常流转（用回读到的在途方案做一次驳回）
 */
const verifyResumeWorks = async (
  base: string,
  damageId: number,
  spec: CrashSpec,
): Promise<boolean> => {
  const state = STATE_BY_OP_PHASE[`${spec.op}|${spec.phase}`];
  if (state.damage === "CLOSED") {
    const r = await req(base, "POST", `/api/damage-record/${damageId}/transfer`, {
      body: { plan_title: "after-crash" },
    });
    return r.http === 409 && r.json?.code === "DAMAGE_CLOSED";
  }
  if (state.damage === "OPEN" || state.damage === "REJECTED") {
    const r = await req(base, "POST", `/api/damage-record/${damageId}/transfer`, {
      body: { plan_title: "after-crash", owner_id: 7 },
    });
    if (r.http !== 201 || r.json?.created !== true) return false;
    const after = await readbackHttp(base, damageId);
    return after.state?.damage === "IN_PLAN" && after.state.activeCount === 1;
  }
  // IN_PLAN：在途方案唯一且可正常驳回收口
  const rb = await req(base, "GET", `/api/damage-record/${damageId}/transfer`);
  const pid = rb.json.activePlan?.id;
  if (typeof pid !== "number") return false;
  const rj = await req(base, "POST", `/api/restoration-plan/${pid}/reject`, {
    body: { reason: "resume" },
    role: "ADMIN",
  });
  if (rj.http !== 200) return false;
  const after = await readbackHttp(base, damageId);
  return after.state?.damage === "REJECTED" && after.state.activeCount === 0;
};

/** 注入门控对照：不开 CRASH_INJECTION_ENABLED 时，带崩溃头的转办正常 201，进程不死。 */
const runControl = async (): Promise<{ name: string; ok: boolean; detail: string }> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relic-crash-ctrl-"));
  const file = path.join(dir, "ctrl.db");
  const srv = startServer(file, false); // 门控关闭
  await srv.ready;
  let ok = false;
  let detail = "";
  try {
    const created = await req(srv.base, "POST", `/api/damage-record`, {
      body: { relic_id: 1, damage_type: "CRASH_CONTROL" },
    });
    const damageId = created.json.id;
    const r = await req(srv.base, "POST", `/api/damage-record/${damageId}/transfer`, {
      body: { plan_title: "no-inject", owner_id: 7 },
      crash: "afterCommit", // 门控关闭时必须被忽略
    });
    // 进程仍健康
    const health = await fetch(`${srv.base}/health`).then((x) => x.ok).catch(() => false);
    const rb = await readbackHttp(srv.base, damageId);
    ok =
      r.http === 201 &&
      r.json?.created === true &&
      health === true &&
      rb.state?.damage === "IN_PLAN" &&
      rb.state.activeCount === 1;
    detail = `transfer HTTP ${r.http}, health=${health}, readback=${rb.text}`;
  } finally {
    await srv.stop();
  }
  return { name: "C0 注入门控关闭时崩溃头被忽略", ok, detail };
};

const digest = (results: ScenarioResult[], control: { ok: boolean }) =>
  JSON.stringify({
    control: control.ok,
    scenarios: results.map((r) => ({
      name: r.name,
      crashed: r.crashed,
      pre: r.pre,
      post: r.post,
      recoverOk: r.recoverOk,
      ok: r.ok,
    })),
  });

async function main() {
  const control = await runControl();

  const runPass = async () => {
    const out: ScenarioResult[] = [];
    for (const spec of SPECS) out.push(await runScenario(spec));
    return out;
  };

  const pass1 = await runPass();
  console.log(`\n===== 崩溃恢复明细（PASS 1）=====`);
  for (const r of pass1) {
    console.log(
      `${r.ok ? "✓" : "✗"} ${r.name}\n` +
        `     进程已硬终止=${r.crashed} 失败后可恢复=${r.recoverOk}\n` +
        `     重启前(独立直连): dmg=${r.pre.damage} active=${r.pre.activeCount} plans=[${r.pre.planStatuses.join(",")}]\n` +
        `     重启后(HTTP回读) : dmg=${r.post.damage} active=${r.post.activeCount} plans=[${r.post.planStatuses.join(",")}]\n` +
        `     回读 => ${r.readback}` +
        (r.failureStage ? `\n     !! 失败阶段: ${r.failureStage}` : ""),
    );
  }
  console.log(`${control.ok ? "✓" : "✗"} ${control.name} :: ${control.detail}`);

  const pass2 = await runPass();
  const same = digest(pass1, control) === digest(pass2, control);
  console.log(`\n两遍连续运行结构摘要一致：${same ? "是" : "否"}`);

  const allOk =
    control.ok &&
    same &&
    pass1.length === SPECS.length &&
    pass1.every((r) => r.ok && r.recoverOk && equalState(r.pre, r.post)) &&
    pass2.every((r) => r.ok && r.recoverOk && equalState(r.pre, r.post));

  if (!allOk) {
    if (!same) {
      console.error("PASS1:", digest(pass1, control));
      console.error("PASS2:", digest(pass2, control));
    }
    console.error("\n❌ 崩溃恢复回归失败");
    process.exit(1);
  }
  assert.ok(true);
  console.log(`\n全部通过：${SPECS.length} 个提交点中断场景 × 2 遍 + 门控对照；只按已提交版本收口，无半更新/重复在途。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
