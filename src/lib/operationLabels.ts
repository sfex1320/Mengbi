/**
 * IPC 通道名 → 中文短标签。
 * 通知中心面板展示用。未命中字典时回退到原始 channel 字符串。
 *
 * 只列"写动作"类通道——读类（list/get/history/...）不会进入通知中心，
 * 不必在此维护标签。
 */

const LABELS: Record<string, string> = {
  // chat
  'api:chat:send': '发送对话消息',
  'api:chat:create': '新建对话',
  'api:chat:rename': '重命名对话',
  'api:chat:delete': '删除对话',
  'api:chat:clear-all': '清空所有对话',
  'api:chat:cancel': '取消对话流式',
  'api:chat:optimize-prompt': '优化提示词',
  // image
  'api:image:generate': '提交绘图任务',
  'api:image:cancel': '取消绘图任务',
  // gallery / album
  'api:gallery:update': '更新图片元数据',
  'api:album:upsert': '保存相册',
  'api:album:delete': '删除相册',
  // settings / plan
  'api:settings:save': '保存设置',
  'api:settings:test-connection': '测试模型连通',
  'api:plan:upsert': '保存方案',
  'api:plan:delete': '删除方案',
  'api:plan:config:delete': '删除模型配置',
  // lab（页面已下线，reverse 仍被智能画布复用）
  'api:lab:reverse': '反推图像',
  'api:lab:translate': '翻译文本',
  // storage / theme / export
  'api:storage:select': '选择文件夹',
  'api:storage:pick-images': '选择图片',
  'api:storage:save-temp-image': '保存临时图片',
  'api:storage:show-in-folder': '在文件管理器中打开',
  'api:theme:save': '保存自定义主题',
  'api:export:card': '导出作品卡片',
  // 异步任务推送
  'image:done': '绘图任务完成',
  'chat:done': '对话流式结束',
};

export function labelForChannel(channel: string): string {
  return LABELS[channel] ?? channel;
}
