# 숭실 LMS 비디오 다운로더

숭실대학교 LMS의 강의 영상을 다운로드할 수 있는 데스크톱 앱입니다.

## 기능

- 개별 영상 다운로드 (MP4 / MP3)
- 전체 영상 일괄 다운로드
- 강의 음성을 텍스트로 변환 (Gemini API 연동)
- 전체 다운로드 + 텍스트 변환 한번에 수행

## Gemini API 키 설정 (음성-텍스트 변환)

강의 영상의 음성을 텍스트로 변환하려면 Google Gemini API 키가 필요합니다.

### 1. API 키 발급

1. [Google AI Studio](https://aistudio.google.com/apikey)에 접속합니다.
2. Google 계정으로 로그인합니다.
3. **"API 키 만들기"** 버튼을 클릭합니다.
4. 생성된 API 키를 복사합니다.

> Gemini API는 무료 플랜으로도 사용할 수 있습니다. 자세한 요금 정보는 [Google AI 가격 페이지](https://ai.google.dev/pricing)를 참고하세요.

### 2. 앱에서 API 키 등록

1. 앱 좌측 사이드바의 **설정(⚙️) 버튼**을 클릭합니다.
2. 발급받은 API 키를 입력하고 **저장**합니다.
3. API 키는 기기에 암호화되어 안전하게 저장됩니다.

### 3. 텍스트 변환 사용

- **개별 변환**: 각 영상 카드의 텍스트 변환 버튼을 클릭합니다.
- **전체 변환**: 영상 목록 상단의 **"전체 텍스트 변환"** 버튼을 클릭하면 전체 영상을 MP3로 다운로드한 뒤 자동으로 텍스트 파일로 변환합니다.
- 변환된 텍스트는 MP3 파일과 같은 폴더에 `.txt` 파일로 저장됩니다.

## 다운로드

[Releases](https://github.com/daunload/tndtlfeogkrry-downloader/releases) 페이지에서 최신 버전을 다운로드하세요.

| OS      | 파일         |
| ------- | ------------ |
| macOS   | `.dmg`       |
| Windows | `-setup.exe` |

## macOS 설치 가이드

macOS에서는 앱을 처음 실행할 때 **"손상되었기 때문에 열 수 없습니다"** 경고가 나타날 수 있습니다.
이는 Apple 개발자 인증서로 서명되지 않은 앱에 대해 macOS가 표시하는 보안 경고입니다.

아래 명령어를 터미널에서 실행한 후 앱을 다시 열어주세요:

```bash
xattr -cr /Applications/soongsil-lms-downloader.app
```

## 개발

```bash
# 의존성 설치
pnpm install

# 개발 모드 실행
pnpm dev

# 빌드
pnpm build:mac    # macOS
pnpm build:win    # Windows
```

## 기술 스택

- Electron
- Vue 3 + TypeScript
- electron-vite
