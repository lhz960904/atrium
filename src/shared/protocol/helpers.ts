import type { Content, ImageContent, Message, TextContent } from './messages';

export function isTextContent(content: Content): content is TextContent {
  return content.type === 'text';
}

export function isImageContent(content: Content): content is ImageContent {
  return content.type === 'image';
}

/** Concatenated text of a message's content — user string form included. */
export function contentText(content: string | readonly Content[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter(isTextContent)
    .map((part) => part.text)
    .join('');
}

export function messageText(message: Message): string {
  return contentText(message.content);
}
