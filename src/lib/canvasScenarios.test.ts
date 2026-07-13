import { describe, it, expect } from 'vitest';
import { CANVAS_SCENARIOS, validateScenario } from './canvasScenarios';
import { canConnectKinds, PRODUCERS, CONSUMERS } from './canvasConnectRules';
import type { SmartNodeKind } from '../types/smartCanvas';

// 编译期穷举表：key 必须恰好覆盖 SmartNodeKind 全集（多写/漏写都会 tsc 报错）。
// 为什么不用运行时导入的节点清单——项目里没有导出「全部 kind」的运行时数组，
// 用 Record<SmartNodeKind, true> 让 typecheck 替我们保证这张表与类型定义同步。
const ALL_KINDS: Record<SmartNodeKind, true> = {
  image: true,
  prompt: true,
  work: true,
  result: true,
  group: true,
  llm: true,
  comfy: true,
  'angle-prompt': true,
  scale: true,
  ratio: true,
  text: true,
  light: true,
  palette: true,
  compare: true,
  video: true,
  'image-reverse': true,
  'video-source': true,
  'frame-interp': true,
  'video-clip': true,
  storyboard: true,
  'character-card': true,
  'prompt-mall': true,
  loop: true,
  upscale: true,
  vectorize: true,
  'folder-input': true,
  'folder-output': true,
  segment: true,
  proof: true
};
const KIND_SET = new Set(Object.keys(ALL_KINDS));

describe('canvasScenarios（场景快速开始蓝图）', () => {
  it('至少内置 5 个场景，id 唯一', () => {
    expect(CANVAS_SCENARIOS.length).toBeGreaterThanOrEqual(5);
    const ids = CANVAS_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const sc of CANVAS_SCENARIOS) {
    describe(`场景「${sc.name}」(${sc.id})`, () => {
      it('节点 kind 都是合法 SmartNodeKind', () => {
        for (const n of sc.nodes) {
          expect(KIND_SET.has(n.kind), `未知节点类型 ${n.kind}`).toBe(true);
        }
      });

      it('连线索引不越界', () => {
        for (const e of sc.edges) {
          expect(e.from).toBeGreaterThanOrEqual(0);
          expect(e.to).toBeGreaterThanOrEqual(0);
          expect(e.from, `from=${e.from} 越界`).toBeLessThan(sc.nodes.length);
          expect(e.to, `to=${e.to} 越界`).toBeLessThan(sc.nodes.length);
          expect(e.from, '不能连到自己').not.toBe(e.to);
        }
      });

      it('每条连线经 canConnectKinds 校验合法', () => {
        for (const e of sc.edges) {
          const sk = sc.nodes[e.from].kind;
          const tk = sc.nodes[e.to].kind;
          expect(canConnectKinds(sk, tk), `${sk} → ${tk} 应可连接`).toBe(true);
          // 顺带钉死方向端点资格（canConnectKinds 内部含这两项，显式断言便于失败时读原因）
          expect(PRODUCERS.has(sk), `${sk} 应是产出方`).toBe(true);
          expect(CONSUMERS.has(tk), `${tk} 应是接收方`).toBe(true);
        }
      });

      it('validateScenario 无问题（建图方与测试共用同一校验）', () => {
        expect(validateScenario(sc)).toEqual([]);
      });

      it('布局：上游在左、下游在右（连线沿 x 正方向）', () => {
        for (const e of sc.edges) {
          const s = sc.nodes[e.from];
          const t = sc.nodes[e.to];
          expect(s.pos.x, `${s.kind} 应在 ${t.kind} 左侧`).toBeLessThan(t.pos.x);
        }
      });

      it('坐标有限且非负（以 (0,0) 为原点的相对坐标）', () => {
        for (const n of sc.nodes) {
          expect(Number.isFinite(n.pos.x)).toBe(true);
          expect(Number.isFinite(n.pos.y)).toBe(true);
          expect(n.pos.x).toBeGreaterThanOrEqual(0);
          expect(n.pos.y).toBeGreaterThanOrEqual(0);
        }
      });
    });
  }

  it('多提示词批量场景预置了列表模式', () => {
    const sc = CANVAS_SCENARIOS.find((s) => s.id === 'multi-prompt-batch');
    expect(sc).toBeTruthy();
    const prompt = sc?.nodes.find((n) => n.kind === 'prompt');
    expect(prompt?.data?.listMode).toBe(true);
    expect(Array.isArray(prompt?.data?.items)).toBe(true);
  });

  it('图生图场景的生图节点预置为「图片编辑」类型', () => {
    const sc = CANVAS_SCENARIOS.find((s) => s.id === 'image-edit');
    const work = sc?.nodes.find((n) => n.kind === 'work');
    expect(work?.data?.workType).toBe('image-edit');
  });
});
