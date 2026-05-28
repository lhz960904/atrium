import type { Thread } from './chat-types';

const MOCK_THREADS: Record<string, Thread> = {
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
        trace: {
          summary: 'Worked for 4s',
          segments: [
            {
              kind: 'narrative',
              id: 's-1',
              content:
                '好的。我同时用多个子 agent 并行调研美股各主要板块，覆盖大盘指数、科技股、板块轮动、中概股 + 港股四块。先扫一下 sectors 的总体表现，再分别深入。',
            },
          ],
        },
      },
      {
        id: 'm-3',
        role: 'user',
        content: '重点看一下 sector rotation，最近几个月资金到底从哪里出、流到哪里去',
      },
      {
        id: 'm-4',
        role: 'assistant',
        trace: {
          summary: 'Worked for 18s',
          segments: [
            {
              kind: 'narrative',
              id: 's-1',
              content: '我先搜一下最近一季度各 sector ETF 的资金流向，定位资金转移的方向。',
            },
            {
              kind: 'tool',
              tool: {
                id: 't-1',
                kind: 'web-search',
                verb: 'Searched',
                target: 'US sector ETF flows Q2 2026 XLE XLU XLF rotation',
                status: 'success',
                typeLabel: 'Web search',
                output:
                  'Top results:\n• Bloomberg (2026-05-22): Energy ETFs see strongest Q2 inflows since 2022; Utilities up 6%.\n• Reuters (2026-05-15): Financials face NIM headwinds; XLF net outflow $1.2B in May.\n• Schwab Sector Outlook 2026 Q2 PDF (3 weeks ago)',
              },
            },
            {
              kind: 'narrative',
              id: 's-2',
              content:
                '搜出来的几个线索都指向防御板块走强 + 金融转弱。再把 Schwab 那篇季度展望抓下来补背景。',
            },
            {
              kind: 'tool',
              tool: {
                id: 't-2',
                kind: 'web-fetch',
                verb: 'Fetched',
                target: 'schwab.com/learn/story/stock-sector-outlook-q2-2026',
                status: 'success',
                typeLabel: 'Web fetch',
                output:
                  'Title: Stock Sector Outlook — Q2 2026\nKey takeaways:\n  • Defensive rotation accelerating (Utilities +6.1%, Staples +3.8%)\n  • Energy continued strength on supply discipline (+8.4%)\n  • Tech lagging on profit-taking but breadth holding (Russell tech equal-weight +4.2%)\n  • Healthcare flat; pharma vs devices internal split widening',
              },
            },
            {
              kind: 'narrative',
              id: 's-3',
              content: '现在调出 Q2 实际的 quarterly flows 数据做对比，确认数字方向跟报告一致。',
            },
            {
              kind: 'tool',
              tool: {
                id: 't-3',
                kind: 'shell',
                verb: 'Ran',
                target: 'curl -s api.example.com/sectors | jq .quarterly_flows',
                status: 'success',
                typeLabel: 'Shell',
                command: 'curl -s api.example.com/sectors | jq .quarterly_flows',
                output:
                  '{\n  "XLE": { "q2_2026_net_inflow_usd": "+4.2B", "qoq_change": "+18%" },\n  "XLU": { "q2_2026_net_inflow_usd": "+1.8B", "qoq_change": "+11%" },\n  "XLF": { "q2_2026_net_inflow_usd": "-1.2B", "qoq_change": "-7%" },\n  "XLK": { "q2_2026_net_inflow_usd": "+0.9B", "qoq_change": "-3%" }\n}',
              },
            },
            {
              kind: 'narrative',
              id: 's-final',
              content:
                '近三个月（2026 Q2）板块轮动有几个明显信号：\n\n1. **资金从科技流向能源 + 公用事业**。Energy SPDR (XLE) 季度涨幅 8.4%，Utilities (XLU) 涨 6.1%。\n2. **金融板块小幅承压**。XLF -1.2%，主要因为 Net Interest Margin 预期下修。\n3. **Healthcare 横盘** 但内部分化：药企走强、医疗设备走弱。\n4. **小盘股（Russell 2000）vs 大盘（S&P 500）的相对强度** 持续收敛，可能预示 risk-on 进一步扩散。\n\n我把详细的 ETF 净流入数据整理成了一个表，要不要看？',
            },
          ],
        },
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
        trace: {
          summary: 'Worked for 6s',
          segments: [
            {
              kind: 'narrative',
              id: 's-1',
              content: '先确认下当前 Electron / Node 实际版本，再去查 macOS 26 的兼容性记录。',
            },
            {
              kind: 'tool',
              tool: {
                id: 't-1',
                kind: 'shell',
                verb: 'Ran',
                target: 'electron --version && node --version',
                status: 'success',
                typeLabel: 'Shell',
                command: 'electron --version && node --version',
                output: 'v39.8.10\nv24.4.0',
              },
            },
            {
              kind: 'tool',
              tool: {
                id: 't-2',
                kind: 'web-search',
                verb: 'Searched',
                target: 'Electron 39 macOS 26 compatibility notes',
                status: 'success',
                typeLabel: 'Web search',
                output: '官方 release notes 表示 Electron 39 已 ship macOS 26 RC 期间的兼容补丁。',
              },
            },
            {
              kind: 'narrative',
              id: 's-final',
              content:
                'macOS 26 (Anchor) 主要变更是 Metal 4.5 + 新版 codesigning 规则。简要状态：\n\n- **Electron 39**：官方在 25 → 26 RC 阶段就 ship 了兼容补丁，正常运行无问题。\n- **better-sqlite3 12.10**：prebuilt binary 对 arm64 / x64 都兼容 macOS 26。\n- **node-pty**：唯一需要注意，pty4 接口在 macOS 26 上有 deprecation warning，但功能保留。建议关注 0.13 release notes。',
            },
          ],
        },
      },
    ],
  },
};

export function getMockThread(id: string): Thread | null {
  return MOCK_THREADS[id] ?? null;
}
