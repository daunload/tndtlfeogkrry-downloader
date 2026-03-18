export interface CourseItem {
  id: string
  name: string
  term: string
}

export interface VideoItem {
  title: string
  contentId: string
  duration: number
  fileSize: number
  thumbnailUrl: string
  weekPosition: number
}
