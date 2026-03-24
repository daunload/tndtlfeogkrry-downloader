import { app, dialog, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../../shared/channels';
import { GITHUB_REPO } from '../../shared/config';

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
}

let cachedUpdateInfo: UpdateInfo | null = null;

export function initAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    const latestVersion = info.version;
    const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/latest`;

    cachedUpdateInfo = {
      hasUpdate: true,
      currentVersion: app.getVersion(),
      latestVersion,
      downloadUrl
    };

    dialog
      .showMessageBox({
        type: 'info',
        title: '업데이트 발견',
        message: `새 버전 v${latestVersion}이 있습니다.`,
        detail:
          '자동 업데이트가 지원되지 않습니다.\n\nGitHub에서 최신 설치 파일을 다운로드한 후,\n기존 앱을 덮어쓰기 해주세요.',
        buttons: ['GitHub에서 다운로드', '나중에'],
        defaultId: 0
      })
      .then(({ response }) => {
        if (response === 0) {
          shell.openExternal(downloadUrl);
        }
      });
  });

  autoUpdater.on('update-not-available', () => {
    cachedUpdateInfo = {
      hasUpdate: false,
      currentVersion: app.getVersion()
    };
  });

  autoUpdater.on('error', () => {
    cachedUpdateInfo = {
      hasUpdate: false,
      currentVersion: app.getVersion()
    };
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.CHECK_FOR_UPDATE, async (): Promise<UpdateInfo> => {
    if (cachedUpdateInfo) return cachedUpdateInfo;

    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        return {
          hasUpdate: true,
          currentVersion: app.getVersion(),
          latestVersion: result.updateInfo.version,
          downloadUrl: `https://github.com/${GITHUB_REPO}/releases/latest`
        };
      }
    } catch {
      // 업데이트 확인 실패 시 현재 버전 정보만 반환
    }

    return { hasUpdate: false, currentVersion: app.getVersion() };
  });
}
