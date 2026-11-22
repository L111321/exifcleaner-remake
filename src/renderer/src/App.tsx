import { useMemo, useState } from 'react';

interface CleanedFile {
  inputPath: string;
  outputPath: string;
  beforeBytes: number;
  afterBytes: number;
  removed: number;
  error?: string;
}

declare global {
  interface Window {
    api: {
      pickFiles: () => Promise<string[]>;
      pickOutputDir: () => Promise<string>;
      cleanFiles: (files: string[], outputDir: string | null) => Promise<CleanedFile[]>;
      getFilePath: (file: File) => string;
    };
  }
}

function fileName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<CleanedFile[]>([]);

  const addFiles = (incoming: string[]) => {
    if (incoming.length === 0) return;
    setFiles((prev) => Array.from(new Set([...prev, ...incoming])));
    setResults([]);
  };

  const pickFiles = async () => {
    addFiles(await window.api.pickFiles());
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const p = window.api.getFilePath(file);
      if (p && /\.(jpe?g|png)$/i.test(p)) paths.push(p);
    }
    addFiles(paths);
  };

  const pickOutputDir = async () => {
    const dir = await window.api.pickOutputDir();
    if (dir) setOutputDir(dir);
  };

  const cleanAll = async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    try {
      const out = await window.api.cleanFiles(files, outputDir || null);
      setResults(out);
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    if (results.length === 0) return null;
    const ok = results.filter((r) => !r.error);
    const removedTotal = ok.reduce((sum, r) => sum + r.removed, 0);
    const savedTotal = ok.reduce((sum, r) => sum + (r.beforeBytes - r.afterBytes), 0);
    return { okCount: ok.length, failCount: results.length - ok.length, removedTotal, savedTotal };
  }, [results]);

  return (
    <div className="app">
      <header>
        <h1>
          Exif<span>Cleaner</span>
        </h1>
        <p>删掉照片里的 GPS 定位、相机型号、编辑记录 —— 文件不出本机。</p>
      </header>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={pickFiles}
      >
        <div className="dropzone-icon">🖼️</div>
        <p className="dropzone-title">把 JPG / PNG 拖到这里</p>
        <p className="dropzone-sub">或点击选择文件（支持批量）</p>
      </div>

      {files.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>
              待清理文件 <span className="count">{files.length}</span>
            </h2>
            <button className="link" onClick={() => { setFiles([]); setResults([]); }}>
              清空
            </button>
          </div>
          <ul className="file-list">
            {files.map((f) => (
              <li key={f}>
                <span className="file-name">{fileName(f)}</span>
                <span className="file-path">{f}</span>
                <button
                  className="link"
                  onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel actions">
        <div className="output-dir">
          <span>输出目录：</span>
          <code>{outputDir || '默认与源文件同目录（文件名加 -clean 后缀）'}</code>
          <button className="link" onClick={pickOutputDir}>
            更改
          </button>
        </div>
        <button
          className="primary"
          disabled={files.length === 0 || busy}
          onClick={cleanAll}
        >
          {busy ? '正在清理…' : `开始清理（${files.length} 个文件）`}
        </button>
      </section>

      {summary && (
        <section className="panel">
          <h2>处理结果</h2>
          <p className="summary">
            成功 {summary.okCount} 个{summary.failCount > 0 ? `，失败 ${summary.failCount} 个` : ''}
            ，共移除 {summary.removedTotal} 个元数据段，节省 {formatSize(summary.savedTotal)}
          </p>
          <table>
            <thead>
              <tr>
                <th>文件</th>
                <th>大小变化</th>
                <th>移除段数</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.inputPath}>
                  <td title={r.outputPath || r.inputPath}>{fileName(r.inputPath)}</td>
                  <td>
                    {r.error ? '-' : `${formatSize(r.beforeBytes)} → ${formatSize(r.afterBytes)}`}
                  </td>
                  <td>{r.error ? '-' : r.removed}</td>
                  <td>{r.error ? <span className="fail">失败：{r.error}</span> : <span className="ok">完成</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer>
        提示：EXIF 清理会移除 GPS、拍摄时间、设备型号等信息；JPEG 的 ICC 色彩配置会保留，保证颜色不变。
      </footer>
    </div>
  );
}
