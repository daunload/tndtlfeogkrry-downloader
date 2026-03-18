import { ref, onUnmounted } from 'vue'
import type { CourseItem, VideoItem } from '../types'

const isLoggedIn = ref(false)
const courses = ref<CourseItem[]>([])
const selectedCourseId = ref<string | null>(null)
const videos = ref<VideoItem[]>([])
const isLoading = ref(false)
const message = ref('')
const downloadingIds = ref<Set<string>>(new Set())
const progressMap = ref<Record<string, number>>({})
const downloadFormat = ref<'mp4' | 'mp3'>('mp4')
const isDownloadingAll = ref(false)

export function useDownloader() {
  window.api.onDownloadProgress((data) => {
    progressMap.value[data.contentId] = data.percent
  })

  onUnmounted(() => {
    window.api.removeDownloadProgress()
  })

  async function login(): Promise<void> {
    message.value = '로그인 창을 열고 있습니다...'
    const result = await window.api.openLogin()
    if (result.success) {
      isLoggedIn.value = true
      message.value = ''
      fetchCourses()
    } else {
      message.value = '로그인이 취소되었습니다.'
    }
  }

  async function fetchCourses(): Promise<void> {
    isLoading.value = true
    message.value = '과목 목록을 불러오는 중...'
    courses.value = []
    selectedCourseId.value = null
    videos.value = []

    const result = await window.api.fetchCourses()

    isLoading.value = false

    if (result.success && result.courses) {
      courses.value = result.courses
      message.value = `${result.courses.length}개의 과목을 찾았습니다.`
    } else if (result.error?.includes('로그인')) {
      isLoggedIn.value = false
      message.value = result.error
    } else {
      message.value = result.error || '과목 조회 실패'
    }
  }

  async function selectCourse(course: CourseItem): Promise<void> {
    selectedCourseId.value = course.id
    isLoading.value = true
    message.value = `${course.name} 강의 영상을 불러오는 중...`
    videos.value = []
    progressMap.value = {}

    const result = await window.api.fetchModules(course.id)

    isLoading.value = false

    if (result.success && result.videos) {
      videos.value = result.videos
      message.value = `${result.videos.length}개의 비디오를 찾았습니다.`
      if (result.videos.length === 0) {
        message.value = '다운로드 가능한 비디오가 없습니다.'
      }
    } else if (result.error?.includes('로그인')) {
      isLoggedIn.value = false
      message.value = result.error
    } else {
      message.value = result.error || '강의 목록 조회 실패'
    }
  }

  function goBackToCourses(): void {
    selectedCourseId.value = null
    videos.value = []
    progressMap.value = {}
    message.value = ''
  }

  async function downloadAll(): Promise<void> {
    if (videos.value.length === 0) return
    isDownloadingAll.value = true
    message.value = '전체 다운로드를 시작합니다...'

    for (const v of videos.value) {
      downloadingIds.value.add(v.contentId)
      progressMap.value[v.contentId] = 0
    }

    const result = await window.api.downloadAll(
      videos.value.map((v) => ({ contentId: v.contentId, title: v.title })),
      downloadFormat.value
    )

    isDownloadingAll.value = false

    if (result.error === 'cancelled') {
      for (const v of videos.value) {
        downloadingIds.value.delete(v.contentId)
        delete progressMap.value[v.contentId]
      }
      message.value = ''
      return
    }

    for (const v of videos.value) {
      downloadingIds.value.delete(v.contentId)
    }

    if (result.success && result.results) {
      for (const r of result.results) {
        const v = videos.value.find((v) => v.title === r.title)
        if (v) {
          progressMap.value[v.contentId] = r.success ? 100 : -1
        }
      }
      message.value = `전체 다운로드 완료: ${result.successCount}/${result.total}개 성공`
    } else {
      message.value = result.error || '전체 다운로드 실패'
    }
  }

  async function download(video: VideoItem): Promise<void> {
    downloadingIds.value.add(video.contentId)
    progressMap.value[video.contentId] = 0

    const result = await window.api.downloadVideo(video.contentId, video.title, downloadFormat.value)

    downloadingIds.value.delete(video.contentId)

    if (result.success) {
      progressMap.value[video.contentId] = 100
      message.value = `다운로드 완료: ${video.title}`
    } else if (result.error !== 'cancelled') {
      delete progressMap.value[video.contentId]
      message.value = `다운로드 실패 (${video.title}): ${result.error}`
    }
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}분 ${s}초`
  }

  function formatSize(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  }

  return {
    isLoggedIn,
    courses,
    selectedCourseId,
    videos,
    isLoading,
    message,
    downloadingIds,
    progressMap,
    downloadFormat,
    isDownloadingAll,
    login,
    fetchCourses,
    selectCourse,
    goBackToCourses,
    downloadAll,
    download,
    formatDuration,
    formatSize
  }
}
