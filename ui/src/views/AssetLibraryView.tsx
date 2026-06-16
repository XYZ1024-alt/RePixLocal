import { Archive, FileAudio, FileVideo, Image, Search, Upload } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import type { Asset, Task, ViewKey } from "../types";

export function AssetLibraryView(props: {
  assets: Asset[];
  tasks: Task[];
  onSelectTask: (taskId: string, view: ViewKey) => void;
}) {
  return (
    <div className="library-layout">
      <header className="library-toolbar">
        <div className="search-box"><Search size={15} /><span>搜索接口未接入，当前展示所选任务资产</span></div>
        <button><Upload size={15} /> Upload</button>
      </header>
      <section className="panel-card"><h2>Projects</h2><TaskChips tasks={props.tasks} onSelectTask={props.onSelectTask} /></section>
      <AssetSection assets={props.assets} icon={<Image size={18} />} title="Images" types={["keyframe", "generated_frame"]} />
      <AssetSection assets={props.assets} icon={<FileAudio size={18} />} title="Audio" types={["audio", "subtitle"]} />
      <AssetSection assets={props.assets} icon={<FileVideo size={18} />} title="Videos" types={["source_video", "video_segment", "final_video"]} />
    </div>
  );
}

function TaskChips(props: { tasks: Task[]; onSelectTask: (taskId: string, view: ViewKey) => void }) {
  if (props.tasks.length === 0) return <EmptyState title="暂无项目" detail="创建任务后会出现在这里。" />;
  return <div className="chip-grid">{props.tasks.map((task) => <TaskChip key={task.id} task={task} {...props} />)}</div>;
}

function TaskChip(props: { task: Task; onSelectTask: (taskId: string, view: ViewKey) => void }) {
  return (
    <button className="task-chip" onClick={() => props.onSelectTask(props.task.id, "library")}>
      <Archive size={15} /><span>{props.task.title}</span><StatusPill status={props.task.status} />
    </button>
  );
}

function AssetSection(props: { assets: Asset[]; icon: React.ReactNode; title: string; types: string[] }) {
  const assets = props.assets.filter((asset) => props.types.includes(asset.asset_type));
  return (
    <section className="panel-card">
      <h2>{props.icon}{props.title}</h2>
      {assets.length === 0 && <EmptyState title="暂无资产" detail="真实产物生成后会按类型展示。" />}
      <div className="asset-grid">{assets.map((asset) => <AssetCard asset={asset} key={asset.id} />)}</div>
    </section>
  );
}

function AssetCard(props: { asset: Asset }) {
  return (
    <article className="asset-card">
      <div className="asset-thumb"><span>{props.asset.asset_type}</span></div>
      <strong>{fileName(props.asset.path)}</strong>
      <p>{props.asset.path}</p>
      <StatusPill status="completed" />
    </article>
  );
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}
