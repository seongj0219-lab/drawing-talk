export type FlashMessage = {
	text: string;
	tone: "success" | "error";
};

export type ImageView = {
	id: string;
	imageName: string;
	originalFilename: string;
	contentType: string;
	sizeBytes: number;
	tags: string[];
	createdAt: string;
	imageUrl: string;
};

type RenderHtmlOptions = {
	images: ImageView[];
	flash?: FlashMessage;
};

export function renderHtml({ images, flash }: RenderHtmlOptions) {
	const cards = images.length > 0 ? images.map(renderImageCard).join("") : renderEmptyState();
	const flashBanner = flash ? renderFlashBanner(flash) : "";

	return `
		<!DOCTYPE html>
		<html lang="ko">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>Drawing Talk Uploads</title>
				<style>
					:root {
						--bg: #f4efe6;
						--panel: rgba(255, 250, 242, 0.88);
						--panel-strong: #fff8ef;
						--ink: #1f1c18;
						--muted: #6a6258;
						--line: rgba(31, 28, 24, 0.12);
						--accent: #db6c3e;
						--accent-strong: #b54f22;
						--accent-soft: rgba(219, 108, 62, 0.12);
						--success: #216f4e;
						--success-soft: rgba(33, 111, 78, 0.12);
						--error: #a63f2d;
						--error-soft: rgba(166, 63, 45, 0.12);
						--shadow: 0 24px 60px rgba(56, 32, 17, 0.12);
						font-family: "Avenir Next", "Segoe UI", sans-serif;
					}

					* {
						box-sizing: border-box;
					}

					body {
						margin: 0;
						color: var(--ink);
						background:
							radial-gradient(circle at top left, rgba(240, 174, 127, 0.35), transparent 30%),
							radial-gradient(circle at top right, rgba(95, 153, 135, 0.25), transparent 28%),
							linear-gradient(180deg, #f7f1e7 0%, #f1ebe2 100%);
					}

					.page {
						width: min(1100px, calc(100vw - 32px));
						margin: 0 auto;
						padding: 40px 0 64px;
					}

					.hero {
						display: grid;
						grid-template-columns: 1.1fr 0.9fr;
						gap: 24px;
						align-items: stretch;
						margin-bottom: 28px;
					}

					.panel {
						background: var(--panel);
						backdrop-filter: blur(10px);
						border: 1px solid var(--line);
						border-radius: 28px;
						box-shadow: var(--shadow);
					}

					.hero-copy {
						padding: 34px;
					}

					.eyebrow {
						display: inline-flex;
						align-items: center;
						gap: 8px;
						padding: 8px 12px;
						border-radius: 999px;
						background: rgba(255, 255, 255, 0.65);
						border: 1px solid rgba(31, 28, 24, 0.08);
						font-size: 12px;
						font-weight: 700;
						letter-spacing: 0.08em;
						text-transform: uppercase;
						color: var(--muted);
					}

					h1 {
						margin: 18px 0 12px;
						font-size: clamp(2.2rem, 4vw, 4.2rem);
						line-height: 0.95;
						letter-spacing: -0.05em;
					}

					.hero-copy p {
						margin: 0;
						max-width: 42ch;
						font-size: 16px;
						line-height: 1.7;
						color: var(--muted);
					}

					.stats {
						display: flex;
						gap: 14px;
						margin-top: 24px;
						flex-wrap: wrap;
					}

					.stat {
						padding: 14px 16px;
						border-radius: 18px;
						background: rgba(255, 255, 255, 0.72);
						border: 1px solid rgba(31, 28, 24, 0.08);
						min-width: 120px;
					}

					.stat strong {
						display: block;
						font-size: 26px;
						line-height: 1;
						margin-bottom: 6px;
					}

					.stat span {
						color: var(--muted);
						font-size: 13px;
					}

					.form-panel {
						padding: 28px;
					}

					.form-panel h2,
					.gallery-header h2 {
						margin: 0 0 10px;
						font-size: 1.2rem;
						letter-spacing: -0.03em;
					}

					.form-panel p,
					.gallery-header p {
						margin: 0 0 18px;
						color: var(--muted);
						line-height: 1.6;
					}

					form {
						display: grid;
						gap: 14px;
					}

					label {
						display: grid;
						gap: 8px;
						font-size: 14px;
						font-weight: 600;
					}

					input {
						width: 100%;
						border: 1px solid rgba(31, 28, 24, 0.14);
						border-radius: 14px;
						padding: 14px 16px;
						font: inherit;
						color: var(--ink);
						background: rgba(255, 255, 255, 0.9);
					}

					input[type="file"] {
						padding: 12px;
					}

					.hint {
						font-size: 12px;
						color: var(--muted);
						font-weight: 500;
					}

					button {
						appearance: none;
						border: 0;
						border-radius: 999px;
						padding: 14px 18px;
						font: inherit;
						font-weight: 700;
						color: white;
						background: linear-gradient(135deg, var(--accent), var(--accent-strong));
						cursor: pointer;
						box-shadow: 0 14px 28px rgba(181, 79, 34, 0.24);
					}

					.flash {
						margin-bottom: 18px;
						padding: 14px 18px;
						border-radius: 18px;
						border: 1px solid transparent;
						font-weight: 600;
					}

					.flash.success {
						background: var(--success-soft);
						color: var(--success);
						border-color: rgba(33, 111, 78, 0.18);
					}

					.flash.error {
						background: var(--error-soft);
						color: var(--error);
						border-color: rgba(166, 63, 45, 0.18);
					}

					.gallery-shell {
						padding: 28px;
					}

					.gallery-header {
						display: flex;
						justify-content: space-between;
						align-items: flex-end;
						gap: 16px;
						margin-bottom: 18px;
						flex-wrap: wrap;
					}

					.gallery {
						display: grid;
						grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
						gap: 18px;
					}

					.card {
						overflow: hidden;
						background: var(--panel-strong);
						border-radius: 22px;
						border: 1px solid rgba(31, 28, 24, 0.1);
					}

					.card img {
						width: 100%;
						aspect-ratio: 1 / 1;
						object-fit: cover;
						display: block;
						background: #eadfce;
					}

					.card-body {
						padding: 16px;
					}

					.card-body h3 {
						margin: 0 0 6px;
						font-size: 1rem;
						line-height: 1.3;
					}

					.meta {
						margin: 0;
						font-size: 13px;
						color: var(--muted);
						line-height: 1.6;
					}

					.tags {
						display: flex;
						flex-wrap: wrap;
						gap: 8px;
						margin-top: 14px;
					}

					.tag {
						padding: 6px 10px;
						border-radius: 999px;
						background: var(--accent-soft);
						color: var(--accent-strong);
						font-size: 12px;
						font-weight: 700;
					}

					.empty {
						padding: 42px 18px;
						border: 1px dashed rgba(31, 28, 24, 0.16);
						border-radius: 24px;
						text-align: center;
						color: var(--muted);
						background: rgba(255, 255, 255, 0.48);
					}

					@media (max-width: 900px) {
						.hero {
							grid-template-columns: 1fr;
						}

						.page {
							width: min(100vw - 20px, 1100px);
							padding-top: 20px;
						}

						.hero-copy,
						.form-panel,
						.gallery-shell {
							padding: 22px;
						}
					}
				</style>
			</head>
			<body>
				<div class="page">
					${flashBanner}
					<section class="hero">
						<div class="hero-copy panel">
							<div class="eyebrow">Cloudflare Worker + D1 + R2</div>
							<h1>Drawing Talk Image Board</h1>
							<p>
								이미지를 업로드하고, 이름과 태그를 함께 기록하는 단순한 저장소입니다.
								파일은 R2에 보관하고 메타데이터는 D1에 저장합니다.
							</p>
							<div class="stats">
								<div class="stat">
									<strong>${images.length}</strong>
									<span>최근 업로드</span>
								</div>
								<div class="stat">
									<strong>${countTags(images)}</strong>
									<span>등록된 태그</span>
								</div>
							</div>
						</div>

						<section class="form-panel panel">
							<h2>이미지 업로드</h2>
							<p>업로드한 뒤 카드 형태로 바로 확인할 수 있습니다.</p>
							<form method="post" action="/upload" enctype="multipart/form-data">
								<label>
									<span>이미지 파일</span>
									<input type="file" name="image" accept="image/*" required />
								</label>
								<label>
									<span>이미지 이름</span>
									<input type="text" name="imageName" placeholder="예: 봄 스케치 01" required />
								</label>
								<label>
									<span>태그</span>
									<input type="text" name="tags" placeholder="portrait, sketch, warm-tone" />
									<span class="hint">쉼표로 구분하면 여러 태그를 저장합니다.</span>
								</label>
								<button type="submit">업로드 저장</button>
							</form>
						</section>
					</section>

					<section class="gallery-shell panel">
						<div class="gallery-header">
							<div>
								<h2>최근 업로드</h2>
								<p>이름, 태그, 원본 파일명, 업로드 시각을 함께 표시합니다.</p>
							</div>
						</div>
						<div class="gallery">
							${cards}
						</div>
					</section>
				</div>
			</body>
		</html>
	`;
}

