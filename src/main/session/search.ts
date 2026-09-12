import type Database from 'better-sqlite3';
import { createLogger } from '../log';

const log = createLogger('search');

/**
 * Keep the chat search index fed from the session store.
 *
 * The index itself, and the triggers that keep thread titles in it, belong to
 * our own schema. Message text now lives in the store's entries, so the triggers
 * that index it are attached here instead of in a migration: the entries table
 * is created by the store's own migrations, which run after ours.
 *
 * They stay triggers rather than a call from the writer because that is what
 * makes the index a property of the data instead of a thing every writer has to
 * remember. `jieba_cut()` is registered on this connection, which is the same
 * connection the store writes through — the reason it has to be shared at all.
 *
 * pi ships its own full-text search over these entries and we do not use it:
 * it tokenises with trigrams, and a two-character Chinese word — most of them —
 * never matches three-character grams.
 */
export function attachChatSearch(db: Database.Database): void {
  // Only message entries carry conversation text, and only their text content:
  // a tool call's arguments and a reasoning block are not what anyone searches
  // for. A thread is found through the session it owns.
  const indexed = `
    SELECT jieba_cut(raw), raw, 'message', thread_id, new.id, new.timestamp
    FROM (
      SELECT
        (SELECT id FROM threads WHERE session_id = new.session_id) AS thread_id,
        (
          SELECT group_concat(json_extract(je.value, '$.text'), char(10))
          FROM json_each(new.payload, '$.message.content') je
          WHERE json_extract(je.value, '$.type') = 'text'
        ) AS raw
    )
    WHERE thread_id IS NOT NULL AND raw IS NOT NULL AND raw <> ''`;

  // A user message may carry its content as a bare string rather than a list;
  // json_each would reject that outright, so the guard is on the type.
  const isIndexable = `new.type = 'message' AND json_type(new.payload, '$.message.content') = 'array'`;

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chat_fts_entry_ai
    AFTER INSERT ON entries WHEN ${isIndexable}
    BEGIN
      INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
      ${indexed};
    END;

    CREATE TRIGGER IF NOT EXISTS chat_fts_entry_au
    AFTER UPDATE OF payload ON entries WHEN ${isIndexable}
    BEGIN
      DELETE FROM chat_fts WHERE message_id = old.id;
      INSERT INTO chat_fts(text_indexed, text_raw, kind, thread_id, message_id, created_at)
      ${indexed};
    END;

    CREATE TRIGGER IF NOT EXISTS chat_fts_entry_ad
    AFTER DELETE ON entries
    BEGIN
      DELETE FROM chat_fts WHERE message_id = old.id;
    END;
  `);
  log.info('chat search index attached to the session store');
}
