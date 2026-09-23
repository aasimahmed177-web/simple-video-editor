import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
// This file is the editor UI, outside the Remotion composition context.
/* eslint-disable @remotion/warn-native-media-tag */
import brandMark from "../../public/brand/adscade-mark.png";
import { Player, type PlayerRef } from "@remotion/player";
import { AdComposition } from "./AdComposition";
import {
  clipFrames,
  defaultBrand,
  durationFrames,
  formats,
  FPS,
  newProject,
  projectSchema,
  reviewIssues,
  timelineKey,
  toSrt,
  type Brand,
  type Caption,
  type Clip,
  type Format,
  type Media,
  type Project,
} from "./model";
import "./studio.css";

type Summary = { id: string; name: string; updatedAt: string };
type Job = {
  id: string;
  projectId: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  captions?: Caption[];
  files?: string[];
  error?: string;
};
type Spelling = { captionId: string; word: string; suggestions: string[] };
const api = async <T,>(route: string, body?: unknown): Promise<T> => {
  const res = await fetch(
    `/api/ads${route}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
};
const seconds = (n: number) =>
  `${Math.floor(n / 60)}:${(n % 60).toFixed(2).padStart(5, "0")}`;
const saveFile = (content: string, name: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const Studio = () => {
  const [project, setProject] = useState<Project>(() => newProject());
  const [presets, setPresets] = useState<Brand>(defaultBrand);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [dirty, setDirty] = useState(false),
    [ready, setReady] = useState(false);
  const [format, setFormat] = useState<Format>("vertical"),
    [tab, setTab] = useState<"subtitles" | "brand">("subtitles");
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job>(),
    [frame, setFrame] = useState(0),
    [guides, setGuides] = useState(true);
  const [spelling, setSpelling] = useState<Spelling[]>([]),
    [spellingChecked, setSpellingChecked] = useState(false);
  const [history, setHistory] = useState<Project[]>([]);
  const player = useRef<PlayerRef>(null),
    current = useRef(project),
    appliedJobs = useRef(new Set<string>());
  current.current = project;
  const locked = busy || job?.status === "running";
  const totalFrames = durationFrames(project),
    duration = totalFrames / FPS;
  const issues = reviewIssues(project);
  const pending = project.captions.filter((c) => !c.reviewed).length;
  const update = (next: Project) => {
    setHistory((h) => [...h.slice(-29), current.current]);
    setProject(next);
    setDirty(true);
    setSpellingChecked(false);
    setSpelling([]);
  };
  const changeBrand = (patch: Partial<Brand>) =>
    update({ ...project, brand: { ...project.brand, ...patch } });
  const attempt = (work: () => Promise<void>) => {
    setError("");
    setBusy(true);
    void work()
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(false));
  };
  const save = async () => {
    const checked = projectSchema.safeParse(current.current);
    if (!checked.success)
      throw new Error(checked.error.issues.map((i) => i.message).join(". "));
    const saved = await api<Project>("/projects", checked.data);
    setProject(saved);
    setDirty(false);
    setProjects(await api<Summary[]>("/projects"));
    setMessage("Project saved on this computer");
    return saved;
  };
  useEffect(() => {
    void Promise.all([
      api<Brand>("/brand"),
      api<Summary[]>("/projects"),
      api<{ transcriptionReady: boolean; jobs: Job[] }>("/status"),
    ])
      .then(async ([brand, list, status]) => {
        setPresets(brand);
        setProjects(list);
        setReady(status.transcriptionReady);
        const running = status.jobs.find((j) => j.status === "running");
        const projectId = running?.projectId ?? list[0]?.id;
        setProject(
          projectId
            ? await api<Project>(`/projects/${projectId}`)
            : newProject(brand),
        );
        const previous = projectId
          ? await api<Job[]>(`/history/${projectId}`)
          : [];
        if (running) setJob(running);
        else if (previous[0]) setJob(previous[0]);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const hasClips = project.clips.length > 0;
  useEffect(() => {
    const ref = player.current;
    if (!ref) return;
    const handler = (e: { detail: { frame: number } }) =>
      setFrame(e.detail.frame);
    ref.addEventListener("frameupdate", handler);
    return () => ref.removeEventListener("frameupdate", handler);
  }, [hasClips, project.id, format]);
  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setInterval(() => {
      void api<{ transcriptionReady: boolean; jobs: Job[] }>("/status")
        .then((status) => {
          const next = status.jobs.find((j) => j.id === job.id);
          if (!next) {
            setJob({
              ...job,
              status: "error",
              error: "The server restarted. Start the job again.",
            });
            return;
          }
          setJob(next);
          if (
            next.status === "done" &&
            next.captions &&
            next.projectId === current.current.id &&
            !appliedJobs.current.has(next.id)
          ) {
            appliedJobs.current.add(next.id);
            setProject({
              ...current.current,
              captions: next.captions,
              timingReviewed: true,
            });
            setDirty(true);
            setSpelling([]);
            setSpellingChecked(false);
          }
        })
        .catch((e: Error) => setError(e.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [job]);
  const switchProject = (id?: string) => {
    if (dirty && !window.confirm("Discard unsaved changes to this ad?")) return;
    attempt(async () => {
      setProject(
        id ? await api<Project>(`/projects/${id}`) : newProject(presets),
      );
      setDirty(false);
      setHistory([]);
      setSpelling([]);
      setSpellingChecked(false);
      setFrame(0);
      setMessage("");
      if (job?.status !== "running")
        setJob(id ? (await api<Job[]>(`/history/${id}`))[0] : undefined);
    });
  };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let next = current.current;
    for (const file of Array.from(files)) {
      if (file.size > 1_000_000_000)
        throw new Error(`${file.name} is over the 1 GB limit`);
      setMessage(`Importing ${file.name}…`);
      const res = await fetch("/api/ads/upload", {
        method: "POST",
        headers: {
          "x-file-name": encodeURIComponent(file.name),
          "Content-Type": "application/octet-stream",
        },
        body: file,
      });
      const media = (await res.json()) as Media & { error?: string };
      if (!res.ok) throw new Error(media.error);
      const clip: Clip = {
        id: crypto.randomUUID(),
        mediaId: media.id,
        start: 0,
        end: Math.floor(media.duration * FPS) / FPS,
        volume: 1,
        fit: "cover",
        x: 50,
        y: 50,
      };
      next = {
        ...next,
        name:
          next.name === "Untitled ad"
            ? file.name.replace(/\.[^.]+$/, "").slice(0, 100)
            : next.name,
        media: [...next.media, media],
        clips: media.kind === "video" ? [...next.clips, clip] : next.clips,
        musicId: media.kind === "audio" ? media.id : next.musicId,
        timingReviewed: next.captions.length ? false : next.timingReviewed,
      };
      setProject(next);
      current.current = next;
      setDirty(true);
    }
    setMessage("Footage imported. Arrange your cut before transcribing.");
  };
  const changeClips = (clips: Clip[]) => {
    const length =
      Math.max(
        1,
        clips.reduce((sum, c) => sum + clipFrames(c), 0),
      ) / FPS;
    update({
      ...project,
      clips,
      timingReviewed: project.captions.length ? false : true,
      captions: project.captions
        .filter((c) => c.start < length)
        .map((c) => ({ ...c, end: Math.min(c.end, length), reviewed: false })),
    });
  };
  const editClip = (id: string, patch: Partial<Clip>) => {
    const sourceClip = project.clips.find((c) => c.id === id)!;
    const media = project.media.find((m) => m.id === sourceClip.mediaId)!;
    if (patch.start !== undefined)
      patch.start = Math.max(
        0,
        Math.min(patch.start, sourceClip.end - 2 / FPS),
      );
    if (patch.end !== undefined)
      patch.end = Math.max(
        sourceClip.start + 2 / FPS,
        Math.min(patch.end, Math.floor(media.duration * FPS) / FPS),
      );
    const clips = project.clips.map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    );
    if ("start" in patch || "end" in patch) changeClips(clips);
    else update({ ...project, clips });
  };
  const changeCaption = (id: string, patch: Partial<Caption>) =>
    update({
      ...project,
      captions: project.captions.map((c) =>
        c.id === id
          ? {
              ...c,
              ...patch,
              reviewed: "reviewed" in patch ? patch.reviewed! : false,
            }
          : c,
      ),
    });
  const seek = (time: number) => {
    player.current?.seekTo(
      Math.min(totalFrames - 1, Math.max(0, Math.round(time * FPS))),
    );
  };
  const startJob = (type: "transcribe" | "export", requested?: Format[]) =>
    attempt(async () => {
      if (
        type === "transcribe" &&
        project.captions.length &&
        !window.confirm(
          "Replace the existing subtitles with a new transcript? Your saved project keeps the previous version until you save again.",
        )
      )
        return;
      const p = await save();
      const next = await api<Job>(`/${type}`, {
        project: p,
        formats: requested,
      });
      setJob(next);
      setMessage("");
    });
  const checkSpelling = () =>
    attempt(async () => {
      setSpelling(await api<Spelling[]>("/spellcheck", project));
      setSpellingChecked(true);
      setMessage(
        "Spelling checked. Review names, claims, and timing against the audio.",
      );
    });
  return (
    <div className="studio">
      <header className="topbar">
        <a className="identity" href="/ads.html">
          <img src={brandMark} alt="" />
          <span>
            Adscade <small>AD STUDIO</small>
          </span>
        </a>
        <div className="project-title">
          <input
            aria-label="Project name"
            value={project.name}
            maxLength={100}
            disabled={locked}
            onChange={(e) => update({ ...project, name: e.target.value })}
          />
          <span>{dirty ? "Unsaved changes" : "Saved locally"}</span>
        </div>
        <div className="header-actions">
          <button
            disabled={locked || !history.length}
            onClick={() => {
              const previous = history.at(-1)!;
              setHistory(history.slice(0, -1));
              setProject(previous);
              setDirty(true);
              setSpelling([]);
              setSpellingChecked(false);
            }}
          >
            Undo
          </button>
          <button
            disabled={locked || !dirty}
            onClick={() =>
              attempt(async () => {
                await save();
              })
            }
          >
            Save project
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="library panel">
          <div className="panel-heading">
            <h2>Projects</h2>
            <button
              className="text-button"
              disabled={locked}
              onClick={() => switchProject()}
            >
              + New ad
            </button>
          </div>
          <select
            aria-label="Saved projects"
            disabled={locked}
            value={projects.some((p) => p.id === project.id) ? project.id : ""}
            onChange={(e) => e.target.value && switchProject(e.target.value)}
          >
            <option value="">Choose a saved ad</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="section-heading">
            <h2>Your footage</h2>
            <span>{project.media.length} files</span>
          </div>
          <label className={`upload-zone ${locked ? "disabled" : ""}`}>
            <span className="upload-icon">↥</span>
            <strong>Import video or music</strong>
            <span>MP4, MOV, WebM · up to 1 GB</span>
            <input
              aria-label="Import video or music"
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/webm,.m4v,audio/mpeg,audio/wav,audio/mp4,.m4a"
              disabled={locked}
              onChange={(e) => {
                const files = e.target.files;
                attempt(() => importFiles(files));
                e.target.value = "";
              }}
            />
          </label>
          {project.media.map((m) => (
            <div className="media-row" key={m.id}>
              <span className="file-icon">
                {m.kind === "video" ? "▶" : "♫"}
              </span>
              <div>
                <strong title={m.name}>{m.name}</strong>
                <small>
                  {seconds(m.duration)} ·{" "}
                  {m.kind === "video" ? `${m.width} × ${m.height}` : "Audio"}
                </small>
              </div>
              {m.kind === "video" ? (
                <button
                  aria-label={`Add ${m.name} to cut`}
                  disabled={locked}
                  onClick={() =>
                    changeClips([
                      ...project.clips,
                      {
                        id: crypto.randomUUID(),
                        mediaId: m.id,
                        start: 0,
                        end: Math.floor(m.duration * FPS) / FPS,
                        volume: 1,
                        fit: "cover",
                        x: 50,
                        y: 50,
                      },
                    ])
                  }
                >
                  +
                </button>
              ) : null}
            </div>
          ))}
          <div className="section-heading">
            <h2>Audio</h2>
          </div>
          <fieldset disabled={locked}>
            <label>
              Background music
              <select
                value={project.musicId ?? ""}
                onChange={(e) =>
                  update({ ...project, musicId: e.target.value || null })
                }
              >
                <option value="">No music</option>
                {project.media
                  .filter((m) => m.kind === "audio")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Music volume · {Math.round(project.musicVolume * 100)}%
              <input
                type="range"
                min="0"
                max="1"
                step=".01"
                value={project.musicVolume}
                onChange={(e) =>
                  update({ ...project, musicVolume: Number(e.target.value) })
                }
              />
            </label>
          </fieldset>
          <div className="local-note">
            <span className="status-dot" />
            On this computer
            <p>
              Footage, subtitles, and exports stay local. No paid transcription
              API.
            </p>
          </div>
        </aside>
        <main className="editing-area">
          <div className="preview-toolbar">
            <div className="format-toggle">
              {(Object.keys(formats) as Format[]).map((f) => (
                <button
                  key={f}
                  aria-pressed={format === f}
                  onClick={() => setFormat(f)}
                >
                  {formats[f].label}
                </button>
              ))}
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={guides}
                onChange={(e) => setGuides(e.target.checked)}
              />
              Safe-area guide
            </label>
          </div>
          <div className="preview-stage">
            <div className={`preview-frame ${format}`}>
              {project.clips.length ? (
                <Player
                  key={`${project.id}-${format}`}
                  ref={player}
                  component={AdComposition}
                  inputProps={{ project }}
                  durationInFrames={totalFrames}
                  fps={FPS}
                  compositionWidth={formats[format].width}
                  compositionHeight={formats[format].height}
                  controls
                  acknowledgeRemotionLicense
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div className="empty-preview">
                  <img src={brandMark} alt="Adscade" />
                  <span className="eyebrow">YOUR NEXT AD STARTS HERE</span>
                  <h1>
                    Make the cut.
                    <br />
                    Keep the brand.
                  </h1>
                  <p>
                    Import your footage, polish the subtitles,
                    <br />
                    and export both placements.
                  </p>
                  <div className="preview-caption">
                    Your subtitle style, saved.
                  </div>
                </div>
              )}
              {guides ? (
                <div className="safe-guide">
                  <span>Keep key text inside</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="preview-meta">
            <span>
              {seconds(frame / FPS)}{" "}
              <span className="muted">
                / {seconds(project.clips.length ? duration : 0)}
              </span>
            </span>
            <span>
              {formats[format].width} × {formats[format].height} · 30 fps
            </span>
          </div>
          <section className="cut-panel">
            <div className="panel-heading">
              <h2>
                Your cut <span>{project.clips.length} clips</span>
              </h2>
              <span className="muted">
                Trim, reorder, or split at the playhead
              </span>
            </div>
            {!project.clips.length ? (
              <p className="empty-cut">
                Imported videos appear here in playback order.
              </p>
            ) : null}
            <fieldset disabled={locked}>
              <div className="clip-list">
                {project.clips.map((clip, index) => {
                  const media = project.media.find(
                    (m) => m.id === clip.mediaId,
                  )!;
                  const startFrame = project.clips
                    .slice(0, index)
                    .reduce((sum, c) => sum + clipFrames(c), 0);
                  const split = (frame - startFrame) / FPS + clip.start;
                  return (
                    <div className="clip-card" key={clip.id}>
                      <div className="clip-title">
                        <button
                          className="clip-number"
                          onClick={() => seek(startFrame / FPS)}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </button>
                        <strong>{media.name}</strong>
                        <div className="clip-actions">
                          <button
                            aria-label={`Move clip ${index + 1} earlier`}
                            disabled={!index}
                            onClick={() => {
                              const list = [...project.clips];
                              [list[index - 1], list[index]] = [
                                list[index],
                                list[index - 1],
                              ];
                              changeClips(list);
                            }}
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`Move clip ${index + 1} later`}
                            disabled={index === project.clips.length - 1}
                            onClick={() => {
                              const list = [...project.clips];
                              [list[index + 1], list[index]] = [
                                list[index],
                                list[index + 1],
                              ];
                              changeClips(list);
                            }}
                          >
                            ↓
                          </button>
                          <button
                            aria-label={`Remove clip ${index + 1}`}
                            onClick={() =>
                              changeClips(
                                project.clips.filter((c) => c.id !== clip.id),
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="clip-controls">
                        <label>
                          In (sec)
                          <input
                            type="number"
                            aria-label={`Clip ${index + 1} start`}
                            step=".01"
                            min="0"
                            max={clip.end - 0.04}
                            value={Number(clip.start.toFixed(3))}
                            onChange={(e) =>
                              editClip(clip.id, {
                                start: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Out (sec)
                          <input
                            type="number"
                            aria-label={`Clip ${index + 1} end`}
                            step=".01"
                            min={clip.start + 0.04}
                            max={media.duration}
                            value={Number(clip.end.toFixed(3))}
                            onChange={(e) =>
                              editClip(clip.id, { end: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Frame
                          <select
                            aria-label={`Clip ${index + 1} framing`}
                            value={clip.fit}
                            onChange={(e) =>
                              editClip(clip.id, {
                                fit: e.target.value as Clip["fit"],
                              })
                            }
                          >
                            <option value="cover">Fill / crop</option>
                            <option value="contain">Fit full video</option>
                          </select>
                        </label>
                        <label>
                          Voice
                          <input
                            type="number"
                            aria-label={`Clip ${index + 1} volume`}
                            min="0"
                            max="2"
                            step=".1"
                            value={clip.volume}
                            onChange={(e) =>
                              editClip(clip.id, {
                                volume: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="crop-controls">
                        <label>
                          Crop X
                          <input
                            aria-label={`Clip ${index + 1} crop X`}
                            type="range"
                            min="0"
                            max="100"
                            value={clip.x}
                            onChange={(e) =>
                              editClip(clip.id, { x: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Crop Y
                          <input
                            aria-label={`Clip ${index + 1} crop Y`}
                            type="range"
                            min="0"
                            max="100"
                            value={clip.y}
                            onChange={(e) =>
                              editClip(clip.id, { y: Number(e.target.value) })
                            }
                          />
                        </label>
                        <button
                          disabled={
                            split <= clip.start + 0.04 ||
                            split >= clip.end - 0.04
                          }
                          onClick={() => {
                            const list = [...project.clips];
                            list.splice(
                              index,
                              1,
                              { ...clip, end: split },
                              {
                                ...clip,
                                id: crypto.randomUUID(),
                                start: split,
                              },
                            );
                            update({ ...project, clips: list });
                          }}
                        >
                          Split here
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </section>
        </main>
        <aside className="inspector panel">
          <div className="tabs">
            <button
              aria-selected={tab === "subtitles"}
              onClick={() => setTab("subtitles")}
            >
              Subtitles
            </button>
            <button
              aria-selected={tab === "brand"}
              onClick={() => setTab("brand")}
            >
              Brand & text
            </button>
          </div>
          {tab === "subtitles" ? (
            <>
              <div className="section-heading">
                <h2>English subtitles</h2>
                <span className={`pill ${ready ? "ready" : ""}`}>
                  {ready ? "Local model ready" : "Setup needed"}
                </span>
              </div>
              <p className="helper">
                Finish your cut, then transcribe. Check the words and listen to
                each line before marking it reviewed.
              </p>
              <fieldset disabled={locked}>
                <button
                  className="primary full"
                  disabled={!ready || !project.clips.length}
                  onClick={() => startJob("transcribe")}
                >
                  {project.captions.length
                    ? "Transcribe again"
                    : "Transcribe this cut"}
                </button>
                {!ready ? (
                  <p className="helper">
                    Run <code>npm run setup:transcription</code>, then reload.
                  </p>
                ) : null}
                <div className="subtitle-tools">
                  <button
                    disabled={!project.captions.length}
                    onClick={checkSpelling}
                  >
                    Check spelling
                  </button>
                  <button
                    disabled={!project.clips.length}
                    onClick={() => {
                      const start = Math.min(
                        frame / FPS,
                        Math.max(0, duration - 1),
                      );
                      update({
                        ...project,
                        captions: [
                          ...project.captions,
                          {
                            id: crypto.randomUUID(),
                            start,
                            end: Math.min(duration, start + 2),
                            text: "New subtitle",
                            reviewed: false,
                          },
                        ].sort((a, b) => a.start - b.start),
                      });
                    }}
                  >
                    + Add line
                  </button>
                </div>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={project.subtitlesEnabled}
                    onChange={(e) =>
                      update({ ...project, subtitlesEnabled: e.target.checked })
                    }
                  />
                  Burn subtitles into video
                </label>
                {project.captions.length ? (
                  <div className="review-summary">
                    <strong>
                      {project.captions.length - pending}/
                      {project.captions.length} reviewed
                    </strong>
                    <button
                      className="text-button"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Have you checked the wording, spelling, and timing of every subtitle against the audio?",
                          )
                        )
                          update({
                            ...project,
                            timingReviewed: true,
                            captions: project.captions.map((c) => ({
                              ...c,
                              reviewed: true,
                            })),
                          });
                      }}
                    >
                      Mark all reviewed
                    </button>
                  </div>
                ) : (
                  <div className="empty-subtitles">
                    <span>Aa</span>
                    <p>
                      Your transcript will appear here.
                      <br />
                      Every line stays editable.
                    </p>
                  </div>
                )}
                {!project.timingReviewed && project.captions.length ? (
                  <p className="warning">
                    Your cut changed. Transcribe again, or review every line and
                    mark all reviewed.
                  </p>
                ) : null}
                {spellingChecked ? (
                  <p className="helper">
                    {spelling.length
                      ? `${spelling.length} possible spelling issues. Names may be correct.`
                      : "No dictionary spelling issues found. Timing and meaning still need review."}
                  </p>
                ) : null}
                <div className="caption-list">
                  {project.captions.map((c, i) => (
                    <article
                      className={`caption-card ${frame / FPS >= c.start && frame / FPS < c.end ? "active" : ""}`}
                      key={c.id}
                    >
                      <div className="caption-heading">
                        <button
                          className="text-button"
                          aria-label={`Play subtitle ${i + 1}`}
                          onClick={() => {
                            seek(c.start);
                            player.current?.play();
                          }}
                        >
                          ▶ {String(i + 1).padStart(2, "0")}
                        </button>
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            checked={c.reviewed}
                            onChange={(e) =>
                              changeCaption(c.id, {
                                reviewed: e.target.checked,
                              })
                            }
                          />
                          Reviewed
                        </label>
                        <button
                          aria-label={`Delete subtitle ${i + 1}`}
                          onClick={() =>
                            update({
                              ...project,
                              captions: project.captions.filter(
                                (item) => item.id !== c.id,
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                      <textarea
                        aria-label={`Subtitle ${i + 1} text`}
                        spellCheck
                        lang="en"
                        value={c.text}
                        maxLength={240}
                        onChange={(e) =>
                          changeCaption(c.id, { text: e.target.value })
                        }
                      />
                      <div className="caption-timing">
                        <label>
                          Start
                          <input
                            aria-label={`Subtitle ${i + 1} start`}
                            type="number"
                            step=".01"
                            min="0"
                            max={duration}
                            value={c.start}
                            onChange={(e) =>
                              changeCaption(c.id, {
                                start: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <span>→</span>
                        <label>
                          End
                          <input
                            aria-label={`Subtitle ${i + 1} end`}
                            type="number"
                            step=".01"
                            min="0"
                            max={duration}
                            value={c.end}
                            onChange={(e) =>
                              changeCaption(c.id, {
                                end: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <small
                          className={
                            c.text.length / (c.end - c.start) > 25 ? "fast" : ""
                          }
                        >
                          {Math.round(c.text.length / (c.end - c.start))}{" "}
                          chars/s
                        </small>
                      </div>
                      {spelling
                        .filter((s) => s.captionId === c.id)
                        .map((s) => (
                          <div className="spelling" key={s.word}>
                            <strong>{s.word}</strong>
                            {s.suggestions.map((word) => (
                              <button
                                key={word}
                                onClick={() =>
                                  changeCaption(c.id, {
                                    text: c.text.replace(
                                      new RegExp(
                                        `\\b${s.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                                        "g",
                                      ),
                                      word,
                                    ),
                                  })
                                }
                              >
                                {word}
                              </button>
                            ))}
                            <button
                              onClick={() =>
                                changeBrand({
                                  dictionary: [
                                    ...project.brand.dictionary,
                                    s.word,
                                  ],
                                })
                              }
                            >
                              Keep word
                            </button>
                          </div>
                        ))}
                    </article>
                  ))}
                </div>
                <button
                  className="full"
                  disabled={!project.captions.length}
                  onClick={() =>
                    saveFile(toSrt(project.captions), `${project.name}.srt`)
                  }
                >
                  Download subtitles (.srt)
                </button>
                <button
                  className="text-button"
                  disabled={!project.clips.length}
                  onClick={() =>
                    attempt(async () => {
                      const result = await api<{
                        captions: Caption[];
                        sourceClips: Clip[];
                      }>(`/transcript/${project.id}`);
                      if (
                        timelineKey(project) !==
                        timelineKey({ ...project, clips: result.sourceClips })
                      )
                        throw new Error(
                          "That transcript belongs to a different cut. Transcribe the current cut instead.",
                        );
                      if (
                        project.captions.length &&
                        !window.confirm(
                          "Replace these subtitles with the last generated transcript? You can undo this change.",
                        )
                      )
                        return;
                      update({
                        ...project,
                        captions: result.captions,
                        timingReviewed: true,
                      });
                      setMessage(
                        "Last transcript restored. Review spelling and timing before exporting.",
                      );
                    })
                  }
                >
                  Restore last transcript
                </button>
              </fieldset>
            </>
          ) : (
            <fieldset disabled={locked} className="brand-fields">
              <div className="section-heading">
                <h2>Adscade brand preset</h2>
                <span className="pill">Reusable</span>
              </div>
              <p className="helper">
                Based on your VSL-5-2 palette and live logo. Saving the preset
                applies it to new ads; existing ads keep their own settings.
              </p>
              <div className="brand-swatch">
                {[
                  project.brand.background,
                  project.brand.accent,
                  project.brand.foreground,
                ].map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </div>
              <label>
                Brand name
                <input
                  value={project.brand.name}
                  maxLength={60}
                  onChange={(e) => changeBrand({ name: e.target.value })}
                />
              </label>
              <div className="color-fields">
                {(["background", "accent", "foreground"] as const).map(
                  (key) => (
                    <label key={key}>
                      {key}
                      <input
                        aria-label={`Brand ${key}`}
                        type="color"
                        value={project.brand[key]}
                        onChange={(e) => changeBrand({ [key]: e.target.value })}
                      />
                    </label>
                  ),
                )}
              </div>
              <label>
                Subtitle font
                <select
                  value={project.brand.font}
                  onChange={(e) =>
                    changeBrand({ font: e.target.value as Brand["font"] })
                  }
                >
                  <option>Inter Tight</option>
                  <option>Arial</option>
                  <option>Georgia</option>
                </select>
              </label>
              <label>
                Subtitle size · {project.brand.captionSize}px
                <input
                  type="range"
                  min="28"
                  max="72"
                  value={project.brand.captionSize}
                  onChange={(e) =>
                    changeBrand({ captionSize: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Subtitle height · {project.brand.captionBottom}% from bottom
                <input
                  type="range"
                  min="18"
                  max="45"
                  value={project.brand.captionBottom}
                  onChange={(e) =>
                    changeBrand({ captionBottom: Number(e.target.value) })
                  }
                />
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={project.brand.captionBackground}
                  onChange={(e) =>
                    changeBrand({ captionBackground: e.target.checked })
                  }
                />
                Subtitle background
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={project.brand.showLogo}
                  onChange={(e) => changeBrand({ showLogo: e.target.checked })}
                />
                Show Adscade logo
              </label>
              <label>
                Opening hook
                <textarea
                  maxLength={120}
                  value={project.hook}
                  placeholder="Optional opening headline"
                  onChange={(e) => update({ ...project, hook: e.target.value })}
                />
              </label>
              <label>
                Hook duration (seconds)
                <input
                  type="number"
                  min="0"
                  max="10"
                  step=".5"
                  value={project.hookSeconds}
                  onChange={(e) =>
                    update({ ...project, hookSeconds: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Call to action
                <input
                  value={project.brand.cta}
                  maxLength={80}
                  onChange={(e) => changeBrand({ cta: e.target.value })}
                />
              </label>
              <label>
                Show CTA for final seconds
                <input
                  type="number"
                  min="0"
                  max="10"
                  step=".5"
                  value={project.brand.ctaSeconds}
                  onChange={(e) =>
                    changeBrand({ ctaSeconds: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Brand dictionary
                <textarea
                  aria-label="Brand dictionary"
                  key={project.id}
                  defaultValue={project.brand.dictionary.join(", ")}
                  onBlur={(e) =>
                    changeBrand({
                      dictionary: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <small>Names and words the spelling checker should keep.</small>
              </label>
              <button
                className="primary full"
                onClick={() =>
                  attempt(async () => {
                    const brand = await api<Brand>("/brand", project.brand);
                    setPresets(brand);
                    setMessage("Brand preset saved for all new ads");
                  })
                }
              >
                Save as default brand
              </button>
              <button
                className="full"
                onClick={() =>
                  update({ ...project, brand: structuredClone(presets) })
                }
              >
                Apply saved brand to this ad
              </button>
            </fieldset>
          )}
        </aside>
      </div>
      <footer className="export-bar">
        <div className="export-status">
          <strong>
            {job?.status === "running"
              ? job.message
              : !project.clips.length
                ? "Import footage to begin."
                : issues.length
                  ? "Review the checks before exporting."
                  : "Ready for the next placement."}
          </strong>
          <span>
            {job?.status === "running"
              ? `${Math.round(job.progress * 100)}% · You can leave this tab open`
              : "H.264 MP4 · 1080px wide · Captions included when enabled"}
          </span>
        </div>
        <div className="export-actions">
          {job?.status === "running" ? (
            <button
              onClick={() =>
                attempt(async () => {
                  await api("/cancel", {});
                })
              }
            >
              Cancel job
            </button>
          ) : (
            <>
              <button
                disabled={locked || issues.length > 0}
                onClick={() => startJob("export", [format])}
              >
                Export {format === "square" ? "1:1" : "9:16"}
              </button>
              <button
                className="primary"
                disabled={locked || issues.length > 0}
                onClick={() => startJob("export", ["square", "vertical"])}
              >
                Export both placements ↗
              </button>
            </>
          )}
        </div>
      </footer>
      {error ||
      message ||
      job?.error ||
      job?.files?.length ||
      (project.clips.length > 0 && issues.length > 0) ? (
        <div className="notifications" aria-live="polite">
          {error || job?.error ? (
            <p className="error" role="alert">
              {error || job?.error}
              <button
                aria-label="Dismiss error"
                onClick={() => {
                  setError("");
                  if (job?.error) setJob(undefined);
                }}
              >
                ×
              </button>
            </p>
          ) : null}
          {message ? (
            <p>
              {message}
              <button
                aria-label="Dismiss message"
                onClick={() => setMessage("")}
              >
                ×
              </button>
            </p>
          ) : null}
          {project.clips.length > 0 && issues.length ? (
            <details>
              <summary>{issues.length} checks before export</summary>
              <ul>
                {issues.slice(0, 8).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {job?.files?.length ? (
            <div className="downloads">
              <strong>Exports ready</strong>
              {job.files.map((file) => (
                <a href={`/api/ads/download/${file}`} key={file}>
                  {file.endsWith("-1x1.mp4")
                    ? "Download 1:1 video"
                    : file.endsWith("-9x16.mp4")
                      ? "Download 9:16 video"
                      : file.endsWith(".srt")
                        ? "Subtitles (SRT)"
                        : "Edit snapshot (JSON)"}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
createRoot(document.getElementById("root")!).render(<Studio />);
