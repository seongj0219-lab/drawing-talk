import { renderHtml, type FlashMessage, type ImageView } from "./renderHtml";

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const RECENT_IMAGE_LIMIT = 24;

type ImageRow = {
	id: string;
	object_key: string;
	image_name: string;
	original_filename: string;
	content_type: string;
	size_bytes: number;
	tags: string;
	created_at: string;
};

export default {
	async fetch(request, env) {
		try {
			return await routeRequest(request, env);
		} catch (error) {
			console.error("Unhandled request error", error);
			return new Response("Internal Server Error", { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;

async function routeRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === "GET" && url.pathname === "/") {
		const flash = getFlashMessage(url);
		return renderHomePage(env, flash);
	}

	if (request.method === "POST" && url.pathname === "/upload") {
		return handleUpload(request, env);
	}

	if (request.method === "GET" && url.pathname.startsWith("/images/")) {
		const imageId = url.pathname.slice("/images/".length);
		return handleImageRequest(imageId, env);
	}

	return new Response("Not Found", { status: 404 });
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
	const formData = await request.formData();
	const imageFile = formData.get("image");
	const rawImageName = normalizeText(formData.get("imageName"));
	const rawTags = normalizeText(formData.get("tags"));

	if (!(imageFile instanceof File)) {
		return renderHomePage(env, {
			tone: "error",
			text: "업로드할 이미지 파일을 선택해야 합니다.",
		}, 400);
	}

	if (!imageFile.type.startsWith("image/")) {
		return renderHomePage(env, {
			tone: "error",
			text: "이미지 파일만 업로드할 수 있습니다.",
		}, 400);
	}

	if (imageFile.size === 0) {
		return renderHomePage(env, {
			tone: "error",
			text: "비어 있는 파일은 업로드할 수 없습니다.",
		}, 400);
	}

	if (imageFile.size > MAX_UPLOAD_SIZE_BYTES) {
		return renderHomePage(env, {
			tone: "error",
			text: "이미지 크기는 10MB 이하여야 합니다.",
		}, 400);
	}

	const imageName = rawImageName || stripExtension(imageFile.name) || "Untitled image";
	const tags = parseTags(rawTags);
	const imageId = crypto.randomUUID();
	const objectKey = buildObjectKey(imageId, imageName, imageFile.name, imageFile.type);
	const contentType = imageFile.type || "application/octet-stream";
	const tagsJson = JSON.stringify(tags);
	const fileBuffer = await imageFile.arrayBuffer();

	await env.IMAGES.put(objectKey, fileBuffer, {
		httpMetadata: {
			contentType,
		},
	});

	try {
		await env.DB.prepare(
			`
				INSERT INTO images (
					id,
					object_key,
					image_name,
					original_filename,
					content_type,
					size_bytes,
					tags
				)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`,
		)
			.bind(
				imageId,
				objectKey,
				imageName,
				imageFile.name || "upload",
				contentType,
				imageFile.size,
				tagsJson,
			)
			.run();
	} catch (error) {
		await env.IMAGES.delete(objectKey);
		console.error("Failed to store image metadata", error);
		return renderHomePage(env, {
			tone: "error",
			text: "이미지는 저장했지만 DB 기록 추가에 실패했습니다. 다시 시도해 주세요.",
		}, 500);
	}

	const redirectUrl = new URL("/", request.url);
	redirectUrl.searchParams.set("status", "uploaded");
	return Response.redirect(redirectUrl.toString(), 303);
}

async function handleImageRequest(imageId: string, env: Env): Promise<Response> {
	if (!imageId) {
		return new Response("Not Found", { status: 404 });
	}

	const image = await env.DB.prepare(
		"SELECT object_key, content_type, original_filename FROM images WHERE id = ?",
	)
		.bind(imageId)
		.first<Pick<ImageRow, "object_key" | "content_type" | "original_filename">>();

	if (!image) {
		return new Response("Image not found", { status: 404 });
	}

	const object = await env.IMAGES.get(image.object_key);

	if (!object) {
		return new Response("Image file is missing", { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("content-type", image.content_type);
	headers.set("cache-control", "public, max-age=31536000, immutable");
	headers.set("content-disposition", buildContentDisposition(image.original_filename));

	return new Response(object.body, {
		headers,
	});
}

async function renderHomePage(
	env: Env,
	flash?: FlashMessage,
	status = 200,
): Promise<Response> {
	let images: ImageView[] = [];
	let derivedFlash = flash;

	try {
		images = await listImages(env);
	} catch (error) {
		console.error("Failed to load image list", error);
		if (!derivedFlash) {
			derivedFlash = {
				tone: "error",
				text: "D1 마이그레이션이 적용되지 않았거나 테이블이 아직 준비되지 않았습니다.",
			};
		}
	}

	return new Response(renderHtml({ images, flash: derivedFlash }), {
		status,
		headers: {
			"content-type": "text/html; charset=UTF-8",
		},
	});
}

async function listImages(env: Env): Promise<ImageView[]> {
	const { results } = await env.DB.prepare(
		`
			SELECT
				id,
				object_key,
				image_name,
				original_filename,
				content_type,
				size_bytes,
				tags,
				created_at
			FROM images
			ORDER BY datetime(created_at) DESC
			LIMIT ?
		`,
	)
		.bind(RECENT_IMAGE_LIMIT)
		.all<ImageRow>();

	return results.map((row) => ({
		id: row.id,
		imageName: row.image_name,
		originalFilename: row.original_filename,
		contentType: row.content_type,
		sizeBytes: Number(row.size_bytes),
		tags: parseStoredTags(row.tags),
		createdAt: row.created_at,
		imageUrl: `/images/${row.id}`,
	}));
}

function parseTags(input: string): string[] {
	if (!input) {
		return [];
	}

	const uniqueTags = new Map<string, string>();

	for (const candidate of input.split(",")) {
		const normalized = candidate.trim().replace(/^#+/, "");
		if (!normalized) {
			continue;
		}

		const dedupeKey = normalized.toLocaleLowerCase();
		if (!uniqueTags.has(dedupeKey)) {
			uniqueTags.set(dedupeKey, normalized);
		}
	}

	return Array.from(uniqueTags.values());
}

function parseStoredTags(rawTags: string): string[] {
	if (!rawTags) {
		return [];
	}

	try {
		const parsed = JSON.parse(rawTags);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
	} catch {
		return [];
	}
}

function buildObjectKey(
	imageId: string,
	imageName: string,
	originalFilename: string,
	contentType: string,
): string {
	const slug = slugify(imageName) || slugify(stripExtension(originalFilename)) || "image";
	const extension = getPreferredExtension(originalFilename, contentType);
	return `${imageId}/${slug}${extension}`;
}

function getPreferredExtension(filename: string, contentType: string): string {
	const filenameExtension = filename.match(/\.[a-zA-Z0-9]+$/)?.[0];
	if (filenameExtension) {
		return filenameExtension.toLowerCase();
	}

	switch (contentType) {
		case "image/jpeg":
			return ".jpg";
		case "image/png":
			return ".png";
		case "image/webp":
			return ".webp";
		case "image/gif":
			return ".gif";
		case "image/svg+xml":
			return ".svg";
		default:
			return "";
	}
}

function buildContentDisposition(filename: string): string {
	const fallback = filename.replace(/["\\\r\n]/g, "_") || "image";
	return `inline; filename="${fallback}"`;
}

function normalizeText(value: string | File | null): string {
	return typeof value === "string" ? value.trim() : "";
}

function stripExtension(filename: string): string {
	return filename.replace(/\.[^.]+$/, "");
}

function slugify(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function getFlashMessage(url: URL): FlashMessage | undefined {
	if (url.searchParams.get("status") === "uploaded") {
		return {
			tone: "success",
			text: "이미지와 메타데이터가 저장되었습니다.",
		};
	}

	return undefined;
}
