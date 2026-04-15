# Drawing Talk

Cloudflare Workers 기반의 간단한 이미지 업로드 보드입니다.

- 실제 이미지 파일은 `R2`에 저장
- 이미지 이름, 원본 파일명, 업로드 시각은 `images` 테이블에 저장
- 태그는 `image_tags` 테이블에 정규화해서 저장
- 업로드 후 메인 페이지에서 최근 이미지를 카드 형태로 확인

## Routes

- `GET /`: 업로드 폼과 최근 이미지 목록
- `POST /upload`: 이미지 업로드 및 메타데이터 저장
- `POST /images/:id/delete`: 이미지 메타데이터와 파일 삭제
- `GET /images/:id`: 업로드된 이미지 바이너리 반환

업로드와 삭제는 `ADMIN_PASSWORD` secret 검증을 통과해야 합니다.

## Local Setup

1. 의존성 설치

```bash
npm install
```

2. D1 마이그레이션 적용

```bash
npx wrangler d1 migrations apply DB --local
```

3. 로컬 실행

```bash
npm run dev
```

## Cloudflare Setup

`wrangler.json`에는 다음 바인딩이 필요합니다.

- `DB`: D1 database
- `IMAGES`: R2 bucket (`drawing-talk-images`)

배포 전 준비:

```bash
npx wrangler r2 bucket create drawing-talk-images
npx wrangler secret put ADMIN_PASSWORD
npx wrangler d1 migrations apply DB --remote
npm run deploy
```
