ALTER TABLE `messages` ADD `run_id` text;--> statement-breakpoint
CREATE INDEX `messages_run_id_idx` ON `messages` (`run_id`);--> statement-breakpoint
DROP TRIGGER IF EXISTS chat_fts_msg_ai;
--> statement-breakpoint
DROP TRIGGER IF EXISTS chat_fts_msg_au;
--> statement-breakpoint
CREATE TRIGGER chat_fts_msg_ai AFTER INSERT ON messages BEGIN
  INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
  SELECT jieba_cut(raw), raw, 'message', new.thread_id, new.id, new.created_at
  FROM (
    SELECT CASE
      WHEN json_type(new.parts) = 'array' THEN (
        SELECT group_concat(json_extract(je.value, '$.text'), char(10))
        FROM json_each(new.parts) je
        WHERE json_extract(je.value, '$.type') = 'text'
      )
      WHEN json_type(new.parts, '$.content') = 'text' THEN json_extract(new.parts, '$.content')
      WHEN json_type(new.parts, '$.content') = 'array' THEN (
        SELECT group_concat(json_extract(je.value, '$.text'), char(10))
        FROM json_each(new.parts, '$.content') je
        WHERE json_extract(je.value, '$.type') = 'text'
      )
      ELSE NULL
    END AS raw
  )
  WHERE raw IS NOT NULL AND raw <> '';
END;
--> statement-breakpoint
CREATE TRIGGER chat_fts_msg_au AFTER UPDATE OF parts ON messages BEGIN
  DELETE FROM chat_fts WHERE message_id = old.id;
  INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
  SELECT jieba_cut(raw), raw, 'message', new.thread_id, new.id, new.created_at
  FROM (
    SELECT CASE
      WHEN json_type(new.parts) = 'array' THEN (
        SELECT group_concat(json_extract(je.value, '$.text'), char(10))
        FROM json_each(new.parts) je
        WHERE json_extract(je.value, '$.type') = 'text'
      )
      WHEN json_type(new.parts, '$.content') = 'text' THEN json_extract(new.parts, '$.content')
      WHEN json_type(new.parts, '$.content') = 'array' THEN (
        SELECT group_concat(json_extract(je.value, '$.text'), char(10))
        FROM json_each(new.parts, '$.content') je
        WHERE json_extract(je.value, '$.type') = 'text'
      )
      ELSE NULL
    END AS raw
  )
  WHERE raw IS NOT NULL AND raw <> '';
END;
