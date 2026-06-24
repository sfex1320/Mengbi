import { describe, it, expect } from 'vitest';
import { pickStreamImage } from './imageStreamParse';

describe('pickStreamImage —— 从图像 SSE 事件抽图片载荷（多形态兼容）', () => {
  it('OpenAI 官方：b64_json', () => {
    expect(pickStreamImage({ type: 'image_generation.completed', b64_json: 'AAAA' })).toEqual({ b64: 'AAAA' });
  });
  it('中间步骤图：partial_image_b64', () => {
    expect(pickStreamImage({ type: 'image_generation.partial_image', partial_image_b64: 'BBBB' })).toEqual({ b64: 'BBBB' });
  });
  it('Responses 风格：result 作 b64', () => {
    expect(pickStreamImage({ type: 'response.completed', result: 'CCCC' })).toEqual({ b64: 'CCCC' });
  });
  it('差异中转站：终态图只给 url（顶层）', () => {
    expect(pickStreamImage({ type: 'image_generation.completed', url: 'https://u/x.png' })).toEqual({ url: 'https://u/x.png' });
  });
  it('差异中转站：image_url 顶层', () => {
    expect(pickStreamImage({ image_url: 'https://u/y.png' })).toEqual({ url: 'https://u/y.png' });
  });
  it('data[0].url（OpenAI images 普通响应被当事件塞进来）', () => {
    expect(pickStreamImage({ data: [{ url: 'https://u/d.png' }] })).toEqual({ url: 'https://u/d.png' });
  });
  it('data[0].b64_json', () => {
    expect(pickStreamImage({ data: [{ b64_json: 'DDDD' }] })).toEqual({ b64: 'DDDD' });
  });
  it('image.{b64_json|url} 对象', () => {
    expect(pickStreamImage({ image: { b64_json: 'EEEE' } })).toEqual({ b64: 'EEEE' });
    expect(pickStreamImage({ image: { url: 'https://u/e.png' } })).toEqual({ url: 'https://u/e.png' });
  });
  it('images[0] 裸 http 串 / 对象', () => {
    expect(pickStreamImage({ images: ['https://u/f.png'] })).toEqual({ url: 'https://u/f.png' });
    expect(pickStreamImage({ images: [{ url: 'https://u/g.png' }] })).toEqual({ url: 'https://u/g.png' });
  });
  it('b64 优先于 url（同时存在取 b64）', () => {
    expect(pickStreamImage({ b64_json: 'ZZ', url: 'https://u/z.png' })).toEqual({ b64: 'ZZ' });
  });
  it('非图载荷（纯状态/心跳事件）→ null', () => {
    expect(pickStreamImage({ type: 'response.output_item.added' })).toBeNull();
    expect(pickStreamImage({ type: 'image_generation.partial_image', partial_image_index: 0 })).toBeNull();
    expect(pickStreamImage({})).toBeNull();
  });
  it('空串不算命中（避免把空字段当图）', () => {
    expect(pickStreamImage({ b64_json: '', url: '' })).toBeNull();
  });
  it('images[0] 是非 http 串（如 data:）不当 url 收（交由 b64 路径或忽略）', () => {
    expect(pickStreamImage({ images: ['data:image/png;base64,AAAA'] })).toBeNull();
  });
});
