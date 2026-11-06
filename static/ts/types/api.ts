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
  video_width?: number;
  video_height?: number;
  duration?: number;
}

export interface ProjectData {
  slug: string;
  name: string;
  date: string;
  pinned: boolean;
  draft: boolean;
  youtube?: string | null;
  og_image?: string | null;
  video?: VideoData;
  markdown: string;
  revision?: string;
}

export interface AboutData {
  markdown: string;
  revision?: string;
}

export interface SaveResult {
  revision?: string;
  slug?: string;
}

export interface VideoThumbnailsResult {
  success: boolean;
  temp_id: string;
  duration: number;
  frames?: string[];
  hls_session_id?: string;
  hls_url?: string;
  detail?: string;
}

export interface MoreThumbnailsResult {
  frames?: string[];
  complete?: boolean;
}

export interface HlsProgress {
  status: string;
  progress?: number;
  stage?: string;
  hls_url?: string;
}

export interface SpriteSheetResult {
  success: boolean;
  video?: VideoData;
  detail?: string;
}

export interface FetchJSONOptions extends RequestInit {
  headers?: Record<string, string>;
}
