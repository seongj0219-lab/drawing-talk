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
	legacy_tags: string | null;
	created_at: string;
};

type ImageTagRow = {
	image_id: string;
	tag: string;
};

type ApiUploadBody = {
	contentType?: string;
	filename?: string;
	imageBase64?: string;
	imageName?: string;
	password?: string;
	tags?: string[] | string;
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
	const webDeleteMatch = url.pathname.match(/^\/images\/([^/]+)\/delete$/);
	const apiImageMatch = url.pathname.match(/^\/api\/images\/([^/]+)$/);

	if (request.method === "GET" && url.pathname === "/api/images") {
		return handleApiListImages(request, env);
	}

	if (request.method === "POST" && url.pathname === "/api/images") {
		return handleApiUpload(request, env);
	}

	if (request.method === "DELETE" && apiImageMatch) {
		return handleApiDelete(apiImageMatch[1], request, env);
	}

	if (request.method === "GET" && url.pathname === "/") {
		const flash = getFlashMessage(url);
		return renderHomePage(env, flash);
	}

	if (request.method === "POST" && url.pathname === "/upload") {
		return handleUpload(request, env);
	}

	if (request.method === "POST" && webDeleteMatch) {
		return handleDeleteRequest(webDeleteMatch[1], request, env);
	}

	if (request.method === "GET" && url.pathname.startsWith("/images/")) {
		const imageId = url.pathname.slice("/images/".length);
		return handleImageRequest(imageId, env);
	}

	return new Response("Not Found", { status: 404 });
}

async function handleApiListImages(request: Request, env: Env): Promise<Response> {
	try {
		const images = await listImages(env);
		return jsonResponse({
			images: images.map((image) => toApiImage(image, request)),
			success: true,
		});
	} catch (error) {
		console.error("Failed to load API image list", error);
		return jsonError("이미지 목록을 불러오지 못했습니다.", 500);
	}
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
	const formData = await request.formData();
	const imageFile = formData.get("image");
	const rawImageName = normalizeText(formData.get("imageName"));
	const rawTags = normalizeText(formData.get("tags"));
	const rawPassword = getRequestPassword(request, normalizeText(formData.get("password")));

	const passwordError = getPasswordError(rawPassword, env);
	if (passwordError) {
		return renderHomePage(env, passwordError, 401);
	}

	if (!(imageFile instanceof File)) {
		return renderHomePage(
			env,
			{
				tone: "error",
				text: "업로드할 이미지 파일을 선택해야 합니다.",
			},
			400,
		);
	}

	if (!imageFile.type.startsWith("image/")) {
		return renderHomePage(
			env,
			{
				tone: "error",
				text: "이미지 파일만 업로드할 수 있습니다.",
			},
			400,
		);
	}

	if (imageFile.size === 0) {
		return renderHomePage(
			env,
			{
				tone: "error",
				text: "비어 있는 파일은 업로드할 수 없습니다.",
			},
			400,
		);
	}

	if (imageFile.size > MAX_UPLOAD_SIZE_BYTES) {
		return renderHomePage(
			env,
			{
				tone: "error",
				text: "이미지 크기는 10MB 이하여야 합니다.",
			},
			400,
		);
	}

	const imageName = rawImageName || stripExtension(imageFile.name) || "Untitled image";
	const tags = parseTags(rawTags);

	try {
		await createImageRecord(env, {
			contentType: imageFile.type || "application/octet-stream",
			fileBuffer: await imageFile.arrayBuffer(),
			imageName,
			originalFilename: imageFile.name || "upload",
			sizeBytes: imageFile.size,
			tags,
		});
	} catch (error) {
		console.error("Failed to store image metadata", error);
		return renderHomePage(
			env,
			{
				tone: "error",
				text: "이미지는 저장했지만 DB 기록 추가에 실패했습니다. 다시 시도해 주세요.",
			},
			500,
		);
	}

	return redirectWithStatus(request, "uploaded");
}

async function handleApiUpload(request: Request, env: Env): Promise<Response> {
	const contentType = request.headers.get("content-type") || "";

	try {
		const image = contentType.includes("application/json")
			? await handleJsonApiUpload(request, env)
			: contentType.includes("multipart/form-data")
				? await handleMultipartApiUpload(request, env)
				: null;

		if (!image) {
			return jsonError("업로드는 application/json 또는 multipart/form-data 여야 합니다.", 415);
		}

		return jsonResponse(
			{
				image: toApiImage(image, request),
				success: true,
			},
			201,
		);
	} catch (error) {
		if (error instanceof ApiError) {
			return jsonError(error.message, error.status);
		}

		console.error("Failed to upload image via API", error);
		return jsonError("이미지 업로드에 실패했습니다.", 500);
	}
}

