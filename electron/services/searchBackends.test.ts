import { describe, it, expect } from 'vitest';
import { planSearch, getSearchBackendLabel, type SearchPrefs } from './searchBackends';

/** 一份"全部凭据齐全"的 prefs，测试时按需置空某项 */
function fullPrefs(overrides: Partial<SearchPrefs> = {}): SearchPrefs {
  return {
    backend: 'ddg',
    tavilyKey: 'tv-key',
    searxngUrl: 'https://searx.example.com',
    bochaKey: 'bo-key',
    zhipuKey: 'zp-key',
    jinaKey: 'jn-key',
    serperKey: 'sp-key',
    ...overrides
  };
}

describe('planSearch —— native/off/未知 → disabled（本就不代搜）', () => {
  for (const backend of ['native', 'off', 'whoknows'] as const) {
    it(`backend=${backend} → disabled`, () => {
      const plan = planSearch(fullPrefs({ backend: backend as SearchPrefs['backend'] }));
      expect(plan.kind).toBe('disabled');
    });
  }
});

describe('planSearch —— 无凭据后端 ddg 永远可跑', () => {
  it('ddg → run（不需要 key）', () => {
    const plan = planSearch(fullPrefs({ backend: 'ddg' }));
    expect(plan).toEqual({ kind: 'run', backend: 'ddg' });
  });
});

describe('planSearch —— 凭据齐全 → run', () => {
  for (const backend of ['tavily', 'searxng', 'bocha', 'zhipu', 'jina', 'serper'] as const) {
    it(`${backend} 有凭据 → run`, () => {
      const plan = planSearch(fullPrefs({ backend }));
      expect(plan).toEqual({ kind: 'run', backend });
    });
  }
});

describe('planSearch —— 缺凭据 → no-credential（回归：不再误报、原因准确）', () => {
  const cases: Array<{ backend: SearchPrefs['backend']; blank: keyof SearchPrefs }> = [
    { backend: 'tavily', blank: 'tavilyKey' },
    { backend: 'searxng', blank: 'searxngUrl' },
    { backend: 'bocha', blank: 'bochaKey' },
    { backend: 'zhipu', blank: 'zhipuKey' },
    { backend: 'jina', blank: 'jinaKey' },
    { backend: 'serper', blank: 'serperKey' }
  ];
  for (const { backend, blank } of cases) {
    it(`${backend} 缺 ${blank} → no-credential`, () => {
      const plan = planSearch(fullPrefs({ backend, [blank]: '' } as Partial<SearchPrefs>));
      expect(plan.kind).toBe('no-credential');
      if (plan.kind === 'no-credential') {
        expect(plan.backend).toBe(backend);
        expect(plan.message).toContain(getSearchBackendLabel(backend));
        expect(plan.message).toContain('联网搜索');
      }
    });
  }

  it('凭据是纯空白（空格）也算缺失', () => {
    const plan = planSearch(fullPrefs({ backend: 'tavily', tavilyKey: '   ' }));
    expect(plan.kind).toBe('no-credential');
  });
});

describe('getSearchBackendLabel', () => {
  it('已知后端给人类可读名', () => {
    expect(getSearchBackendLabel('tavily')).toBe('Tavily');
    expect(getSearchBackendLabel('bocha')).toBe('博查 Bocha');
  });
  it('native/off/未知原样返回 id', () => {
    expect(getSearchBackendLabel('native')).toBe('native');
    expect(getSearchBackendLabel('off')).toBe('off');
  });
});
