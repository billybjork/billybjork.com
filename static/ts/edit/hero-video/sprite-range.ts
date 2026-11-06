import { clamp } from '../clamp';
import { formatMinutesSeconds } from '../text';

const MIN_DURATION = 1;
const MAX_DURATION = 6;
const DEFAULT_DURATION = 3;
const KEY_STEP_SECONDS = 0.5;

type DragTarget = 'range' | 'start' | 'end';

function playQuietly(video: HTMLVideoElement): void {
  // play() rejects when a pause or source swap interrupts it, which scrubbing does all the time.
  video.play().catch((error: unknown) => console.warn('Preview playback did not start:', error));
}

/** The timeline's selected range: the part of the video that becomes the hover sprite. */
export class SpriteRange {
  start = 0;
  duration = DEFAULT_DURATION;

  private videoDuration = 0;
  private looping = false;
  private dragTarget: DragTarget | null = null;
  private dragOffset = 0;
  private wasLoopingBeforeDrag = false;

  private readonly track: HTMLElement | null;
  private readonly range: HTMLElement | null;
  private readonly dimLeft: HTMLElement | null;
  private readonly dimRight: HTMLElement | null;
  private readonly info: HTMLElement | null;
  private readonly playhead: HTMLElement | null;
  private readonly currentTimeLabel: HTMLElement | null;

  constructor(content: Element, private readonly video: HTMLVideoElement) {
    this.track = content.querySelector('.edit-hero-timeline-track');
    this.range = content.querySelector('.edit-hero-sprite-range');
    this.dimLeft = content.querySelector('.edit-hero-timeline-dim-left');
    this.dimRight = content.querySelector('.edit-hero-timeline-dim-right');
    this.info = content.querySelector('.edit-hero-sprite-info');
    this.playhead = content.querySelector('.edit-hero-playhead');
    this.currentTimeLabel = content.querySelector('.edit-hero-current-time');
  }

  get isLooping(): boolean {
    return this.looping;
  }

  setVideoDuration(seconds: number): void {
    this.videoDuration = seconds;
    this.render();
  }

