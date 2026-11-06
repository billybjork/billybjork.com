import type { InlineToolbar } from './inline-toolbar';
import type { MediaController } from './media-selection';
import type { SlashMenu } from './slash';
import type { BlockStore } from './store';

export interface DragState {
  sourceIndex: number | null;
  dropIndex: number | null;
}

/** What block rendering needs from the session; session.ts builds one per editor. */
export interface EditorContext {
  readonly store: BlockStore;
  readonly blocksRoot: HTMLElement;
  readonly media: MediaController;
  readonly slash: SlashMenu;
  readonly inlineToolbar: InlineToolbar;
  readonly drag: DragState;
}
