import type { PromptMallCard } from '../cardTypes';

// 婚服。
export const WEDDING_CARDS: PromptMallCard[] = [
  { id: 'wedding.chinese-xiuhe.classic', cat: 'wedding', sub: 'chinese-xiuhe', zh: '中式秀禾服', en: 'classic xiuhe', genPrompt: 'a person wearing a traditional red chinese xiuhe wedding robe, full body, mandarin collar' },
  { id: 'wedding.chinese-xiuhe.phoenix-embroidered', cat: 'wedding', sub: 'chinese-xiuhe', zh: '凤纹绣秀禾', en: 'phoenix xiuhe', genPrompt: 'a person wearing an embroidered xiuhe robe with phoenix motifs, full body, wide sleeves' },
  { id: 'wedding.chinese-xiuhe.dragon-phoenix-gold', cat: 'wedding', sub: 'chinese-xiuhe', zh: '金龙凤秀禾', en: 'gold dragon-phoenix xiuhe', genPrompt: 'a person wearing a red xiuhe robe with gold dragon and phoenix embroidery, full body, fitted bodice' },
  { id: 'wedding.chinese-xiuhe.modern-cut', cat: 'wedding', sub: 'chinese-xiuhe', zh: '改良秀禾服', en: 'modern xiuhe', genPrompt: 'a person wearing a modern slim-cut xiuhe wedding dress, full body, tailored silhouette' },
  { id: 'wedding.chinese-xiuhe.with-headpiece', cat: 'wedding', sub: 'chinese-xiuhe', zh: '秀禾配凤冠', en: 'xiuhe with headpiece', genPrompt: 'a person wearing a xiuhe robe paired with an ornate phoenix headpiece, full body, beaded crown' },

  { id: 'wedding.qungua.classic-kua', cat: 'wedding', sub: 'qungua', zh: '龙凤褂', en: 'longfeng kua', genPrompt: 'a person wearing a traditional red longfeng qungua jacket and skirt, full body, two-piece set' },
  { id: 'wedding.qungua.full-gold', cat: 'wedding', sub: 'qungua', zh: '褂皇', en: 'full-gold qungua', genPrompt: 'a person wearing a full-gold qungua densely embroidered with gold thread, full body, glittering surface' },
  { id: 'wedding.qungua.red-satin', cat: 'wedding', sub: 'qungua', zh: '红缎龙凤褂', en: 'red satin qungua', genPrompt: 'a person wearing a red satin qungua with dragon and phoenix patterns, full body, smooth sheen' },
  { id: 'wedding.qungua.dragon-phoenix-kua', cat: 'wedding', sub: 'qungua', zh: '龙凤呈祥褂', en: 'dragon-phoenix kua', genPrompt: 'a person wearing a dragon-phoenix kua with auspicious symmetrical embroidery, full body, mandarin collar' },
  { id: 'wedding.qungua.heavy-bead', cat: 'wedding', sub: 'qungua', zh: '重珠绣褂', en: 'heavy-bead qungua', genPrompt: 'a person wearing a heavy-bead qungua covered in dense pearl beadwork, full body, structured shoulders' },

  { id: 'wedding.hanfu-wedding.ming-mamian', cat: 'wedding', sub: 'hanfu-wedding', zh: '明制婚服', en: 'ming hanfu wedding', genPrompt: 'a person wearing a ming-style red mamian skirt and matching jacket, full body, pleated panels' },
  { id: 'wedding.hanfu-wedding.zhou-black-red', cat: 'wedding', sub: 'hanfu-wedding', zh: '周制玄纁', en: 'zhou xuanxun wedding', genPrompt: 'a person wearing a zhou-style black-and-red xuanxun ceremonial robe, full body, layered wide sleeves' },
  { id: 'wedding.hanfu-wedding.tang-style', cat: 'wedding', sub: 'hanfu-wedding', zh: '唐制婚服', en: 'tang hanfu wedding', genPrompt: 'a person wearing a tang-style high-waisted wedding hanfu, full body, flowing draped sash' },
  { id: 'wedding.hanfu-wedding.song-style', cat: 'wedding', sub: 'hanfu-wedding', zh: '宋制婚服', en: 'song hanfu wedding', genPrompt: 'a person wearing a song-style slender wedding hanfu with a long beizi, full body, narrow sleeves' },
  { id: 'wedding.hanfu-wedding.with-fengguan', cat: 'wedding', sub: 'hanfu-wedding', zh: '汉婚配凤冠', en: 'hanfu with fengguan', genPrompt: 'a person wearing a wedding hanfu crowned with an elaborate fengguan, full body, dangling beaded tassels' },

  { id: 'wedding.western-gown.a-line', cat: 'wedding', sub: 'western-gown', zh: 'A字婚纱', en: 'a-line gown', genPrompt: 'a person wearing a classic a-line white wedding gown, full body, fitted bodice flaring to floor' },
  { id: 'wedding.western-gown.ballgown', cat: 'wedding', sub: 'western-gown', zh: '蓬蓬婚纱', en: 'ballgown dress', genPrompt: 'a person wearing a voluminous ballgown wedding dress, full body, layered full skirt' },
  { id: 'wedding.western-gown.mermaid', cat: 'wedding', sub: 'western-gown', zh: '鱼尾婚纱', en: 'mermaid gown', genPrompt: 'a person wearing a mermaid wedding gown hugging the hips and flaring at the knees, full body, trumpet hem' },
  { id: 'wedding.western-gown.lace-sheath', cat: 'wedding', sub: 'western-gown', zh: '蕾丝直筒婚纱', en: 'lace sheath dress', genPrompt: 'a person wearing a lace sheath wedding dress, full body, slim column silhouette' },
  { id: 'wedding.western-gown.off-shoulder-tulle', cat: 'wedding', sub: 'western-gown', zh: '一字肩纱裙', en: 'off-shoulder tulle gown', genPrompt: 'a person wearing an off-shoulder tulle wedding gown, full body, soft layered skirt' },

  { id: 'wedding.groom.black-tuxedo', cat: 'wedding', sub: 'groom', zh: '黑色燕尾', en: 'black tuxedo', genPrompt: 'a person wearing a black tuxedo with satin lapels, full body, bow tie' },
  { id: 'wedding.groom.tailcoat', cat: 'wedding', sub: 'groom', zh: '燕尾礼服', en: 'tailcoat', genPrompt: 'a person wearing a formal tailcoat morning suit, full body, long split tails' },
  { id: 'wedding.groom.three-piece', cat: 'wedding', sub: 'groom', zh: '三件套西装', en: 'three-piece suit', genPrompt: 'a person wearing a three-piece wedding suit with waistcoat, full body, matching tie' },
  { id: 'wedding.groom.changpao-magua', cat: 'wedding', sub: 'groom', zh: '长袍马褂', en: 'changpao magua', genPrompt: 'a person wearing a chinese groom red changpao robe and magua jacket, full body, mandarin buttons' },
  { id: 'wedding.groom.ivory-suit', cat: 'wedding', sub: 'groom', zh: '米白礼服', en: 'ivory groom suit', genPrompt: 'a person wearing an ivory groom suit with a buttonhole flower, full body, slim tailored fit' },

  { id: 'wedding.modern.slip-dress', cat: 'wedding', sub: 'modern', zh: '极简吊带婚纱', en: 'slip wedding dress', genPrompt: 'a person wearing a minimalist silk slip wedding dress, full body, thin spaghetti straps' },
  { id: 'wedding.modern.satin-column', cat: 'wedding', sub: 'modern', zh: '缎面直筒婚纱', en: 'satin column gown', genPrompt: 'a person wearing a satin column bridal gown, full body, sleek floor-length cut' },
  { id: 'wedding.modern.tea-length', cat: 'wedding', sub: 'modern', zh: '茶歇短婚纱', en: 'tea-length dress', genPrompt: 'a person wearing a short tea-length wedding dress, full body, hem ending mid-calf' },
  { id: 'wedding.modern.two-piece', cat: 'wedding', sub: 'modern', zh: '两件式婚纱', en: 'two-piece bridal', genPrompt: 'a person wearing a two-piece modern bridal set with crop top and skirt, full body, exposed waist' },
  { id: 'wedding.modern.beaded-illusion', cat: 'wedding', sub: 'modern', zh: '钉珠透视轻纱', en: 'beaded illusion gown', genPrompt: 'a person wearing a beaded illusion light wedding gown, full body, sheer beaded bodice' },
];
