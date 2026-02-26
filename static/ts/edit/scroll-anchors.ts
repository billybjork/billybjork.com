export interface RenderScrollAnchor {
  blockId: string | null;
  blockIndex: number;
  blockTop: number;
}

export interface ContainerScrollAnchor {
  offsetWithinContainer: number;
}

export interface ModeSwitchBlockAnchor {
  blockIndex: number;
  blockTop: number;
}

interface RenderRestoreOptions {
  anchor: RenderScrollAnchor | null;
  container: HTMLElement | null;
  blockCount: number;
}

interface ModeSwitchRestoreOptions {
  anchor: ModeSwitchBlockAnchor | null;
  container: HTMLElement | null;
  blockCount: number;
  stabilityRoot?: ParentNode;
}

interface ContainerRestoreOptions {
  contentContainer: HTMLElement;
  anchor: ContainerScrollAnchor;
  stabilityRoot?: ParentNode;
}

export class ScrollAnchorManager {
  private renderScrollRestoreToken = 0;
  private containerScrollRestoreToken = 0;
  private modeSwitchScrollRestoreToken = 0;

  constructor(
    private readonly passCount = 3,
    private readonly mediaPassCount = 2
  ) {}

  captureRenderScrollAnchor(container: HTMLElement | null): RenderScrollAnchor | null {
    if (!container) return null;

    const wrappers = Array.from(container.querySelectorAll<HTMLElement>('.block-wrapper[data-block-id]'));
    if (wrappers.length === 0) return null;

    const anchor =
      wrappers.find((wrapper) => wrapper.getBoundingClientRect().bottom >= 0) ??
      wrappers[wrappers.length - 1] ??
      null;
    if (!anchor) return null;

    const blockId = anchor.dataset.blockId ?? null;
    const parsedIndex = Number.parseInt(anchor.dataset.blockIndex ?? '', 10);
    const blockIndex = Number.isNaN(parsedIndex) ? 0 : parsedIndex;

    return {
      blockId,
      blockIndex,
      blockTop: anchor.getBoundingClientRect().top,
    };
  }

  restoreRenderScrollAnchor({ anchor, container, blockCount }: RenderRestoreOptions): void {
    if (!anchor || !container || blockCount === 0) return;

    const token = ++this.renderScrollRestoreToken;
    const restoreOnce = (): void => {
      if (!container || blockCount === 0) return;

      let target: HTMLElement | null = null;
      if (anchor.blockId) {
        target = container.querySelector<HTMLElement>(`.block-wrapper[data-block-id="${anchor.blockId}"]`);
      }
      if (!target) {
        const fallbackIndex = Math.max(0, Math.min(anchor.blockIndex, blockCount - 1));
        target = container.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${fallbackIndex}"]`);
      }
      if (!target) return;

      const delta = target.getBoundingClientRect().top - anchor.blockTop;
      if (Math.abs(delta) < 1) return;

      this.withInstantScroll(() => {
        window.scrollTo({
          top: this.clampScrollTop(window.scrollY + delta),
          left: 0,
          behavior: 'auto',
        });
      });
    };

    this.scheduleScrollRestorePasses(
      token,
      () => this.renderScrollRestoreToken,
      restoreOnce,
      this.passCount
    );

    this.bindMediaShiftReanchors(container, () => {
      this.scheduleScrollRestorePasses(
        token,
        () => this.renderScrollRestoreToken,
        restoreOnce,
        this.mediaPassCount
      );
    });
  }

  captureContainerScrollAnchor(contentContainer: HTMLElement): ContainerScrollAnchor {
    const contentTop = window.scrollY + contentContainer.getBoundingClientRect().top;
    return {
      offsetWithinContainer: window.scrollY - contentTop,
    };
  }

