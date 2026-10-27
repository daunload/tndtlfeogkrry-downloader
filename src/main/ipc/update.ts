import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC, IPC_EVENT } from '../../shared/channels';
import { GITHUB_REPO } from '../../shared/config';
import type { UpdateInfo } from '../../shared/types';
import { destroyLmsWin } from '../window';

let updateInfo: UpdateInfo = { status: 'none', currentVersion: app.getVersion() };

function setUpdateInfo(next: Partial<UpdateInfo>): void {
  updateInfo = { ...updateInfo, ...next };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_EVENT.UPDATE_STATUS, updateInfo);
  }
}

/**
 * GitHub Release 기반 자동 업데이트.
 * 새 버전은 백그라운드에서 받아두고 앱 종료 시 설치한다 (대화상자 없음).
 */
export function initAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    setUpdateInfo({ status: 'downloading', latestVersion: info.version, percent: 0 });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateInfo({ status: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateInfo({ status: 'ready', latestVersion: info.version, percent: 100 });
  });

  autoUpdater.on('error', (err) => {
    console.error('자동 업데이트 실패:', err);
    // 새 버전을 받다가 실패한 경우에만 수동 설치 안내 (확인 단계 실패는 조용히 무시)
    if (updateInfo.status === 'downloading') {
      setUpdateInfo({
        status: 'error',
        downloadUrl: `https://github.com/${GITHUB_REPO}/releases/latest`
      });
    }
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.CHECK_FOR_UPDATE, (): UpdateInfo => updateInfo);

  ipcMain.handle(IPC.INSTALL_UPDATE, () => {
    if (updateInfo.status !== 'ready') return;
    // LMS 창은 close 시 hide만 하므로 먼저 파괴해야 mac의 quitAndInstall이 막히지 않음
    destroyLmsWin();
    // Windows: 설치 창 없이 설치 후 바로 재실행
    autoUpdater.quitAndInstall(true, true);
  });
}
