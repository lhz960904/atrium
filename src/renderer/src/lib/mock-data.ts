export type MockChat = {
  id: string;
  name: string;
  ago?: string;
  running?: boolean;
};

export type MockProject = {
  id: string;
  name: string;
  chats: MockChat[];
};

export const MOCK_PROJECTS: MockProject[] = [
  {
    id: 'p-atrium',
    name: 'Atrium 设计',
    chats: [
      { id: 'c-d11', name: 'D11 Provider 配置 IA 收敛' },
      { id: 'c-d12', name: 'D12 subagent card / settings' },
      { id: 'c-v0', name: 'V0 scaffold 后续' },
    ],
  },
  {
    id: 'p-code-artisan',
    name: 'Code Artisan',
    chats: [{ id: 'c-ca1', name: 'E2B sandbox bridge' }],
  },
  {
    id: 'p-empty',
    name: '未命名项目',
    chats: [],
  },
];

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

export const MOCK_FLAT_CHATS: MockChat[] = [
  { id: 'fc-clarify', name: '把 src/auth 拆成几个独立模块', ago: '5m' },
  { id: 'fc-1', name: '今天 macOS 升级 26 后的兼容性', ago: '12m' },
  { id: 'fc-running', name: '深度调研美股板块行情', ago: '', running: true },
  { id: 'fc-3', name: '看看 Vercel AI SDK v5 升级 changelog', ago: '2h' },
  { id: 'fc-4', name: '帮我整理 Atrium ROADMAP draft', ago: '1d' },
  { id: 'fc-5', name: 'M5 Mac Studio 上手体验', ago: '4d' },
  { id: 'fc-6', name: 'shadcn/ui v3 兼容 Tailwind v4 的 PR', ago: '1w' },
  { id: 'fc-7', name: '一些跟 DeerFlow 同步的 take', ago: '2mo' },
];
