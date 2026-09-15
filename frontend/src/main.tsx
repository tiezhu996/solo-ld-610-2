import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { routes } from "./router/routes";
import { mockData } from "./mocks/seedData";
import { StatusBadge } from "./components/common/StatusBadge";
import { StatCard } from "./components/common/StatCard";
import "./styles.css";

function Page({ name }: { name: string }) {
  const entities = Object.entries(mockData);
  const total = useMemo(() => entities.reduce((sum, [, rows]) => sum + rows.length, 0), [entities]);
  return <main className="page">
    <section className="page-head">
      <div>
        <p className="eyebrow">relic-restore</p>
        <h1>{name}</h1>
      </div>
      <StatusBadge value="LOCAL_DATA" />
    </section>
    <section className="metrics">
      <StatCard label="核心模型" value={entities.length} />
      <StatCard label="本地记录" value={total} />
      <StatCard label="共享枚举" value={3} />
    </section>
    <section className="workbench">
      <div className="panel wide">
        <h2>业务数据</h2>
        <div className="table">
          {entities.map(([key, rows]) => <article key={key} className="row">
            <strong>{key}</strong><span>{rows.length} 条</span><StatusBadge value={Object.values(rows[0] ?? {})[1] as string ?? "READY"} />
          </article>)}
        </div>
      </div>
      <div className="panel">
        <h2>联动检查</h2>
        <p>页面、store、API、构造器、日志模板和枚举常量均按提示词拆分，适合评审跨文件修改能力。</p>
      </div>
    </section>
  </main>;
}

function App() {
  const [active, setActive] = useState<string>(routes[0]?.route ?? "/dashboard");
  const current = routes.find((route) => route.route === active) ?? routes[0];
  return <div className="shell">
    <aside>
      <div className="brand">文物修复档案协作平台</div>
      <nav>{routes.map((route) => <button key={route.route} className={active === route.route ? "active" : ""} onClick={() => setActive(route.route)}>{route.name}</button>)}</nav>
    </aside>
    <Page name={current?.name ?? "工作台"} />
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
