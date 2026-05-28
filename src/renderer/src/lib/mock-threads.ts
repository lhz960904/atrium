export type MockMessage =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content: string };

export type MockThread = {
  id: string;
  title: string;
  messages: MockMessage[];
};

const MOCK_THREADS: Record<string, MockThread> = {
  'fc-running': {
    id: 'fc-running',
    title: '深度调研美股板块行情',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: '给我深度调研一下美股各主要板块的行情',
      },
      {
        id: 'm-2',
        role: 'assistant',
        content:
          '好的。我同时用多个子 agent 并行调研美股各主要板块，覆盖大盘指数、科技股、板块轮动、中概股 + 港股四块。先扫一下 sectors 的总体表现，再分别深入。',
      },
      {
        id: 'm-3',
        role: 'user',
        content: '重点看一下 sector rotation，最近几个月资金到底从哪里出、流到哪里去',
      },
      {
        id: 'm-4',
        role: 'assistant',
        content:
          '近三个月（2026 Q2）板块轮动有几个明显信号：\n\n1. **资金从科技流向能源 + 公用事业**。Energy SPDR (XLE) 季度涨幅 8.4%，Utilities (XLU) 涨 6.1%。\n2. **金融板块小幅承压**。XLF -1.2%，主要因为 Net Interest Margin 预期下修。\n3. **Healthcare 横盘** 但内部分化：药企走强、医疗设备走弱。\n4. **小盘股（Russell 2000）vs 大盘（S&P 500）的相对强度** 持续收敛，可能预示 risk-on 进一步扩散。\n\n我把详细的 ETF 净流入数据整理成了一个表，要不要看？',
      },
    ],
  },
  'fc-1': {
    id: 'fc-1',
    title: '今天 macOS 升级 26 后的兼容性',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: '今天升级 macOS 26 之后，Electron 39 / better-sqlite3 / node-pty 还能正常跑吗？',
      },
      {
        id: 'm-2',
        role: 'assistant',
        content:
          'macOS 26 (Anchor) 主要变更是 Metal 4.5 + 新版 codesigning 规则。简要状态：\n\n- **Electron 39**：官方在 25 → 26 RC 阶段就 ship 了兼容补丁，正常运行无问题。\n- **better-sqlite3 12.10**：prebuilt binary 对 arm64 / x64 都兼容 macOS 26。\n- **node-pty**：唯一需要注意，pty4 接口在 macOS 26 上有 deprecation warning，但功能保留。建议关注 0.13 release notes。',
      },
    ],
  },
};

export function getMockThread(id: string): MockThread | null {
  return MOCK_THREADS[id] ?? null;
}
