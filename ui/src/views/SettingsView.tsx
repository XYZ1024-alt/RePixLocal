import { KeyRound, RefreshCw, Wrench } from "lucide-react";
import { useState } from "react";
import { saveProviderCredential } from "../api";
import type { Settings, ToolCheck } from "../types";

export function SettingsView(props: {
  settings: Settings;
  tools: ToolCheck[];
  onRefresh: () => Promise<void>;
  onMessage: (value: string) => void;
}) {
  return (
    <div className="settings-grid">
      <section className="panel-card"><h2>Workspace</h2><code>{props.settings.workspace_root}</code></section>
      <section className="panel-card"><h2><Wrench size={18} /> External Tools</h2><ToolList tools={props.tools} /><button onClick={props.onRefresh}><RefreshCw size={15} /> 重新检测</button></section>
      <ProviderForm onMessage={props.onMessage} />
    </div>
  );
}

function ToolList(props: { tools: ToolCheck[] }) {
  return <div className="tool-list">{props.tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)}</div>;
}

function ToolRow(props: { tool: ToolCheck }) {
  return (
    <div className={props.tool.found ? "tool-row ok" : "tool-row missing"}>
      <strong>{props.tool.name}</strong><span>{props.tool.path ?? props.tool.error}</span>
    </div>
  );
}

function ProviderForm(props: { onMessage: (value: string) => void }) {
  const [provider, setProvider] = useState("deepseek");
  const [label, setLabel] = useState("default");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  async function submit() {
    await saveProviderCredential({ provider, label, api_key: apiKey, base_url: baseUrl, model });
    setApiKey("");
    props.onMessage("Provider 配置已加密保存");
  }

  return (
    <form className="panel-card provider-form" onSubmit={(event) => handleSubmit(event, submit, props.onMessage)}>
      <h2><KeyRound size={18} /> Provider Credentials</h2>
      <div className="form-grid">
        <label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} required /></label>
        <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
        <label>Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required /></label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} required /></label>
      </div>
      <label>API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required /></label>
      <button className="primary-button" type="submit">保存密钥</button>
    </form>
  );
}

function handleSubmit(event: React.FormEvent, action: () => Promise<void>, onMessage: (value: string) => void) {
  event.preventDefault();
  action().catch((error) => onMessage(String(error)));
}
