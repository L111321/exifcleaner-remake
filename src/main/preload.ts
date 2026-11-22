import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('api', {
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: (): Promise<string> => ipcRenderer.invoke('dialog:pickOutputDir'),
  cleanFiles: (files: string[], outputDir: string | null): Promise<unknown[]> =>
    ipcRenderer.invoke('files:clean', files, outputDir),
  /** 拖拽文件时获取磁盘路径（Electron 32+ webUtils） */
  getFilePath: (file: File): string => webUtils.getPathForFile(file),
});
