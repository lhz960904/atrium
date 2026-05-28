export type MockContinueItem =
  | { kind: 'chat-running'; id: string; name: string; sub: string }
  | { kind: 'artifact'; id: string; name: string; sub: string; ago: string }
  | { kind: 'chat-done'; id: string; name: string; sub: string; ago: string };

export const MOCK_CONTINUE_ITEMS: MockContinueItem[] = [
  {
    kind: 'chat-running',
    id: 'c-d7',
    name: 'D7 sidebar 设计',
    sub: '正在跑',
  },
  {
    kind: 'artifact',
    id: 'a-tokens',
    name: 'tokens.css',
    sub: 'artifact · D2 token 系统更新',
    ago: '3d',
  },
  {
    kind: 'chat-done',
    id: 'c-d6',
    name: 'D6 composer 决定',
    sub: 'Variant B + Codex slash menu',
    ago: '5h',
  },
];

export const MOCK_CURRENT_PROJECT = {
  name: 'Atrium',
  chatCount: 3,
};
