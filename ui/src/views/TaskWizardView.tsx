import { ChevronRight, FileVideo, Image, Mic2, PenLine, Video } from "lucide-react";
import { useState } from "react";
import { createTask } from "../api";

const steps = [
  ["Source & Basic Info", FileVideo],
  ["AI Rewrite", PenLine],
  ["Image Generation", Image],
  ["Video Generation", Video],
  ["Audio & Review", Mic2]
] as const;

export function TaskWizardView(props: { onCreated: () => Promise<void>; onMessage: (value: string) => void }) {
  const [title, setTitle] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [sceneCount, setSceneCount] = useState(6);
  const [ratio, setRatio] = useState("16:9");
  const [style, setStyle] = useState("自然口播");
  const [subtitleLanguage, setSubtitleLanguage] = useState("zh-CN");

  async function submit() {
    await createTask({ title, source_path: sourcePath, config_json: { sceneCount, ratio, style, subtitleLanguage } });
    props.onMessage("任务已创建");
    await props.onCreated();
  }

  return (
    <div className="wizard-layout">
      <aside className="step-rail">{steps.map(([label, Icon], index) => <Step index={index} Icon={Icon} key={label} label={label} />)}</aside>
      <form className="wizard-card" onSubmit={(event) => handleSubmit(event, submit, props.onMessage)}>
        <header><p className="eyebrow">Configure replication pipeline</p><h2>Create New Replication Task</h2></header>
        <Section title="Source Video">
          <label>任务标题<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label>本地视频路径<input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} required /></label>
        </Section>
        <Section title="AI Text Rewrite">
          <label>改写风格<input value={style} onChange={(event) => setStyle(event.target.value)} /></label>
          <label>字幕语言<input value={subtitleLanguage} onChange={(event) => setSubtitleLanguage(event.target.value)} /></label>
        </Section>
        <Section title="Generation Settings">
          <label>分镜数量<input min="1" type="number" value={sceneCount} onChange={(event) => setSceneCount(Number(event.target.value))} /></label>
          <label>输出比例<input value={ratio} onChange={(event) => setRatio(event.target.value)} /></label>
        </Section>
        <button className="primary-button" type="submit">Create Task <ChevronRight size={16} /></button>
      </form>
    </div>
  );
}

function Step(props: { Icon: React.ElementType; index: number; label: string }) {
  return (
    <div className={props.index === 0 ? "step-item active" : "step-item"}>
      <span>{props.index + 1}</span><props.Icon size={15} /><strong>{props.label}</strong>
    </div>
  );
}

function Section(props: { children: React.ReactNode; title: string }) {
  return <section className="form-section"><h3>{props.title}</h3><div className="form-grid">{props.children}</div></section>;
}

function handleSubmit(event: React.FormEvent, action: () => Promise<void>, onMessage: (value: string) => void) {
  event.preventDefault();
  action().catch((error) => onMessage(String(error)));
}
