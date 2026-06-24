import type { PromptMallCard } from '../cardTypes';

// 中国风-男（古代到现代的男性服饰）。
export const CHINA_MALE_CARDS: PromptMallCard[] = [
  // 先秦·汉 pre-qin-han (8)
  { id: 'china-male.pre-qin-han.quju-shenyi', cat: 'china-male', sub: 'pre-qin-han', zh: '曲裾深衣', en: 'curved-hem shenyi robe', genPrompt: 'a man wearing a han curved-hem shenyi robe, full body, spiral wrapped layers and broad crossed collar' },
  { id: 'china-male.pre-qin-han.zhiju-pao', cat: 'china-male', sub: 'pre-qin-han', zh: '直裾袍', en: 'straight-hem pao robe', genPrompt: 'a man wearing a han straight-hem pao robe, full body, dark borders edging the collar and wide cuffs' },
  { id: 'china-male.pre-qin-han.xuanduan', cat: 'china-male', sub: 'pre-qin-han', zh: '玄端礼服', en: 'xuanduan ceremonial robe', genPrompt: 'a man wearing a black xuanduan ceremonial robe, full body, plain solemn cut with a wide sash' },
  { id: 'china-male.pre-qin-han.han-ruku', cat: 'china-male', sub: 'pre-qin-han', zh: '汉襦裤', en: 'han jacket and trousers', genPrompt: 'a man wearing a han short jacket over trousers, full body, crossed collar tied at the waist' },
  { id: 'china-male.pre-qin-han.han-guanfu', cat: 'china-male', sub: 'pre-qin-han', zh: '汉冠服', en: 'han crown-and-robe', genPrompt: 'a man wearing a formal han crown and ceremonial robe, full body, tall lacquered cap and layered gown' },
  { id: 'china-male.pre-qin-han.shenyi-plain', cat: 'china-male', sub: 'pre-qin-han', zh: '素深衣', en: 'plain shenyi robe', genPrompt: 'a man wearing a plain shenyi deep robe, full body, full-length one-piece cut belted at the waist' },
  { id: 'china-male.pre-qin-han.chu-changpao', cat: 'china-male', sub: 'pre-qin-han', zh: '楚式长袍', en: 'chu state long robe', genPrompt: 'a man wearing a chu state long robe, full body, slim silhouette with curling cloud embroidery' },
  { id: 'china-male.pre-qin-han.han-quju-pao', cat: 'china-male', sub: 'pre-qin-han', zh: '汉曲裾袍', en: 'han curved-hem gown', genPrompt: 'a man wearing a han curved-hem gown, full body, triangular wrapped panel sweeping to the floor' },

  // 魏晋·南北朝 wei-jin (7)
  { id: 'china-male.wei-jin.baoyi-bodai', cat: 'china-male', sub: 'wei-jin', zh: '褒衣博带', en: 'loose robe with wide sash', genPrompt: 'a man wearing a loose flowing robe with a wide sash, full body, relaxed open silhouette of a scholar' },
  { id: 'china-male.wei-jin.daxiu-shan', cat: 'china-male', sub: 'wei-jin', zh: '大袖衫', en: 'large-sleeve gown', genPrompt: 'a man wearing a wei-jin large-sleeve gown, full body, enormous draping open sleeves' },
  { id: 'china-male.wei-jin.mingshi-pao', cat: 'china-male', sub: 'wei-jin', zh: '名士袍', en: 'scholar-recluse robe', genPrompt: 'a man wearing a wei-jin scholar-recluse robe, full body, airy unhurried layers and a head cloth' },
  { id: 'china-male.wei-jin.hechang', cat: 'china-male', sub: 'wei-jin', zh: '鹤氅裘', en: 'crane-feather cloak', genPrompt: 'a man wearing a crane-feather hechang cloak over a robe, full body, sleeveless flowing overgarment' },
  { id: 'china-male.wei-jin.fujin-pao', cat: 'china-male', sub: 'wei-jin', zh: '幅巾袍', en: 'cloth-band robe', genPrompt: 'a man wearing a robe with a tied cloth headband, full body, simple wrapped headcloth and wide gown' },
  { id: 'china-male.wei-jin.kuanshan-dachang', cat: 'china-male', sub: 'wei-jin', zh: '宽衫大氅', en: 'wide gown and cloak', genPrompt: 'a man wearing a wide gown under a long cloak, full body, billowing layered overcoat' },
  { id: 'china-male.wei-jin.zhulin-pao', cat: 'china-male', sub: 'wei-jin', zh: '竹林隐袍', en: 'bamboo-grove recluse robe', genPrompt: 'a man wearing a bamboo-grove recluse robe, full body, loose carefree drape with a casual open collar' },

  // 唐制 tang (8)
  { id: 'china-male.tang.yuanling-pao', cat: 'china-male', sub: 'tang', zh: '唐圆领袍', en: 'tang round-collar robe', genPrompt: 'a man wearing a tang round-collar robe, full body, fitted belt and side-slit hem' },
  { id: 'china-male.tang.lanshan', cat: 'china-male', sub: 'tang', zh: '唐襕衫', en: 'tang lanshan scholar gown', genPrompt: 'a man wearing a tang lanshan scholar gown, full body, round collar with a horizontal hem band' },
  { id: 'china-male.tang.quekua-pao', cat: 'china-male', sub: 'tang', zh: '唐缺胯袍', en: 'tang side-slit robe', genPrompt: 'a man wearing a tang side-slit robe for riding, full body, open hip slits and a leather belt' },
  { id: 'china-male.tang.wuguan-pao', cat: 'china-male', sub: 'tang', zh: '唐武官袍', en: 'tang military officer robe', genPrompt: 'a man wearing a tang military officer robe, full body, round-collar gown with armor accents and belt plaques' },
  { id: 'china-male.tang.futou-yuanling', cat: 'china-male', sub: 'tang', zh: '唐幞头圆领袍', en: 'tang futou and round-collar robe', genPrompt: 'a man wearing a tang round-collar robe with a black futou headwrap, full body, neat belted gown' },
  { id: 'china-male.tang.fanling-hufu', cat: 'china-male', sub: 'tang', zh: '唐翻领胡服', en: 'tang lapel hu-style outfit', genPrompt: 'a man wearing a tang lapel hu-style outfit, full body, folded lapels narrow sleeves and trousers' },
  { id: 'china-male.tang.banbi-paoshan', cat: 'china-male', sub: 'tang', zh: '唐半臂袍衫', en: 'tang half-sleeve robe', genPrompt: 'a man wearing a tang robe with a half-sleeve jacket, full body, short outer sleeves over a long gown' },
  { id: 'china-male.tang.zhaixiu-qizhuang', cat: 'china-male', sub: 'tang', zh: '唐窄袖骑装', en: 'tang narrow-sleeve riding dress', genPrompt: 'a man wearing a tang narrow-sleeve riding outfit, full body, slim trousers and a fitted short robe' },

  // 宋制 song (7)
  { id: 'china-male.song.zhiduo', cat: 'china-male', sub: 'song', zh: '宋直裰', en: 'song zhiduo robe', genPrompt: 'a man wearing a song zhiduo robe, full body, straight-cut gown with a center back seam and wide sleeves' },
  { id: 'china-male.song.nan-beizi', cat: 'china-male', sub: 'song', zh: '宋男褙子', en: 'song mens beizi', genPrompt: 'a man wearing a song open-front beizi over a robe, full body, long parallel side slits' },
  { id: 'china-male.song.lanshan', cat: 'china-male', sub: 'song', zh: '宋襕衫', en: 'song lanshan gown', genPrompt: 'a man wearing a song lanshan scholar gown, full body, plain pale gown with a hem band' },
  { id: 'china-male.song.shenyi', cat: 'china-male', sub: 'song', zh: '宋深衣', en: 'song shenyi robe', genPrompt: 'a man wearing a song shenyi robe, full body, dignified crossed collar and a knotted sash' },
  { id: 'china-male.song.daofu', cat: 'china-male', sub: 'song', zh: '宋道服', en: 'song daoist-style robe', genPrompt: 'a man wearing a song daoist-style robe, full body, wide-sleeved gown trimmed with dark borders' },
  { id: 'china-male.song.hechang', cat: 'china-male', sub: 'song', zh: '宋鹤氅', en: 'song crane cloak', genPrompt: 'a man wearing a song crane cloak over a long robe, full body, flowing sleeveless overgarment' },
  { id: 'china-male.song.jiaoling-changshan', cat: 'china-male', sub: 'song', zh: '宋交领长衫', en: 'song crossed-collar long shirt', genPrompt: 'a man wearing a song crossed-collar long shirt, full body, slim restrained silhouette in muted tones' },

  // 明制 ming (8)
  { id: 'china-male.ming.zhishen', cat: 'china-male', sub: 'ming', zh: '明直身', en: 'ming zhishen robe', genPrompt: 'a man wearing a ming zhishen robe, full body, straight gown with side pleats and a round collar option' },
  { id: 'china-male.ming.daopao', cat: 'china-male', sub: 'ming', zh: '明道袍', en: 'ming daopao robe', genPrompt: 'a man wearing a ming daopao robe, full body, crossed collar with inner overlapping panels and wide sleeves' },
  { id: 'china-male.ming.yesa', cat: 'china-male', sub: 'ming', zh: '明曳撒', en: 'ming yesa robe', genPrompt: 'a man wearing a ming yesa robe, full body, pleated lower skirt and a fitted upper for riding' },
  { id: 'china-male.ming.tieli', cat: 'china-male', sub: 'ming', zh: '明贴里', en: 'ming tieli robe', genPrompt: 'a man wearing a ming tieli robe, full body, gathered waist seam with a densely pleated skirt' },
  { id: 'china-male.ming.yuanling-bufu', cat: 'china-male', sub: 'ming', zh: '明圆领补服', en: 'ming round-collar rank robe', genPrompt: 'a man wearing a ming round-collar official robe with a rank badge, full body, square mandarin square on the chest' },
  { id: 'china-male.ming.fangjin-changshan', cat: 'china-male', sub: 'ming', zh: '明方巾长衫', en: 'ming square-cap scholar gown', genPrompt: 'a man wearing a ming scholar gown with a square cap, full body, pale wide-sleeved robe' },
  { id: 'china-male.ming.zhaojia', cat: 'china-male', sub: 'ming', zh: '明罩甲', en: 'ming sleeveless surcoat', genPrompt: 'a man wearing a ming sleeveless zhaojia surcoat over a robe, full body, open-front military overvest' },
  { id: 'china-male.ming.chengziyi', cat: 'china-male', sub: 'ming', zh: '明程子衣', en: 'ming chengzi robe', genPrompt: 'a man wearing a ming chengzi robe, full body, waist-seamed gown with a flared pleated skirt' },

  // 清 qing (7)
  { id: 'china-male.qing.changpao-magua', cat: 'china-male', sub: 'qing', zh: '清长袍马褂', en: 'qing changpao and magua', genPrompt: 'a man wearing a qing long changpao robe under a short magua jacket, full body, mandarin buttons' },
  { id: 'china-male.qing.xinggua', cat: 'china-male', sub: 'qing', zh: '清行褂', en: 'qing riding jacket', genPrompt: 'a man wearing a qing short riding jacket over a robe, full body, hip-length button-front overcoat' },
  { id: 'china-male.qing.jianxiu-pao', cat: 'china-male', sub: 'qing', zh: '清箭袖袍', en: 'qing arrow-cuff robe', genPrompt: 'a man wearing a qing arrow-cuff robe, full body, horse-hoof shaped sleeve cuffs' },
  { id: 'china-male.qing.guapi-changshan', cat: 'china-male', sub: 'qing', zh: '清瓜皮帽长衫', en: 'qing skullcap and long shirt', genPrompt: 'a man wearing a qing long shirt with a round skullcap, full body, slim ankle-length gown' },
  { id: 'china-male.qing.quejin-pao', cat: 'china-male', sub: 'qing', zh: '清缺襟袍', en: 'qing split-front robe', genPrompt: 'a man wearing a qing split-front robe, full body, detachable front panel for riding' },
  { id: 'china-male.qing.matix-chaopao', cat: 'china-male', sub: 'qing', zh: '清马蹄袖朝袍', en: 'qing horse-hoof court robe', genPrompt: 'a man wearing a qing court robe with horse-hoof cuffs, full body, dragon-patterned ceremonial gown' },
  { id: 'china-male.qing.duijin-magua', cat: 'china-male', sub: 'qing', zh: '清对襟马褂', en: 'qing front-button magua', genPrompt: 'a man wearing a qing front-button magua jacket, full body, short straight overcoat with knotted buttons' },

  // 民国·长衫 republic (7)
  { id: 'china-male.republic.changshan', cat: 'china-male', sub: 'republic', zh: '民国长衫', en: 'republic changshan gown', genPrompt: 'a man wearing a republic-era changshan long gown, full body, plain ankle-length scholar robe' },
  { id: 'china-male.republic.changpao-magua', cat: 'china-male', sub: 'republic', zh: '民国长袍马褂', en: 'republic robe and magua', genPrompt: 'a man wearing a republic long robe under a magua jacket, full body, formal traditional gentleman outfit' },
  { id: 'china-male.republic.zhongshan', cat: 'china-male', sub: 'republic', zh: '中山装', en: 'zhongshan suit', genPrompt: 'a man wearing a zhongshan suit, full body, stand collar with four front pockets and buttoned front' },
  { id: 'china-male.republic.xuesheng-zhuang', cat: 'china-male', sub: 'republic', zh: '民国学生装', en: 'republic student uniform', genPrompt: 'a man wearing a republic student uniform, full body, stand-collar jacket and trousers' },
  { id: 'china-male.republic.majia-changshan', cat: 'china-male', sub: 'republic', zh: '马甲配长衫', en: 'waistcoat over changshan', genPrompt: 'a man wearing a western waistcoat over a changshan gown, full body, east-west blended gentleman look' },
  { id: 'china-male.republic.wenren-changpao', cat: 'china-male', sub: 'republic', zh: '文人长袍', en: 'literati long robe', genPrompt: 'a man wearing a republic literati long robe with round glasses, full body, refined scholar bearing' },
  { id: 'china-male.republic.chouduan-changpao', cat: 'china-male', sub: 'republic', zh: '绸缎长袍', en: 'silk satin long robe', genPrompt: 'a man wearing a silk satin long robe, full body, lustrous fabric with a side-fastening collar' },

  // 现代国风 modern-guofeng (8)
  { id: 'china-male.modern-guofeng.xinzhongshi', cat: 'china-male', sub: 'modern-guofeng', zh: '新中式男装', en: 'modern chinese-style menswear', genPrompt: 'a man wearing modern chinese-style menswear, full body, minimalist mandarin collar with hidden knot buttons' },
  { id: 'china-male.modern-guofeng.gailiang-changshan', cat: 'china-male', sub: 'modern-guofeng', zh: '改良长衫', en: 'restyled changshan', genPrompt: 'a man wearing a restyled slim changshan, full body, shortened tailored gown with clean lines' },
  { id: 'china-male.modern-guofeng.guofeng-xizhuang', cat: 'china-male', sub: 'modern-guofeng', zh: '国风立领西装', en: 'guofeng stand-collar suit', genPrompt: 'a man wearing a guofeng stand-collar suit, full body, fusion blazer with mandarin collar and frog buttons' },
  { id: 'china-male.modern-guofeng.tangzhuang', cat: 'china-male', sub: 'modern-guofeng', zh: '唐装', en: 'tangzhuang jacket', genPrompt: 'a man wearing a tangzhuang jacket, full body, stand collar with knotted frog buttons and brocade fabric' },
  { id: 'china-male.modern-guofeng.modern-daopao', cat: 'china-male', sub: 'modern-guofeng', zh: '现代道袍', en: 'modern daopao', genPrompt: 'a man wearing a modernized daopao robe, full body, simplified crossed collar in contemporary fabric' },
  { id: 'china-male.modern-guofeng.guofeng-jacket', cat: 'china-male', sub: 'modern-guofeng', zh: '国风夹克', en: 'guofeng jacket', genPrompt: 'a man wearing a guofeng bomber jacket, full body, streetwear cut with embroidered chinese motifs' },
  { id: 'china-male.modern-guofeng.xinzhongshi-set', cat: 'china-male', sub: 'modern-guofeng', zh: '新中式套装', en: 'modern chinese-style set', genPrompt: 'a man wearing a modern chinese-style two-piece set, full body, coordinated mandarin-collar top and trousers' },
  { id: 'china-male.modern-guofeng.lilling-panniu-shirt', cat: 'china-male', sub: 'modern-guofeng', zh: '立领盘扣衬衫', en: 'stand-collar frog-button shirt', genPrompt: 'a man wearing a stand-collar shirt with frog buttons, full body, crisp modern cut with chinese fastenings' }
];
