import { ChevronLeft, ChevronRight, FileVideo, Image, Mic2, PenLine, Video } from "lucide-react";
import { useState } from "react";
import { createTask } from "../api";
import { SCENIC_GRADIENT } from "../constants";

const steps = [
  { label: "Source & Basic Info", provider: "", Icon: FileVideo },
  { label: "AI Rewrite", provider: "DeepSeek", Icon: PenLine },
  { label: "Image Generation", provider: "Voloengine", Icon: Image },
  { label: "Video Generation", provider: "Seedance", Icon: Video },
  { label: "Audio & TTS", provider: "", Icon: Mic2 },
  { label: "Review & Submit", provider: "", Icon: FileVideo }
] as const;

export function TaskWizardView(props: { onCreated: () => Promise<void>; onMessage: (value: string) => void }) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Sample Video Title");
  const [sourceUrl, setSourceUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [prompt, setPrompt] = useState("Rewrite the transcript into an educational narration style while preserving scene structure.");
  const [style, setStyle] = useState("Educational Style");
  const [temperature, setTemperature] = useState(0.7);
  const [rewriteModel, setRewriteModel] = useState("deepseek-chat");
  const [imageModel, setImageModel] = useState("FLUX.1-schnell");
  const [resolution, setResolution] = useState("1920x1080");
  const [imageCount, setImageCount] = useState(10);
  const [videoModel, setVideoModel] = useState("seedance-1.0-pro");
  const [duration, setDuration] = useState(24);
  const [fps, setFps] = useState(24);
  const [ttsVoice, setTtsVoice] = useState("alloy");
  const [bgm, setBgm] = useState("ambient_soft");

  async function submit() {
    await createTask({
      title,
      source_path: sourceUrl,
      config_json: { style, temperature, rewriteModel, imageModel, resolution, imageCount, videoModel, duration, fps, ttsVoice, bgm }
    });
    props.onMessage("Task created successfully");
    await props.onCreated();
    setStep(0);
  }

  return (
    <div className="wizard-layout">
      <aside className="step-rail">
        {steps.map((s, index) => (
          <button
            className={index === step ? "step-item active" : index < step ? "step-item done" : "step-item"}
            key={s.label}
            onClick={() => setStep(index)}
            type="button"
          >
            <span>{index + 1}</span>
            <s.Icon size={15} />
            <div className="step-labels">
              <strong>{s.label}</strong>
              {s.provider && <small>{s.provider}</small>}
            </div>
          </button>
        ))}
      </aside>
      <div className="wizard-card">
        <StepContent
          bgm={bgm}
          duration={duration}
          fps={fps}
          imageCount={imageCount}
          imageModel={imageModel}
          prompt={prompt}
          resolution={resolution}
          rewriteModel={rewriteModel}
          sourceUrl={sourceUrl}
          step={step}
          style={style}
          temperature={temperature}
          title={title}
          ttsVoice={ttsVoice}
          videoModel={videoModel}
          onBgmChange={setBgm}
          onDurationChange={setDuration}
          onFpsChange={setFps}
          onImageCountChange={setImageCount}
          onImageModelChange={setImageModel}
          onPromptChange={setPrompt}
          onResolutionChange={setResolution}
          onRewriteModelChange={setRewriteModel}
          onSourceUrlChange={setSourceUrl}
          onStyleChange={setStyle}
          onTemperatureChange={setTemperature}
          onTitleChange={setTitle}
          onTtsVoiceChange={setTtsVoice}
          onVideoModelChange={setVideoModel}
        />
        <div className="wizard-actions">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} type="button">
              <ChevronLeft size={16} /> Back
            </button>
          )}
          <button className="ghost-button" onClick={() => setStep(0)} type="button">
            Cancel
          </button>
          {step < steps.length - 1 ? (
            <button className="primary-button" onClick={() => setStep(step + 1)} type="button">
              Next Step <ChevronRight size={16} />
            </button>
          ) : (
            <button className="primary-button" onClick={() => submit().catch((e) => props.onMessage(String(e)))} type="button">
              Submit Task <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepContent(props: {
  step: number;
  title: string;
  sourceUrl: string;
  prompt: string;
  style: string;
  temperature: number;
  rewriteModel: string;
  imageModel: string;
  resolution: string;
  imageCount: number;
  videoModel: string;
  duration: number;
  fps: number;
  ttsVoice: string;
  bgm: string;
  onTitleChange: (v: string) => void;
  onSourceUrlChange: (v: string) => void;
  onPromptChange: (v: string) => void;
  onStyleChange: (v: string) => void;
  onTemperatureChange: (v: number) => void;
  onRewriteModelChange: (v: string) => void;
  onImageModelChange: (v: string) => void;
  onResolutionChange: (v: string) => void;
  onImageCountChange: (v: number) => void;
  onVideoModelChange: (v: string) => void;
  onDurationChange: (v: number) => void;
  onFpsChange: (v: number) => void;
  onTtsVoiceChange: (v: string) => void;
  onBgmChange: (v: string) => void;
}) {
  if (props.step === 0) {
    return (
      <Section title="Source Video">
        <label>
          Video URL
          <input value={props.sourceUrl} onChange={(e) => props.onSourceUrlChange(e.target.value)} />
        </label>
        <div className="source-preview">
          <div className="source-thumb" style={{ background: SCENIC_GRADIENT }} />
          <div>
            <label>
              Title
              <input value={props.title} onChange={(e) => props.onTitleChange(e.target.value)} />
            </label>
            <button className="ghost-button" type="button">
              Change
            </button>
          </div>
        </div>
      </Section>
    );
  }
  if (props.step === 1) {
    return (
      <Section title="AI Text Rewrite (DeepSeek)">
        <label className="full-width">
          Prompt
          <textarea rows={4} value={props.prompt} onChange={(e) => props.onPromptChange(e.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Style
            <select value={props.style} onChange={(e) => props.onStyleChange(e.target.value)}>
              <option>Educational Style</option>
              <option>Documentary</option>
              <option>Casual Vlog</option>
            </select>
          </label>
          <label>
            Model
            <select value={props.rewriteModel} onChange={(e) => props.onRewriteModelChange(e.target.value)}>
              <option>deepseek-chat</option>
              <option>deepseek-reasoner</option>
            </select>
          </label>
        </div>
        <label>
          Temperature ({props.temperature})
          <input
            max="1"
            min="0"
            step="0.1"
            type="range"
            value={props.temperature}
            onChange={(e) => props.onTemperatureChange(Number(e.target.value))}
          />
        </label>
      </Section>
    );
  }
  if (props.step === 2) {
    return (
      <Section title="Image Generation (Voloengine)">
        <div className="form-grid">
          <label>
            Model
            <select value={props.imageModel} onChange={(e) => props.onImageModelChange(e.target.value)}>
              <option>FLUX.1-schnell</option>
              <option>FLUX.1-dev</option>
            </select>
          </label>
          <label>
            Resolution
            <select value={props.resolution} onChange={(e) => props.onResolutionChange(e.target.value)}>
              <option>1920x1080</option>
              <option>1280x720</option>
              <option>1080x1920</option>
            </select>
          </label>
        </div>
        <label>
          Image Count ({props.imageCount} / 50)
          <input
            max="50"
            min="1"
            type="range"
            value={props.imageCount}
            onChange={(e) => props.onImageCountChange(Number(e.target.value))}
          />
        </label>
        <button className="ghost-button" type="button">
          Advanced Settings
        </button>
      </Section>
    );
  }
  if (props.step === 3) {
    return (
      <Section title="Video Generation (Seedance)">
        <div className="form-grid">
          <label>
            Model
            <select value={props.videoModel} onChange={(e) => props.onVideoModelChange(e.target.value)}>
              <option>seedance-1.0-pro</option>
              <option>seedance-1.0-lite</option>
            </select>
          </label>
          <label>
            Duration (sec)
            <input
              min="1"
              type="number"
              value={props.duration}
              onChange={(e) => props.onDurationChange(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          FPS ({props.fps})
          <input max="60" min="12" type="range" value={props.fps} onChange={(e) => props.onFpsChange(Number(e.target.value))} />
        </label>
        <button className="ghost-button" type="button">
          Advanced Settings
        </button>
      </Section>
    );
  }
  if (props.step === 4) {
    return (
      <Section title="Audio & TTS">
        <div className="form-grid">
          <label>
            TTS Voice
            <select value={props.ttsVoice} onChange={(e) => props.onTtsVoiceChange(e.target.value)}>
              <option value="alloy">Alloy</option>
              <option value="nova">Nova</option>
              <option value="echo">Echo</option>
            </select>
          </label>
          <label>
            Background Music
            <select value={props.bgm} onChange={(e) => props.onBgmChange(e.target.value)}>
              <option value="ambient_soft">Ambient Soft</option>
              <option value="cinematic">Cinematic</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>
      </Section>
    );
  }
  return (
    <Section title="Review & Submit">
      <div className="review-grid">
        <ReviewRow label="Source" value={props.sourceUrl} />
        <ReviewRow label="Title" value={props.title} />
        <ReviewRow label="Rewrite Model" value={props.rewriteModel} />
        <ReviewRow label="Image Model" value={`${props.imageModel} · ${props.resolution} · ${props.imageCount} frames`} />
        <ReviewRow label="Video Model" value={`${props.videoModel} · ${props.duration}s · ${props.fps}fps`} />
        <ReviewRow label="Audio" value={`${props.ttsVoice} · ${props.bgm}`} />
      </div>
    </Section>
  );
}

function Section(props: { children: React.ReactNode; title: string }) {
  return (
    <section className="form-section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function ReviewRow(props: { label: string; value: string }) {
  return (
    <div className="review-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}