import { app, ipcMain, net } from 'electron'
import { IPC } from '../../shared/channels'
import { GITHUB_REPO } from '../../shared/config'

export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  downloadUrl?: string
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.CHECK_FOR_UPDATE, async (): Promise<UpdateInfo> => {
    const currentVersion = app.getVersion()

    try {
      const data = await fetchLatestRelease()
      if (!data || !data.tag_name) {
        return { hasUpdate: false, currentVersion }
      }

      const latestVersion = data.tag_name.replace(/^v/, '')

      if (isNewerVersion(latestVersion, currentVersion)) {
        // 플랫폼에 맞는 다운로드 URL 찾기
        const asset = findPlatformAsset(data.assets || [])
        return {
          hasUpdate: true,
          currentVersion,
          latestVersion,
          downloadUrl: asset?.browser_download_url || data.html_url
        }
      }

      return { hasUpdate: false, currentVersion }
    } catch {
      return { hasUpdate: false, currentVersion }
    }
  })
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: { name: string; browser_download_url: string }[]
}

function fetchLatestRelease(): Promise<GitHubRelease> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      url: `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    })
    request.setHeader('Accept', 'application/vnd.github.v3+json')
    request.setHeader('User-Agent', 'soongsil-lms-downloader')

    let body = ''
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        body += chunk.toString()
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })
    })
    request.on('error', reject)
    request.end()
  })
}

/** semver 비교: latest가 current보다 높으면 true */
function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split('.').map(Number)
  const c = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true
    if ((l[i] || 0) < (c[i] || 0)) return false
  }
  return false
}

function findPlatformAsset(
  assets: { name: string; browser_download_url: string }[]
): { name: string; browser_download_url: string } | undefined {
  const platform = process.platform
  if (platform === 'darwin') {
    return assets.find((a) => a.name.endsWith('.dmg'))
  }
  if (platform === 'win32') {
    return assets.find((a) => a.name.endsWith('-setup.exe'))
  }
  return assets.find((a) => a.name.endsWith('.AppImage'))
}
