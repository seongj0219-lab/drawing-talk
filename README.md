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
- `GET /api/images`: 이미지 목록 JSON 반환
- `POST /api/images`: 이미지 업로드 API
- `DELETE /api/images/:id`: 이미지 삭제 API

업로드와 삭제는 `ADMIN_PASSWORD` secret 검증을 통과해야 합니다.

## API Notes

`GET /api/images` 응답 예시:

```json
{
  "success": true,
  "images": [
    {
      "id": "427e0337-89f1-4681-8bc1-46403464505e",
      "imageName": "White Cat Demo",
      "originalFilename": "whitecat.png",
      "contentType": "image/png",
      "sizeBytes": 181626,
      "tags": ["cat", "demo", "upload"],
      "createdAt": "2026-04-15 07:58:04",
      "imageUrl": "https://drawing-talk.seongj0219.workers.dev/images/427e0337-89f1-4681-8bc1-46403464505e",
      "deleteUrl": "https://drawing-talk.seongj0219.workers.dev/api/images/427e0337-89f1-4681-8bc1-46403464505e"
    }
  ]
}
```

`POST /api/images`는 두 가지 형식을 지원합니다.

1. `multipart/form-data`

필드:
- `image` 또는 `file`
- `imageName`
- `tags`
- `password`

2. `application/json`

```json
{
  "imageName": "White Cat Demo",
  "filename": "whitecat.png",
  "contentType": "image/png",
  "tags": ["cat", "demo", "upload"],
  "password": "dodotdo0415",
  "imageBase64": "iVBORw0KGgoAAA..."
}
```

`DELETE /api/images/:id`는 JSON body 또는 `x-admin-password` 헤더로 비밀번호를 받을 수 있습니다.

```json
{
  "password": "dodotdo0415"
}
```

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
