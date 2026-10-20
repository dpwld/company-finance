# Company Finance

[English](README.md) · 한국어

은행·카드 명세서를 가져와 기업의 거래, 지출, 예산을 관리하는 웹서비스입니다. 화면과 시스템 안내는 영어이며, 사용자가 입력하거나 가져온 원본 자료의 언어는 유지합니다.

## 설치

Git과 Node.js 22.13 이상을 준비하세요. 현재 저장소는 비공개이므로 접근 권한이 필요합니다.

```sh
git clone https://github.com/dpwld/company-finance.git
cd company-finance
npm ci
npm run setup
npm run dev
```

출력된 로컬 주소를 여세요. 로컬 실행에는 ChatGPT 계정이나 유료 API 키가 필요하지 않습니다. 초기 데이터베이스는 비어 있으며, `Category rules`에서 직접 분류를 만든 뒤 명세서를 가져옵니다.

- [필수 API·지원 파일 형식](README.md#requirements)
- [설치·업데이트·문제 해결](docs/INSTALLATION.md)
- [본인 Cloudflare 계정에 배포](docs/SELF-HOSTING.md)
- [기여 방법](CONTRIBUTING.md)

README의 화면은 명시적으로 생성한 가상 예시입니다. 실제 서비스는 본인의 데이터와 설정을 사용하며 예시를 자동 저장하지 않습니다.
