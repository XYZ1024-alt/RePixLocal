import { Activity, Archive, FileSliders, Gauge, Settings, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import type { ViewKey } from "../types";

type NavItem = {
  key: ViewKey;
  label: string;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  { key: "dashboard", label: "Overview", icon: <Gauge size={17} /> },
  { key: "wizard", label: "Task Wizard", icon: <FileSliders size={17} /> },
  { key: "console", label: "Pipeline Console", icon: <TerminalSquare size={17} /> },
  { key: "library", label: "Asset Library", icon: <Archive size={17} /> },
  { key: "settings", label: "Settings", icon: <Settings size={17} /> }
];

export function Shell(props: {
  activeView: ViewKey;
  children: ReactNode;
  message: string;
  onClearMessage: () => void;
  onNavigate: (view: ViewKey) => void;
}) {
  return (
    <main className="app-frame">
      <aside className="nav-rail">
        <div className="brand-mark">
          <Activity size={19} />
          <span>VidReplicator AI</span>
        </div>
        <nav className="nav-stack">
          {navItems.map((item) => (
            <NavButton active={props.activeView === item.key} item={item} key={item.key} onNavigate={props.onNavigate} />
          ))}
        </nav>
        <div className="profile-card">
          <div className="avatar">RL</div>
          <div><strong>RePix Local</strong><span>Local Workspace</span></div>
        </div>
      </aside>
      <section className="content-shell">
        <TopBar message={props.message} onClearMessage={props.onClearMessage} />
        {props.children}
      </section>
    </main>
  );
}

function NavButton(props: { active: boolean; item: NavItem; onNavigate: (view: ViewKey) => void }) {
  return (
    <button className={props.active ? "nav-button active" : "nav-button"} onClick={() => props.onNavigate(props.item.key)}>
      {props.item.icon}
      <span>{props.item.label}</span>
    </button>
  );
}

function TopBar(props: { message: string; onClearMessage: () => void }) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">Local AI replication pipeline</p>
        <h1>RePix Local 工作台</h1>
      </div>
      <button className={props.message ? "system-pill warning" : "system-pill"}>
        <span className="live-dot" />
        {props.message ? "需要处理错误" : "本地系统就绪"}
      </button>
    </header>
  );
}
