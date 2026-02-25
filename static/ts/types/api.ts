/**
 * API request and response type definitions
 */

export interface VideoData {
  hls?: string;
  thumbnail?: string;
  spriteSheet?: string;
  frames?: number;
  columns?: number;
  rows?: number;
  frame_width?: number;
  frame_height?: number;
  fps?: number;
}

export interface ProjectData {
  slug: string;
  name: string;
  date: string;
  pinned: boolean;
  draft: boolean;
  youtube?: string;
  video?: VideoData;
  markdown: string;
  html?: string;
  revision?: string;
}

export interface AboutData {
  markdown: string;
  revision?: string;
}

export interface ApiErrorResponse {
  detail: string;
  status?: number;
}

/**
 * Generic fetch options with proper typing
 */
export interface FetchJSONOptions extends RequestInit {
  headers?: Record<string, string>;
}
