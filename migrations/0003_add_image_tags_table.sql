-- Migration number: 0003 	 2026-04-15T00:30:00.000Z
CREATE INDEX IF NOT EXISTS idx_images_by_name
    ON images(image_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS image_tags (
    image_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (image_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_image_tags_by_tag
    ON image_tags(tag COLLATE NOCASE);

INSERT OR IGNORE INTO image_tags (image_id, tag)
SELECT
    images.id,
    TRIM(CAST(json_each.value AS TEXT))
FROM images, json_each(images.tags)
WHERE json_valid(images.tags)
  AND json_type(images.tags) = 'array'
  AND LENGTH(TRIM(CAST(json_each.value AS TEXT))) > 0;