  /** Wires the timeline to the player; everything ends with `signal`. */
  attach(signal: AbortSignal): void {
    this.video.addEventListener('timeupdate', () => this.handleTimeUpdate(), { signal });
    this.track?.addEventListener('click', (event) => this.handleTrackClick(event as MouseEvent), { signal });

    if (this.range) {
      const startDragOn = (element: Element, target: DragTarget): void => {
        const guard = (event: Event): boolean => (
          target === 'range' && !!(event.target as HTMLElement).closest('.edit-hero-sprite-handle')
        );
        const begin = (event: Event, clientX: number): void => {
          this.startDrag(clientX, target);
          event.preventDefault();
          event.stopPropagation();
        };
        element.addEventListener('mousedown', (event) => {
          if (!guard(event)) begin(event, (event as MouseEvent).clientX);
        }, { signal });
        element.addEventListener('touchstart', (event) => {
          const touch = (event as TouchEvent).touches[0];
          if (touch && !guard(event)) begin(event, touch.clientX);
        }, { passive: false, signal });
      };

      startDragOn(this.range, 'range');
      const startHandle = this.range.querySelector('.edit-hero-sprite-handle--start');
      const endHandle = this.range.querySelector('.edit-hero-sprite-handle--end');
      if (startHandle) startDragOn(startHandle, 'start');
      if (endHandle) startDragOn(endHandle, 'end');

      this.range.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setLooping(!this.looping);
        if (this.looping) {
          this.video.currentTime = this.start;
          playQuietly(this.video);
        }
      }, { signal });
    }

    document.addEventListener('mousemove', (event) => this.handleDrag(event.clientX), { signal });
    document.addEventListener('mouseup', () => this.finishDrag(), { signal });
    document.addEventListener('touchmove', (event) => {
      const touch = event.touches[0];
      if (touch) this.handleDrag(touch.clientX);
    }, { passive: true, signal });
    document.addEventListener('touchend', () => this.finishDrag(), { signal });
    document.addEventListener('keydown', (event) => this.handleArrowKey(event), { signal });
  }

  private setLooping(looping: boolean): void {
    this.looping = looping;
    this.info?.classList.toggle('looping', looping);
  }

  private handleTimeUpdate(): void {
    this.renderPlayhead();
    if (this.currentTimeLabel) this.currentTimeLabel.textContent = formatMinutesSeconds(this.video.currentTime);

    if (this.looping && this.video.currentTime >= this.start + this.duration) {
      this.video.currentTime = this.start;
    }
  }

  /** Inside the range: loop from there. Outside it: move the range there. */
  private handleTrackClick(event: MouseEvent): void {
    if (this.dragTarget || !this.track) return;
    const rect = this.track.getBoundingClientRect();
    const time = ((event.clientX - rect.left) / rect.width) * this.videoDuration;

    if (time >= this.start && time <= this.start + this.duration) {
      this.setLooping(true);
      this.video.currentTime = time;
      playQuietly(this.video);
    } else {
      this.setLooping(false);
      this.start = clamp(time, 0, this.videoDuration - this.duration);
      this.video.currentTime = this.start;
      this.render();
    }
  }

  private startDrag(clientX: number, target: DragTarget): void {
    this.dragTarget = target;
    this.range?.classList.add('is-dragging');
    this.wasLoopingBeforeDrag = this.looping;
    if (!this.video.paused) this.video.pause();
    if (target === 'range' && this.track) {
      const rect = this.track.getBoundingClientRect();
      this.dragOffset = ((clientX - rect.left) / rect.width) * this.videoDuration - this.start;
    }
  }

  private finishDrag(): void {
    if (!this.dragTarget) return;
    this.dragTarget = null;
    this.range?.classList.remove('is-dragging');
    if (this.wasLoopingBeforeDrag) {
      this.video.currentTime = this.start;
      playQuietly(this.video);
    }
    this.wasLoopingBeforeDrag = false;
  }

  /** Dragging a handle past the maximum length pushes the other end along. */
  private handleDrag(clientX: number): void {
    if (!this.dragTarget || !this.track) return;

    const rect = this.track.getBoundingClientRect();
    const time = clamp((clientX - rect.left) / rect.width, 0, 1) * this.videoDuration;
    const end = this.start + this.duration;

    if (this.dragTarget === 'start') {
      let nextStart = clamp(time, 0, end - MIN_DURATION);
      let nextDuration = end - nextStart;
      if (nextDuration > MAX_DURATION) {
        nextDuration = MAX_DURATION;
        if (nextStart + MAX_DURATION > this.videoDuration) nextStart = this.videoDuration - MAX_DURATION;
      }
      this.start = nextStart;
      this.duration = nextDuration;
      this.video.currentTime = this.start;
    } else if (this.dragTarget === 'end') {
      let nextEnd = clamp(time, this.start + MIN_DURATION, this.videoDuration);
      let nextStart = this.start;
      let nextDuration = nextEnd - nextStart;
      if (nextDuration > MAX_DURATION) {
        nextDuration = MAX_DURATION;
        nextStart = nextEnd - MAX_DURATION;
        if (nextStart < 0) {
          nextStart = 0;
          nextEnd = MAX_DURATION;
        }
      }
      this.start = nextStart;
      this.duration = nextDuration;
      this.video.currentTime = nextEnd;
    } else {
      this.start = clamp(time - this.dragOffset, 0, this.videoDuration - this.duration);
      this.video.currentTime = this.start;
    }

    this.render();
  }

  /** Arrow keys move the range; with Shift they resize it from the end. */
  private handleArrowKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();

    if (event.key === 'ArrowLeft') {
      if (event.shiftKey) {
        this.duration = Math.max(MIN_DURATION, this.duration - KEY_STEP_SECONDS);
      } else {
        this.start = Math.max(0, this.start - KEY_STEP_SECONDS);
      }
      this.video.currentTime = this.start;
    } else if (event.shiftKey) {
      const maxDuration = Math.min(MAX_DURATION, this.videoDuration - this.start);
      this.duration = Math.min(maxDuration, this.duration + KEY_STEP_SECONDS);
      this.video.currentTime = this.start + this.duration;
    } else {
      this.start = Math.min(this.videoDuration - this.duration, this.start + KEY_STEP_SECONDS);
      this.video.currentTime = this.start;
    }
    this.render();
  }

  private render(): void {
    if (!this.videoDuration || !this.range) return;

    const startPct = (this.start / this.videoDuration) * 100;
    const widthPct = (this.duration / this.videoDuration) * 100;
    this.range.style.left = `${startPct}%`;
    this.range.style.width = `${widthPct}%`;

    if (this.dimLeft) this.dimLeft.style.width = `${startPct}%`;
    if (this.dimRight) {
      this.dimRight.style.left = `${startPct + widthPct}%`;
      this.dimRight.style.width = `${100 - startPct - widthPct}%`;
    }
    if (this.info) {
      const end = this.start + this.duration;
      this.info.textContent = `Sprite: ${formatMinutesSeconds(this.start)} - ${formatMinutesSeconds(end)} (${this.duration.toFixed(1)}s)`;
    }
  }

  private renderPlayhead(): void {
    if (!this.playhead || !this.videoDuration) return;
    const { duration, currentTime } = this.video;
    const measured = Number.isFinite(duration) && duration > 0 ? duration : this.videoDuration;
    if (!Number.isFinite(measured) || measured <= 0) return;
    this.playhead.style.left = `${clamp((currentTime / measured) * 100, 0, 100)}%`;
  }
}