function renderImageCard(image: ImageView): string {
	const tags = image.tags.length
		? `<div class="tags">${image.tags
				.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`)
				.join("")}</div>`
		: "";

	return `
		<article class="card">
			<img src="${escapeAttribute(image.imageUrl)}" alt="${escapeAttribute(image.imageName)}" loading="lazy" />
			<div class="card-body">
				<h3>${escapeHtml(image.imageName)}</h3>
				<p class="meta">${escapeHtml(image.originalFilename)}</p>
				<p class="meta">${formatDate(image.createdAt)} · ${formatSize(image.sizeBytes)}</p>
				${tags}
			</div>
		</article>
	`;
}

function renderEmptyState(): string {
	return `
		<div class="empty">
			아직 업로드된 이미지가 없습니다. 첫 이미지를 등록해 보세요.
		</div>
	`;
}

function renderFlashBanner(flash: FlashMessage): string {
	return `<div class="flash ${flash.tone}">${escapeHtml(flash.text)}</div>`;
}

function countTags(images: ImageView[]): number {
	return new Set(images.flatMap((image) => image.tags.map((tag) => tag.toLocaleLowerCase()))).size;
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return escapeHtml(value);
	}

	return new Intl.DateTimeFormat("ko-KR", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function formatSize(sizeBytes: number): string {
	if (sizeBytes < 1024) {
		return `${sizeBytes} B`;
	}

	if (sizeBytes < 1024 * 1024) {
		return `${(sizeBytes / 1024).toFixed(1)} KB`;
	}

	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value);
}
