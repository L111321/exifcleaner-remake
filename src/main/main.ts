import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cleanImage } from '../core/metadata.js';

interface CleanedFile {
  inputPath: string;
  outputPath: string;
  beforeBytes: number;
  afterBytes: number;
  removed: number;
  error?: string;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1020,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#0b0f19',
    autoHideMenuBar: true,
    title: 'ExifCleaner 重制版',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('dialog:pickFiles', async (): Promise<string[]> => {
  const result = await dialog.showOpenDialog({
    title: '选择要清理的图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:pickOutputDir', async (): Promise<string> => {
  const result = await dialog.showOpenDialog({
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? '' : result.filePaths[0];
});

ipcMain.handle(
  'files:clean',
  async (_event, files: string[], outputDir: string | null): Promise<CleanedFile[]> => {
    const results: CleanedFile[] = [];

    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
    }

    for (const file of files) {
      try {
        const before = await readFile(file);
        const { data, removed } = cleanImage(before);

        const dir = outputDir || path.dirname(file);
        const ext = path.extname(file);
        const base = path.basename(file, ext);
        const outputPath = path.join(dir, `${base}-clean${ext}`);

        await writeFile(outputPath, data);

        results.push({
          inputPath: file,
          outputPath,
          beforeBytes: before.length,
          afterBytes: data.length,
          removed,
        });
      } catch (err) {
        results.push({
          inputPath: file,
          outputPath: '',
          beforeBytes: 0,
          afterBytes: 0,
          removed: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  },
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
