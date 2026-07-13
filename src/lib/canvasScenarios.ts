/**
 * 智能画布「场景快速开始」：启动页一键铺出一套连好线的工作流（纯数据 + 纯校验）。
 *
 * 为什么放这里：场景蓝图不依赖 store / React，抽成纯定义才能被 vitest 直接锁定——
 * 每条连线都必须通过 canvasConnectRules.canConnectKinds（连线规则的单一真相），
 * 日后改连线规则时测试会立刻拦住场景漂移，而不是让用户点出一张「连不上」的画布。
 *
 * 建图执行（addNode/updateNodeData/onConnect 的时序编排）在 CanvasLauncher 里，
 * 因为那一步必须操作 zustand store——留在这里会污染纯函数测试。
 */
import type { SmartNodeKind } from '@shared/smartCanvas';
import { canConnectKinds } from './canvasConnectRules';

export interface ScenarioNodeSpec {
  kind: SmartNodeKind;
  /** 相对 (0,0) 的落位：上游在左、下游在右（x 步进 ~360），同列多节点纵向错开避免重叠 */
  pos: { x: number; y: number };
  /** 初始 data 覆盖（在 addNode 默认值之上补差异，如提示词列表模式 / 生图节点类型） */
  data?: Record<string, unknown>;
}

export interface ScenarioEdgeSpec {
  /** 源节点在 nodes 数组中的索引 */
  from: number;
  /** 目标节点在 nodes 数组中的索引 */
  to: number;
}

export interface CanvasScenario {
  id: string;
  name: string;
  /** 场景卡图标（emoji，与启动页卡片风格一致，零资源依赖） */
  icon: string;
  /** 一句话说明（卡片副标题 + title 提示） */
  desc: string;
  nodes: ScenarioNodeSpec[];
  edges: ScenarioEdgeSpec[];
}

// 纵向错开的经验值：提示词节点默认高 280、图片节点高 200，
// 同列两个上游节点用 260~340 的 y 间距才不叠卡（"~200 间距"对矮节点适用，对提示词节点需放宽）。
export const CANVAS_SCENARIOS: CanvasScenario[] = [
  {
    id: 'text-to-image',
    name: '文生图',
    icon: '✏️',
    desc: '提示词 → 生图 → 结果，最基础的一条龙',
    nodes: [
      { kind: 'prompt', pos: { x: 0, y: 0 } },
      { kind: 'work', pos: { x: 360, y: 0 } },
      { kind: 'result', pos: { x: 720, y: 0 } }
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ]
  },
  {
    id: 'image-edit',
    name: '图生图改图',
    icon: '🖼️',
    desc: '参考图 + 提示词 → 编辑生成新图',
    nodes: [
      { kind: 'image', pos: { x: 0, y: 0 } },
      { kind: 'prompt', pos: { x: 0, y: 260 } },
      // 生图节点默认是「图片生成」，接了参考图的场景应当直接是「图片编辑」，免得用户再点一次
      { kind: 'work', pos: { x: 360, y: 120 }, data: { workType: 'image-edit' } },
      { kind: 'result', pos: { x: 720, y: 150 } }
    ],
    edges: [
      { from: 0, to: 2 },
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ]
  },
  {
    id: 'multi-prompt-batch',
    name: '多提示词批量',
    icon: '📋',
    desc: '一次填多条提示词，逐条各出一张',
    nodes: [
      // 直接进入列表模式并预置 3 个空条目：用户看到的就是「往格子里填」的批量形态
      { kind: 'prompt', pos: { x: 0, y: 0 }, data: { listMode: true, items: ['', '', ''] } },
      { kind: 'work', pos: { x: 360, y: 40 } },
      { kind: 'result', pos: { x: 720, y: 70 } }
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 }
    ]
  },
  {
    id: 'storyboard-to-video',
    name: '故事转视频分镜',
    icon: '🎬',
    desc: '角色描述 + 短故事 → 整段时间轴分镜 → 视频',
    nodes: [
      { kind: 'prompt', pos: { x: 0, y: 0 } },
      { kind: 'storyboard', pos: { x: 360, y: 0 } },
      { kind: 'video', pos: { x: 720, y: 0 } },
      { kind: 'result', pos: { x: 1080, y: 0 } }
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ]
  },
  {
    id: 'character-card-sheet',
    name: '角色设定',
    icon: '🪪',
    desc: '人物照片 + 简述 → 角色卡提示词 → 生图出设定卡',
    nodes: [
      { kind: 'image', pos: { x: 0, y: 0 } },
      { kind: 'prompt', pos: { x: 0, y: 300 } },
      { kind: 'character-card', pos: { x: 360, y: 60 } },
      { kind: 'work', pos: { x: 740, y: 100 } },
      { kind: 'result', pos: { x: 1100, y: 130 } }
    ],
    edges: [
      { from: 0, to: 2 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 }
    ]
  },
  {
    id: 'video-generation',
    name: '视频生成',
    icon: '🎥',
    desc: '提示词 + 首帧图 → AI 视频',
    nodes: [
      { kind: 'prompt', pos: { x: 0, y: 0 } },
      { kind: 'image', pos: { x: 0, y: 340 } },
      { kind: 'video', pos: { x: 360, y: 160 } },
      { kind: 'result', pos: { x: 720, y: 190 } }
    ],
    edges: [
      { from: 0, to: 2 },
      { from: 1, to: 2 },
      { from: 2, to: 3 }
    ]
  }
];

/**
 * 校验一个场景蓝图：索引越界 / 连线类型不合法都会报出来。
 * 返回问题列表（空 = 合法）。建图方与 vitest 共用，保证「测试通过 ⇔ 点击可用」。
 */
export function validateScenario(sc: CanvasScenario): string[] {
  const problems: string[] = [];
  if (!sc.nodes.length) problems.push(`场景「${sc.id}」没有节点`);
  sc.edges.forEach((e, i) => {
    const s = sc.nodes[e.from];
    const t = sc.nodes[e.to];
    if (!s || !t) {
      problems.push(`场景「${sc.id}」连线 ${i}（${e.from}→${e.to}）索引越界`);
      return;
    }
    if (!canConnectKinds(s.kind, t.kind)) {
      problems.push(`场景「${sc.id}」连线 ${i}（${s.kind}→${t.kind}）不符合连线规则`);
    }
  });
  return problems;
}
