import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type Task = {
  id: string;
  title: string;
  source_path: string;
  status: string;
  created_at: string;
};

type Asset = {
  id: string;
  asset_type: string;
  path: string;
  created_at: string;
};

type ToolCheck = {
  name: string;
  found: boolean;
  path?: string;
  error?: string;
};

type Settings = {
  workspace_root: string;
  ffmpeg_path?: string;
  ffprobe_path?: string;
};

const emptySettings: Settings = { workspace_root: "" };

function App() {
  const [view, setView] = useState("dashboard");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [tools, setTools] = useState<ToolCheck[]>([]);
  const [message, setMessage] = useState("");

  async function refresh() {
    setTasks(await invoke<Task[]>("list_tasks"));
    setSettings(await invoke<Settings>("get_settings"));
    setTools(await invoke<ToolCheck[]>("check_ffmpeg"));
  }

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, []);

  async function loadAssets(taskId: string) {
    setSelectedTaskId(taskId);
    setAssets(await invoke<Asset[]>("list_assets", { taskId }));
    setView("library");
  }

  async function startTask(taskId: string) {
    await invoke("start_task", { taskId }).catch((error) => setMessage(String(error)));
    await refresh();
  }

  async function cancelTask(taskId: string) {
    await invoke("cancel_task", { taskId }).catch((error) => setMessage(String(error)));
    await refresh();
  }

  const summary = useMemo(() => summarize(tasks), [tasks]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">RePix Local</div>
        {["dashboard", "new", "library", "settings"].map((item) => (
          <button className={view === item ? "nav active" : "nav"} key={item} onClick={() => setView(item)}>
            {navLabel(item)}
          </button>
        ))}
      </aside>
      <section className="workspace">
        <Header message={message} onClear={() => setMessage("")} />
        {view === "dashboard" && (
          <Dashboard
            summary={summary}
            tasks={tasks}
            onOpenAssets={loadAssets}
            onStart={startTask}
            onCancel={cancelTask}
          />
        )}
        {view === "new" && <NewTask onDone={refresh} onMessage={setMessage} />}
        {view === "library" && <Library assets={assets} selectedTaskId={selectedTaskId} />}
        {view === "settings" && (
          <SettingsView settings={settings} tools={tools} onRefresh={refresh} onMessage={setMessage} />
        )}
      </section>
    </main>
  );
}

function Header(props: { message: string; onClear: () => void }) {
  return (
    <header className="topbar">
      <div>
        <h1>本地视频复刻工作台</h1>
        <p>任务、资产和日志保存在本机工作区。</p>
      </div>
      {props.message && (
        <button className="status error" onClick={props.onClear}>
          {props.message}
        </button>
      )}
    </header>
  );
}

