/**
 * 闭环 HTTP 冒烟：驱动唯一提交/回读入口，覆盖重复提交、驳回、再转办。
 * 可跨"重启"重复执行：第二次运行时应回读到重启前同一条在途方案。
 * 用法：BASE=http://127.0.0.1:31110 node scripts/http-smoke.mjs
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:31110";
const j = async (r) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

const log = (...a) => console.log(...a);
const assert = (name, cond) => {
  if (!cond) {
    console.error("  ✗ " + name);
    process.exitCode = 1;
  } else {
    log("  ✓ " + name);
  }
};

const main = async () => {
  const health = await (await fetch(`${BASE}/health`)).json();
  log("health:", health.status);

  const damages = await j(await fetch(`${BASE}/api/damage-record`));
  const open = damages.find((d) => d.status === "OPEN");
  log("OPEN 病害 id =", open.id);

  const url = `${BASE}/api/damage-record/${open.id}/transfer`;

  // 第一次提交
  const r1 = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan_title: "HTTP 冒烟方案", method: "清洗加固", risk_assessment: "低", owner_id: 7 }),
  });
  const c1 = await j(r1);
  assert("首次提交 201 且 created=true", r1.status === 201 && c1.created === true);
  const planId = c1.plan.id;

  // 第二次提交（不同标题）必须回读，不新建
  const r2 = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan_title: "完全不同的第二份方案" }),
  });
  const c2 = await j(r2);
  assert("重复提交 200 且 created=false", r2.status === 200 && c2.created === false);
  assert("重复提交回读同一 planId", c2.plan.id === planId);

  // 回读
  const s1 = await j(await fetch(url));
  assert("回读在途方案 id 一致", s1.activePlan && s1.activePlan.id === planId);
  assert("回读病害 IN_PLAN", s1.damage.status === "IN_PLAN");
  assert("历史仅 1 条", s1.history.length === 1);

  // 驳回 -> 解锁
  const rej = await j(
    await fetch(`${BASE}/api/restoration-plan/${planId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-role": "EXPERT" },
      body: JSON.stringify({ reason: "材料需可逆" }),
    }),
  );
  assert("驳回后病害 REJECTED", rej.damage.status === "REJECTED");
  assert("驳回后无在途方案", rej.activePlan === null);
  assert("驳回记录保留在历史", rej.history[0].approval_status === "REJECTED");

  // 再转办 -> 新方案
  const r3 = await j(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_title: "重做方案", owner_id: 7 }),
    }),
  );
  assert("再次转办创建新方案", r3.created === true && r3.plan.id !== planId);

  const s2 = await j(await fetch(url));
  assert("回读新在途方案", s2.activePlan && s2.activePlan.id === r3.plan.id);
  assert("历史含 1 驳回 + 1 在途", s2.history.length === 2);
  console.log("ACTIVE_PLAN_ID=" + r3.plan.id);

  // RBAC：访客不能驳回
  const denied = await fetch(`${BASE}/api/restoration-plan/${r3.plan.id}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-role": "GUEST" },
    body: "{}",
  });
  assert("GUEST 驳回被拒 403", denied.status === 403);

  log(process.exitCode ? "HTTP 冒烟存在失败" : "HTTP 冒烟全部通过");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
