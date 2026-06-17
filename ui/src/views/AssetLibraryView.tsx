import { Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { TaskPicker } from "../components/TaskPicker";
import type { Asset, Task } from "../types";

type LibraryTab = "all" | "images" | "videos" | "audio" | "projects";

const IMAGE_TYPES = new Set(["keyframe", "generated_frame"]);
const AUDIO_TYPES = new Set(["audio"]);
const VIDEO_TYPES = new Set(["source_video", "video_segment", "final_video"]);

export function AssetLibraryView(props: {
  assets: Asset[];
  tasks: Task[];
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
}) {
  const [tab, setTab] = useState<LibraryTab>("all");
  const [query, setQuery] = useState("");

  const tabs: { key: LibraryTab; label: string }[] = [
    { key: "all", label: "All Assets" },
    { key: "images", label: "Images" },
    { key: "videos", label: "Videos" },
    { key: "audio", label: "Audio" },
    { key: "projects", label: "Projects" }
  ];

  const taskAssets = useMemo(() => {
    if (!props.selectedTaskId) return props.assets;
    return props.assets.filter((asset) => asset.task_id === props.selectedTaskId);
  }, [props.assets, props.selectedTaskId]);

  const imageAssets = useMemo(
    () => taskAssets.filter((asset) => IMAGE_TYPES.has(asset.asset_type)),
    [taskAssets]
  );
  const audioAssets = useMemo(
    () => taskAssets.filter((asset) => AUDIO_TYPES.has(asset.asset_type)),
    [taskAssets]
  );
  const videoAssets = useMemo(
    () => taskAssets.filter((asset) => VIDEO_TYPES.has(asset.asset_type)),
    [taskAssets]
  );

  const showImages = tab === "all" || tab === "images";
  const showAudio = tab === "all" || tab === "audio";
  const showVideos = tab === "all" || tab === "videos";
  const showProjects = tab === "all" || tab === "projects";

  return (
    <div className="library-layout">
      <header className="library-toolbar-v2">
        <div className="library-tabs">
          {tabs.map((t) => (
            <button
              className={tab === t.key ? "library-tab active" : "library-tab"}
              key={t.key}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="library-toolbar-actions">
          <TaskPicker
            selectedTaskId={props.selectedTaskId}
            tasks={props.tasks}
            onSelectTask={props.onSelectTask}
          />
          <label className="search-box">
            <Search size={15} />
            <input placeholder="Search assets..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </header>

      {showProjects && (
        <section className="panel-card">
          <div className="section-head">
            <h2>Projects</h2>
          </div>
          {props.tasks.length === 0 ? (
            <EmptyState message="No projects yet" />
          ) : (
            <div className="project-chips">
              {props.tasks.map((task) => (
                <button
                  className={task.id === props.selectedTaskId ? "project-chip active" : "project-chip"}
                  key={task.id}
                  onClick={() => props.onSelectTask(task.id)}
                  type="button"
                >
                  {task.title}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {showImages && (
        <section className="panel-card">
          <div className="section-head">
            <h2>Images (Storyboard Frames)</h2>
          </div>
          <AssetGrid
            assets={filterAssets(imageAssets, query)}
            className="frame-grid"
            emptyMessage="No image assets yet"
            renderItem={(asset) => (
              <article className="frame-card" key={asset.id}>
                <div
                  className="frame-thumb"
                  style={{ background: assetGradient(asset.id) }}
                />
                <span>{fileName(asset.path)}</span>
              </article>
            )}
          />
        </section>
      )}

      {showAudio && (
        <section className="panel-card">
          <h2>Audio (TTS & BGM)</h2>
          <AssetGrid
            assets={filterAssets(audioAssets, query)}
            className="audio-grid"
            emptyMessage="No audio assets yet"
            renderItem={(asset) => (
              <article className="audio-card completed" key={asset.id}>
                <button className="audio-play" type="button">
                  <Play size={14} fill="currentColor" />
                </button>
                <div className="waveform">
                  {Array.from({ length: 16 }, (_, i) => (
                    <span key={i} style={{ height: `${30 + ((i * 17) % 50)}%` }} />
                  ))}
                </div>
                <div className="audio-meta">
                  <strong>{fileName(asset.path)}</strong>
                  <span className="status-pill completed">{asset.asset_type}</span>
                </div>
              </article>
            )}
          />
        </section>
      )}

      {showVideos && (
        <section className="panel-card">
          <h2>Videos (Final MP4)</h2>
          <AssetGrid
            assets={filterAssets(videoAssets, query)}
            className="video-asset-grid"
            emptyMessage="No video assets yet"
            renderItem={(asset) => (
              <article className="video-asset-card" key={asset.id}>
                <div className="video-asset-thumb" style={{ background: assetGradient(asset.id) }}>
                  <Play size={20} />
                </div>
                <strong>{fileName(asset.path)}</strong>
                <p>{asset.asset_type}</p>
                <span className="status-pill completed">Stored</span>
              </article>
            )}
          />
        </section>
      )}
    </div>
  );
}

function AssetGrid(props: {
  assets: Asset[];
  className: string;
  emptyMessage: string;
  renderItem: (asset: Asset) => React.ReactNode;
}) {
  if (props.assets.length === 0) {
    return <EmptyState message={props.emptyMessage} />;
  }

  return <div className={props.className}>{props.assets.map(props.renderItem)}</div>;
}

function filterAssets(assets: Asset[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return assets;
  return assets.filter((asset) => fileName(asset.path).toLowerCase().includes(normalized));
}

function fileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path;
}

function assetGradient(id: string) {
  const hue = hashString(id) % 360;
  return `linear-gradient(160deg, hsl(${hue} 45% 28%), hsl(${hue + 30} 50% 42%))`;
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}