  captureContentBlockAnchor(contentContainer: HTMLElement): ModeSwitchBlockAnchor | null {
    const blocks = Array.from(contentContainer.querySelectorAll<HTMLElement>('.content-block'));
    if (blocks.length === 0) return null;

    const anchor =
      blocks.find((block) => block.getBoundingClientRect().bottom >= 0) ??
      blocks[blocks.length - 1] ??
      null;
    if (!anchor) return null;

    const blockIndex = blocks.indexOf(anchor);
    if (blockIndex < 0) return null;

    return {
      blockIndex,
      blockTop: anchor.getBoundingClientRect().top,
    };
  }

  restoreModeSwitchBlockAnchor({
    anchor,
    container,
    blockCount,
    stabilityRoot = container ?? document.body,
  }: ModeSwitchRestoreOptions): void {
    if (!anchor || !container || blockCount === 0) return;

    const token = ++this.modeSwitchScrollRestoreToken;
    const restoreOnce = (): void => {
      if (!container || blockCount === 0) return;

      const clampedIndex = Math.max(0, Math.min(anchor.blockIndex, blockCount - 1));
      const target = container.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${clampedIndex}"]`);
      if (!target) return;

      const delta = target.getBoundingClientRect().top - anchor.blockTop;
      if (Math.abs(delta) < 1) return;

      this.withInstantScroll(() => {
        window.scrollTo({
          top: this.clampScrollTop(window.scrollY + delta),
          left: 0,
          behavior: 'auto',
        });
      });
    };

    this.scheduleScrollRestorePasses(
      token,
      () => this.modeSwitchScrollRestoreToken,
      restoreOnce,
      this.passCount
    );

    this.bindMediaShiftReanchors(stabilityRoot, () => {
      this.scheduleScrollRestorePasses(
        token,
        () => this.modeSwitchScrollRestoreToken,
        restoreOnce,
        this.mediaPassCount
      );
    });
  }

  restoreContainerScrollAnchor({
    contentContainer,
    anchor,
    stabilityRoot = contentContainer,
  }: ContainerRestoreOptions): void {
    const token = ++this.containerScrollRestoreToken;
    const restoreOnce = (): void => {
      const contentTop = window.scrollY + contentContainer.getBoundingClientRect().top;
      const nextScrollTop = contentTop + anchor.offsetWithinContainer;
      this.withInstantScroll(() => {
        window.scrollTo({
          top: this.clampScrollTop(nextScrollTop),
          left: 0,
          behavior: 'auto',
        });
      });
    };

    this.scheduleScrollRestorePasses(
      token,
      () => this.containerScrollRestoreToken,
      restoreOnce,
      this.passCount
    );

    this.bindMediaShiftReanchors(stabilityRoot, () => {
      this.scheduleScrollRestorePasses(
        token,
        () => this.containerScrollRestoreToken,
        restoreOnce,
        this.mediaPassCount
      );
    });
  }

  private withInstantScroll(action: () => void): void {
    const html = document.documentElement;
    const previousInlineScrollBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';

    action();

    requestAnimationFrame(() => {
      if (previousInlineScrollBehavior) {
        html.style.scrollBehavior = previousInlineScrollBehavior;
      } else {
        html.style.removeProperty('scroll-behavior');
      }
    });
  }

  private clampScrollTop(top: number): number {
    const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(top, maxScrollTop));
  }

  private scheduleScrollRestorePasses(
    token: number,
    getCurrentToken: () => number,
    restoreOnce: () => void,
    passCount: number
  ): void {
    if (passCount <= 0) return;

    let remainingPasses = passCount;
    const runPass = (): void => {
      if (token !== getCurrentToken()) return;
      restoreOnce();
      remainingPasses -= 1;
      if (remainingPasses > 0) {
        requestAnimationFrame(runPass);
      }
    };

    requestAnimationFrame(runPass);
  }

  private bindMediaShiftReanchors(
    root: ParentNode,
    onMediaShift: () => void
  ): void {
    root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      if (img.complete) return;
      img.addEventListener('load', onMediaShift, { once: true });
      img.addEventListener('error', onMediaShift, { once: true });
    });

    root.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
      if (video.readyState >= 1) return;
      video.addEventListener('loadedmetadata', onMediaShift, { once: true });
      video.addEventListener('error', onMediaShift, { once: true });
    });
  }
}
