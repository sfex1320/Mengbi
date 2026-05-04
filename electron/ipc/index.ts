import { registerSettingsHandlers } from './settings';
import { registerChatHandlers } from './chat';
import { registerGenerateHandlers } from './generate';
import { registerGalleryHandlers } from './gallery';
import { registerLabHandlers } from './lab';
import { registerMiscHandlers } from './misc';
import { registerDragHandlers } from './drag';

export function registerAllIpcHandlers(): void {
  registerSettingsHandlers();
  registerChatHandlers();
  registerGenerateHandlers();
  registerGalleryHandlers();
  registerLabHandlers();
  registerMiscHandlers();
  registerDragHandlers();
}
