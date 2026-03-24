# TODO

### ~~1. 전체 다운로드 병렬처리~~ ✅

- [x] Worker Pool 패턴으로 최대 3개 동시 다운로드 구현 (`MAX_CONCURRENT = 3`)
- [x] `contentId` 기반 개별 진행률 독립 전송
- [x] 개별 실패 시 나머지 다운로드에 영향 없도록 에러 격리
- [x] `progressMap`으로 영상별 진행률 UI 표시

### ~~2. MP3 파일 분할~~ ✅

- [x] `splitMp3()` 함수 구현 — 19MB 초과 시 자동 분할
- [x] FFmpeg `audioCodec('copy')`로 무손실 분할
- [x] 분할 완료 후 원본 MP3 삭제
- [x] `download-progress` 이벤트의 96~100% 구간에서 splitting 상태 전송
- [x] 분할 진행 UI 표시 ("MP3 분할 중 (2/4)")

### ~~3. Gemini 연동 음성-텍스트 변환~~ ✅

- [x] `@google/generative-ai` SDK 연동 (Gemini 2.0 Flash)
- [x] `safeStorage`로 API 키 암호화 저장/로드/삭제
- [x] `transcribe-audio` — 단일 파일 변환 (분할 파일 자동 감지 및 병합)
- [x] `transcribe-batch` — 폴더 내 MP3 일괄 변환 (최대 2개 동시)
- [x] `download-and-transcribe-all` — 다운로드 + 변환 통합 워크플로우
- [x] `transcribe-progress` 이벤트 (파트별/파일별 진행률)
- [x] Rate limit 429 지수 백오프 재시도 (2s → 4s → 8s, 최대 3회)
- [x] API 키 설정 모달 UI (`ApiKeySettings.vue`)
- [x] 변환 버튼/진행률/상태 표시 (보라색 계열, `VideoCard.vue`)

---

### P0 — 필수

- [ ] **다운로드 취소** — 개별/일괄 다운로드 중단 기능. 현재 시작하면 취소 불가
- [ ] **다운로드 경로 기억** — 다운로드 완료 파일 경로를 메모리에 저장하여 텍스트 변환 시 폴더 재선택 생략

### P1 — 높음

- [ ] **선택적 다운로드 (체크박스)** — 특정 영상만 골라서 일괄 다운로드. 주차별 전체 선택 지원
- [ ] **주차별 그룹핑** — `weekPosition` 기반 시각적 그룹핑 + 접기/펼치기
- [ ] **시스템 알림** — 일괄 다운로드/변환 완료 시 OS 네이티브 알림
- [ ] **마지막 폴더 기억** — 다이얼로그의 `defaultPath`에 이전 선택 폴더 설정

### P2 — 보통

- [ ] **다운로드 큐 전체 진행** — "5/12 완료" 전체 진행 바 표시
- [x] **Gemini 모델 선택** — 설정에서 5개 Gemini 모델 중 선택 가능
- [x] **Gemini File API 지원** — inlineData(base64) / File API 전송 방식 선택 가능. 토큰 절약 및 대용량 파일 지원
- [x] **변환 진행 상태 토스트** — 텍스트 변환 중 단계별 상태(MP3 변환, 업로드, 변환, 병합)를 하단 토스트에 실시간 표시
- [ ] **텍스트 미리보기 모달** — 앱 내에서 변환 결과 텍스트 확인 + 복사