async function handleMultipartApiUpload(request: Request, env: Env): Promise<ImageView> {
	const formData = await request.formData();
	const imageFile = formData.get("image") ?? formData.get("file");
	const password = getRequestPassword(request, normalizeText(formData.get("password")));
	const passwordError = getPasswordError(password, env);

	if (passwordError) {
		throw new ApiError(passwordError.text, 401);
	}

	if (!(imageFile instanceof File)) {
		throw new ApiError("image 또는 file 필드에 이미지 파일이 필요합니다.", 400);
	}

	validateImageFile(imageFile.type, imageFile.size);

	return createImageRecord(env, {
		contentType: imageFile.type || "application/octet-stream",
		fileBuffer: await imageFile.arrayBuffer(),
		imageName:
			normalizeText(formData.get("imageName")) || stripExtension(imageFile.name) || "Untitled image",
		originalFilename: imageFile.name || "upload",
		sizeBytes: imageFile.size,
		tags: normalizeTagsInput(formData.get("tags")),
	});
}

async function handleJsonApiUpload(request: Request, env: Env): Promise<ImageView> {
	const body = (await request.json()) as ApiUploadBody;
	const password = getRequestPassword(
		request,
		typeof body.password === "string" ? body.password : "",
	);
	const passwordError = getPasswordError(password, env);

	if (passwordError) {
		throw new ApiError(passwordError.text, 401);
	}

	if (!body.imageBase64) {
		throw new ApiError("imageBase64 필드가 필요합니다.", 400);
	}

	const originalFilename = body.filename?.trim() || "upload";
	const resolvedContentType = (
		body.contentType?.trim() || getPreferredContentType(originalFilename)
	).toLocaleLowerCase();
	const imageBytes = decodeBase64(body.imageBase64);

	validateImageFile(resolvedContentType, imageBytes.byteLength);

	return createImageRecord(env, {
		contentType: resolvedContentType,
		fileBuffer: imageBytes,
		imageName: body.imageName?.trim() || stripExtension(originalFilename) || "Untitled image",
		originalFilename,
		sizeBytes: imageBytes.byteLength,
		tags: normalizeTagsInput(body.tags),
	});
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

async function handleDeleteRequest(
	imageId: string,
	request: Request,
	env: Env,
): Promise<Response> {
	const formData = await request.formData();
	const rawPassword = getRequestPassword(request, normalizeText(formData.get("password")));
	const passwordError = getPasswordError(rawPassword, env);

	if (passwordError) {
		return renderHomePage(env, passwordError, 401);
	}

	if (!imageId) {
		return redirectWithStatus(request, "delete-missing");
	}

	try {
		const deleteState = await deleteImageById(env, imageId);
		if (deleteState === "missing") {
			return redirectWithStatus(request, "delete-missing");
		}
	} catch (error) {
		console.error("Failed to delete image", error);
		return renderHomePage(
			env,
			{
				tone: "error",
				text: "이미지 삭제에 실패했습니다. 다시 시도해 주세요.",
			},
			500,
		);
	}

	return redirectWithStatus(request, "deleted");
}

async function handleApiDelete(
	imageId: string,
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const password = await getApiDeletePassword(request);
		const passwordError = getPasswordError(password, env);

		if (passwordError) {
			return jsonError(passwordError.text, 401);
		}

		const deleteState = await deleteImageById(env, imageId);

		if (deleteState === "missing") {
			return jsonError("삭제할 이미지를 찾지 못했습니다.", 404);
		}

		return jsonResponse({
			deletedId: imageId,
			success: true,
		});
	} catch (error) {
		if (error instanceof ApiError) {
			return jsonError(error.message, error.status);
		}

		console.error("Failed to delete image via API", error);
		return jsonError("이미지 삭제에 실패했습니다.", 500);
	}
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
				tags AS legacy_tags,
				created_at
			FROM images
			ORDER BY datetime(created_at) DESC
			LIMIT ?
		`,
	)
		.bind(RECENT_IMAGE_LIMIT)
		.all<ImageRow>();

	if (results.length === 0) {
		return [];
	}

	const tagsByImageId = await listTagsByImageId(env, results.map((row) => row.id));

	return results.map((row) => ({
		id: row.id,
		imageName: row.image_name,
		originalFilename: row.original_filename,
		contentType: row.content_type,
		sizeBytes: Number(row.size_bytes),
		tags: mergeTags(tagsByImageId.get(row.id), row.legacy_tags),
		createdAt: row.created_at,
		imageUrl: `/images/${row.id}`,
	}));
}

async function loadImageViewById(env: Env, imageId: string): Promise<ImageView | null> {
	const row = await env.DB.prepare(
		`
			SELECT
				id,
				object_key,
				image_name,
				original_filename,
				content_type,
				size_bytes,
				tags AS legacy_tags,
				created_at
			FROM images
			WHERE id = ?
		`,
	)
		.bind(imageId)
		.first<ImageRow>();

	if (!row) {
		return null;
	}

	const tagsByImageId = await listTagsByImageId(env, [row.id]);

	return {
		id: row.id,
		imageName: row.image_name,
		originalFilename: row.original_filename,
		contentType: row.content_type,
		sizeBytes: Number(row.size_bytes),
		tags: mergeTags(tagsByImageId.get(row.id), row.legacy_tags),
		createdAt: row.created_at,
		imageUrl: `/images/${row.id}`,
	};
}

async function listTagsByImageId(
	env: Env,
	imageIds: string[],
): Promise<Map<string, string[]>> {
	if (imageIds.length === 0) {
		return new Map();
	}

	const placeholders = imageIds.map(() => "?").join(", ");
	const { results } = await env.DB.prepare(
		`
			SELECT
				image_id,
				tag
			FROM image_tags
			WHERE image_id IN (${placeholders})
			ORDER BY tag COLLATE NOCASE ASC
		`,
	)
		.bind(...imageIds)
		.all<ImageTagRow>();

	const tagsByImageId = new Map<string, string[]>();

	for (const row of results) {
		const tags = tagsByImageId.get(row.image_id) ?? [];
		tags.push(row.tag);
		tagsByImageId.set(row.image_id, tags);
	}

	return tagsByImageId;
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

function mergeTags(normalizedTags: string[] | undefined, legacyTags: string | null): string[] {
	if (normalizedTags && normalizedTags.length > 0) {
		return normalizedTags;
	}

	if (!legacyTags) {
		return [];
	}

	return parseTags(parseStoredTags(legacyTags).join(","));
}

async function cleanupFailedUpload(env: Env, imageId: string, objectKey: string): Promise<void> {
	try {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM image_tags WHERE image_id = ?").bind(imageId),
			env.DB.prepare("DELETE FROM images WHERE id = ?").bind(imageId),
		]);
	} catch (cleanupError) {
		console.error("Failed to clean up partial DB records", cleanupError);
	}

	try {
		await env.IMAGES.delete(objectKey);
	} catch (cleanupError) {
		console.error("Failed to clean up partial R2 object", cleanupError);
	}
}

async function createImageRecord(
	env: Env,
	input: {
		contentType: string;
		fileBuffer: ArrayBuffer;
		imageName: string;
		originalFilename: string;
		sizeBytes: number;
		tags: string[];
	},
): Promise<ImageView> {
	const imageId = crypto.randomUUID();
	const objectKey = buildObjectKey(
		imageId,
		input.imageName,
		input.originalFilename,
		input.contentType,
	);

	await env.IMAGES.put(objectKey, input.fileBuffer, {
		httpMetadata: {
			contentType: input.contentType,
		},
	});

	try {
		const statements = [
			env.DB.prepare(
				`
					INSERT INTO images (
						id,
						object_key,
						image_name,
						original_filename,
						content_type,
						size_bytes
					)
					VALUES (?, ?, ?, ?, ?, ?)
				`,
			).bind(
				imageId,
				objectKey,
				input.imageName,
				input.originalFilename,
				input.contentType,
				input.sizeBytes,
			),
			...input.tags.map((tag) =>
				env.DB.prepare(
					`
						INSERT INTO image_tags (
							image_id,
							tag
						)
						VALUES (?, ?)
					`,
				).bind(imageId, tag),
			),
		];

		await env.DB.batch(statements);
	} catch (error) {
		await cleanupFailedUpload(env, imageId, objectKey);
		throw error;
	}

	const image = await loadImageViewById(env, imageId);

	if (!image) {
		throw new Error(`Created image ${imageId} could not be loaded back from D1.`);
	}

	return image;
}

async function deleteImageById(env: Env, imageId: string): Promise<"deleted" | "missing"> {
	const image = await env.DB.prepare(
		"SELECT id, object_key FROM images WHERE id = ?",
	)
		.bind(imageId)
		.first<Pick<ImageRow, "id" | "object_key">>();

	if (!image) {
		return "missing";
	}

	await env.DB.batch([
		env.DB.prepare("DELETE FROM image_tags WHERE image_id = ?").bind(image.id),
		env.DB.prepare("DELETE FROM images WHERE id = ?").bind(image.id),
	]);

	await env.IMAGES.delete(image.object_key);
	return "deleted";
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

function getPreferredContentType(filename: string): string {
	const lower = filename.toLocaleLowerCase();

	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
		return "image/jpeg";
	}

	if (lower.endsWith(".png")) {
		return "image/png";
	}

	if (lower.endsWith(".webp")) {
		return "image/webp";
	}

	if (lower.endsWith(".gif")) {
		return "image/gif";
	}

	if (lower.endsWith(".svg")) {
		return "image/svg+xml";
	}

	return "application/octet-stream";
}

function buildContentDisposition(filename: string): string {
	const fallback = filename.replace(/["\\\r\n]/g, "_") || "image";
	return `inline; filename="${fallback}"`;
}

function normalizeText(value: string | File | null): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeTagsInput(value: string | File | string[] | null | undefined): string[] {
	if (Array.isArray(value)) {
		return parseTags(value.join(","));
	}

	if (typeof value === "string") {
		return parseTags(value);
	}

	return [];
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
	switch (url.searchParams.get("status")) {
		case "uploaded":
			return {
				tone: "success",
				text: "이미지와 메타데이터가 저장되었습니다.",
			};
		case "deleted":
			return {
				tone: "success",
				text: "이미지가 삭제되었습니다.",
			};
		case "delete-missing":
			return {
				tone: "error",
				text: "삭제할 이미지를 찾지 못했습니다.",
			};
		default:
			return undefined;
	}
}

function redirectWithStatus(request: Request, status: string): Response {
	const redirectUrl = new URL("/", request.url);
	redirectUrl.searchParams.set("status", status);
	return Response.redirect(redirectUrl.toString(), 303);
}

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload, null, 2), {
		status,
		headers: {
			"content-type": "application/json; charset=UTF-8",
		},
	});
}

function jsonError(message: string, status: number): Response {
	return jsonResponse(
		{
			error: message,
			success: false,
		},
		status,
	);
}

function toApiImage(image: ImageView, request: Request) {
	const origin = new URL(request.url).origin;

	return {
		...image,
		deleteUrl: `${origin}/api/images/${image.id}`,
		imageUrl: `${origin}${image.imageUrl}`,
	};
}

function getRequestPassword(request: Request, fallbackPassword = ""): string {
	const headerPassword = request.headers.get("x-admin-password")?.trim();
	if (headerPassword) {
		return headerPassword;
	}

	const authorization = request.headers.get("authorization");
	if (authorization?.toLocaleLowerCase().startsWith("bearer ")) {
		return authorization.slice(7).trim();
	}

	return fallbackPassword.trim();
}

function getPasswordError(password: string, env: Env): FlashMessage | undefined {
	const configuredPassword = env.ADMIN_PASSWORD?.trim();

	if (!configuredPassword) {
		return {
			tone: "error",
			text: "관리자 비밀번호가 아직 설정되지 않았습니다.",
		};
	}

	if (password !== configuredPassword) {
		return {
			tone: "error",
			text: "비밀번호가 올바르지 않습니다.",
		};
	}

	return undefined;
}

async function getApiDeletePassword(request: Request): Promise<string> {
	const headerPassword = getRequestPassword(request);
	if (headerPassword) {
		return headerPassword;
	}

	const contentType = request.headers.get("content-type") || "";

	if (contentType.includes("application/json")) {
		const body = (await request.json()) as { password?: string };
		return typeof body.password === "string" ? body.password.trim() : "";
	}

	if (contentType.includes("multipart/form-data")) {
		const formData = await request.formData();
		return normalizeText(formData.get("password"));
	}

	return "";
}

function validateImageFile(contentType: string, sizeBytes: number): void {
	if (!contentType.startsWith("image/")) {
		throw new ApiError("이미지 파일만 업로드할 수 있습니다.", 400);
	}

	if (sizeBytes <= 0) {
		throw new ApiError("비어 있는 파일은 업로드할 수 없습니다.", 400);
	}

	if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
		throw new ApiError("이미지 크기는 10MB 이하여야 합니다.", 400);
	}
}

function decodeBase64(rawValue: string): ArrayBuffer {
	try {
		const normalized = rawValue.includes(",") ? rawValue.split(",").pop() ?? "" : rawValue;
		const binary = atob(normalized.replace(/\s+/g, ""));
		const bytes = new Uint8Array(binary.length);

		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}

		return bytes.buffer;
	} catch {
		throw new ApiError("imageBase64 필드가 올바른 base64가 아닙니다.", 400);
	}
}

class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ApiError";
	}
}
