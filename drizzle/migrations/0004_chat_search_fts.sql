-- Full-text search over chat titles + message bodies.
--
-- `chat_fts` is a standalone FTS5 index. `text_indexed` holds jieba-segmented
-- (space-joined) tokens so the default unicode61 tokenizer can match Chinese
-- words; `text_raw` keeps the original text for snippet/highlight at query time.
-- `jieba_cut()` is a JS scalar function registered on the connection before
-- migrations run (see db/index.ts), so the triggers below segment every write
-- path — tRPC, the agent loop's persist, and any future writer — automatically.
-- Only `type='text'` parts are indexed; tool-call / reasoning parts are skipped.
CREATE VIRTUAL TABLE chat_fts USING fts5(
  text_indexed,
  text_raw UNINDEXED,
  kind UNINDEXED,
  thread_id UNINDEXED,
  message_id UNINDEXED,
  created_at UNINDEXED,
  tokenize = 'unicode61'
);
--> statement-breakpoint
CREATE TRIGGER chat_fts_msg_ai AFTER INSERT ON messages BEGIN
  INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
  SELECT jieba_cut(raw), raw, 'message', new.thread_id, new.id, new.created_at
  FROM (
    SELECT (
      SELECT group_concat(json_extract(je.value, '$.text'), char(10))
      FROM json_each(new.parts) je
      WHERE json_extract(je.value, '$.type') = 'text'
    ) AS raw
  )
  WHERE raw IS NOT NULL AND raw <> '';
END;
--> statement-breakpoint
CREATE TRIGGER chat_fts_msg_au AFTER UPDATE OF parts ON messages BEGIN
  DELETE FROM chat_fts WHERE message_id = old.id;
  INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
  SELECT jieba_cut(raw), raw, 'message', new.thread_id, new.id, new.created_at
  FROM (
    SELECT (
      SELECT group_concat(json_extract(je.value, '$.text'), char(10))
      FROM json_each(new.parts) je
      WHERE json_extract(je.value, '$.type') = 'text'
    ) AS raw
  )
  WHERE raw IS NOT NULL AND raw <> '';
END;
--> statement-breakpoint
CREATE TRIGGER chat_fts_msg_ad AFTER DELETE ON messages BEGIN
  DELETE FROM chat_fts WHERE message_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER chat_fts_thread_ai AFTER INSERT ON threads WHEN new.title IS NOT NULL AND new.title <> '' BEGIN
  INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
  VALUES (jieba_cut(new.title), new.title, 'title', new.id, NULL, new.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER chat_fts_thread_au AFTER UPDATE OF title ON threads BEGIN
  DELETE FROM chat_fts WHERE thread_id = new.id AND kind = 'title';
  INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
  SELECT jieba_cut(new.title), new.title, 'title', new.id, NULL, new.created_at
  WHERE new.title IS NOT NULL AND new.title <> '';
END;
--> statement-breakpoint
CREATE TRIGGER chat_fts_thread_ad AFTER DELETE ON threads BEGIN
  DELETE FROM chat_fts WHERE thread_id = old.id;
END;
--> statement-breakpoint
INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
SELECT jieba_cut(raw), raw, 'message', thread_id, id, created_at FROM (
  SELECT m.id, m.thread_id, m.created_at, (
    SELECT group_concat(json_extract(je.value, '$.text'), char(10))
    FROM json_each(m.parts) je
    WHERE json_extract(je.value, '$.type') = 'text'
  ) AS raw
  FROM messages m
)
WHERE raw IS NOT NULL AND raw <> '';
--> statement-breakpoint
INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
SELECT jieba_cut(title), title, 'title', id, NULL, created_at
FROM threads WHERE title IS NOT NULL AND title <> '';