function Dashboard(props: {
  summary: Record<string, number>;
  tasks: Task[];
  onOpenAssets: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  return (
    <div className="stack">
      <div className="metrics">
        {Object.entries(props.summary).map(([key, value]) => (
          <div className="metric" key={key}>
            <span>{metricLabel(key)}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <TaskTable
        tasks={props.tasks}
        onOpenAssets={props.onOpenAssets}
        onStart={props.onStart}
        onCancel={props.onCancel}
      />
    </div>
  );
}

function NewTask(props: { onDone: () => Promise<void>; onMessage: (value: string) => void }) {
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [sceneCount, setSceneCount] = useState(6);
  const [ratio, setRatio] = useState("16:9");
  const [subtitleLanguage, setSubtitleLanguage] = useState("zh-CN");
  const [style, setStyle] = useState("自然口播");

  async function create() {
    const configJson = { sceneCount, ratio, subtitleLanguage, style };
    await invoke("create_task", { input: { title, source_path: sourcePath, config_json: configJson } });
    props.onMessage("任务已创建");
    await props.onDone();
  }

  return (
    <form className="form" onSubmit={(event) => submit(event, create, props.onMessage)}>
      <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <label>源视频路径<input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} required /></label>
      <div className="grid two">
        <label>分镜数量<input type="number" min="1" value={sceneCount} onChange={(event) => setSceneCount(Number(event.target.value))} /></label>
        <label>输出比例<input value={ratio} onChange={(event) => setRatio(event.target.value)} /></label>
      </div>
      <div className="grid two">
        <label>字幕语言<input value={subtitleLanguage} onChange={(event) => setSubtitleLanguage(event.target.value)} /></label>
        <label>改写风格<input value={style} onChange={(event) => setStyle(event.target.value)} /></label>
      </div>
      <button className="primary" type="submit">创建任务</button>
    </form>
  );
}

function Library(props: { assets: Asset[]; selectedTaskId: string }) {
  return (
    <div className="stack">
      <h2>资产库 {props.selectedTaskId}</h2>
      <table>
        <tbody>
          {props.assets.map((asset) => (
            <tr key={asset.id}>
              <td>{asset.asset_type}</td>
              <td className="path">{asset.path}</td>
              <td>{new Date(asset.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsView(props: {
  settings: Settings;
  tools: ToolCheck[];
  onRefresh: () => Promise<void>;
  onMessage: (value: string) => void;
}) {
  return (
    <div className="stack">
      <div className="panel">
        <h2>工作区</h2>
        <code>{props.settings.workspace_root}</code>
      </div>
      <div className="panel">
        <h2>外部工具</h2>
        {props.tools.map((tool) => (
          <div className={tool.found ? "tool ok" : "tool missing"} key={tool.name}>
            <strong>{tool.name}</strong>
            <span>{tool.path ?? tool.error}</span>
          </div>
        ))}
        <button onClick={() => props.onRefresh().catch((error) => props.onMessage(String(error)))}>重新检测</button>
      </div>
      <ProviderForm onMessage={props.onMessage} />
    </div>
  );
}

function ProviderForm(props: { onMessage: (value: string) => void }) {
  const [provider, setProvider] = useState("deepseek");
  const [label, setLabel] = useState("default");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  async function saveCredential() {
    await invoke("save_provider_credential", {
      input: { provider, label, api_key: apiKey, base_url: baseUrl, model }
    });
    setApiKey("");
    props.onMessage("Provider 配置已保存");
  }

  return (
    <form className="form" onSubmit={(event) => submit(event, saveCredential, props.onMessage)}>
      <h2>Provider</h2>
      <div className="grid two">
        <label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} required /></label>
        <label>标签<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
      </div>
      <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required /></label>
      <div className="grid two">
        <label>Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label>
        <label>模型<input value={model} onChange={(event) => setModel(event.target.value)} required /></label>
      </div>
      <button className="primary" type="submit">保存 Provider</button>
    </form>
  );
}

function TaskTable(props: {
  tasks: Task[];
  onOpenAssets: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onCancel: (taskId: string) => void;
}) {
  return (
    <table>
      <thead><tr><th>标题</th><th>状态</th><th>源视频</th><th>创建时间</th><th></th></tr></thead>
      <tbody>
        {props.tasks.map((task) => (
          <tr key={task.id}>
            <td>{task.title}</td><td>{task.status}</td><td className="path">{task.source_path}</td>
            <td>{new Date(task.created_at).toLocaleString()}</td>
            <td className="actions">
              <button onClick={() => props.onStart(task.id)}>启动</button>
              <button onClick={() => props.onCancel(task.id)}>取消</button>
              <button onClick={() => props.onOpenAssets(task.id)}>资产</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function summarize(tasks: Task[]) {
  return {
    total: tasks.length,
    running: tasks.filter((task) => task.status === "running").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    failed: tasks.filter((task) => task.status === "failed").length
  };
}

function submit(event: React.FormEvent, action: () => Promise<void>, onMessage: (value: string) => void) {
  event.preventDefault();
  action().catch((error) => onMessage(String(error)));
}

function navLabel(value: string) {
  return { dashboard: "Dashboard", new: "New Task", library: "Library", settings: "Settings" }[value] ?? value;
}

function metricLabel(value: string) {
  return { total: "总任务", running: "运行中", completed: "已完成", failed: "失败" }[value] ?? value;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
