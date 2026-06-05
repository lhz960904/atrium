import { Node } from '@tiptap/core';
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Package } from 'lucide-react';

/**
 * The skill chip token: an inline, atomic node the user inserts from the `/`
 * menu (see slash-menu, which produces it). The cursor can't enter it and
 * backspace deletes it whole. On send it serializes to a <skill-use> tag — the
 * model reads it as an explicit invocation and the message bubble (UserMessage)
 * renders it back as a chip. Keep this tag in sync with UserMessage's parser.
 */
export const SkillMention = Node.create({
  name: 'skillMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { name: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'span[data-skill-mention]' }];
  },

  renderHTML({ node }) {
    return [
      'span',
      { 'data-skill-mention': node.attrs.name },
      `<skill-use>${node.attrs.name}</skill-use>`,
    ];
  },

  renderText({ node }) {
    return `<skill-use>${node.attrs.name}</skill-use>`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkillChip);
  },
});

function SkillChip({ node }: NodeViewProps): React.JSX.Element {
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className="select-none font-medium text-accent"
    >
      <Package className="mr-1 inline size-3.5 align-middle" />
      {node.attrs.name}
    </NodeViewWrapper>
  );
}
