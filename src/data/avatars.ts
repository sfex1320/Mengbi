/**
 * 内置头像清单。Vite 会把 png 打包成带 hash 的资源 URL。
 * 用户也能上传自定义图片，存到 settings 表的 user_avatar（dataUri）。
 */

import doctor from '@/assets/avatars/doctor.png';
import lawyer from '@/assets/avatars/lawyer.png';
import panda from '@/assets/avatars/panda.png';
import painter from '@/assets/avatars/painter.png';
import crane from '@/assets/avatars/crane.png';
import coder from '@/assets/avatars/coder.png';
import pangolin from '@/assets/avatars/pangolin.png';
import teacher from '@/assets/avatars/teacher.png';
import designer from '@/assets/avatars/designer.png';
import crocodile from '@/assets/avatars/crocodile.png';
import defaultAvatar from '@/assets/avatars/default.png';

export interface BuiltinAvatar {
  key: string;
  label: string;
  url: string;
}

export const BUILTIN_AVATARS: BuiltinAvatar[] = [
  { key: 'default', label: '默认', url: defaultAvatar },
  { key: 'painter', label: '画家', url: painter },
  { key: 'designer', label: '设计师', url: designer },
  { key: 'coder', label: '程序员', url: coder },
  { key: 'doctor', label: '医生', url: doctor },
  { key: 'lawyer', label: '律师', url: lawyer },
  { key: 'teacher', label: '老师', url: teacher },
  { key: 'panda', label: '熊猫', url: panda },
  { key: 'crane', label: '白鹤', url: crane },
  { key: 'pangolin', label: '穿山甲', url: pangolin },
  { key: 'crocodile', label: '鳄鱼', url: crocodile }
];

export const DEFAULT_AVATAR_KEY = 'default';
