/**
 * API request and response type definitions
 */

export interface ProjectData {
  slug: string;
  title: string;
  markdown: string;
  description?: string;
  tags?: string[];
  status?: 'draft' | 'published';
  created_at?: string;
  updated_at?: string;
}

export interface AboutData {
  markdown: string;
}

export interface SaveProjectRequest {
  markdown: string;
}

export interface SaveAboutRequest {
  markdown: string;
}

export interface UploadMediaResponse {
  url: string;
}

export interface ProcessVideoResponse {
  url: string;
}

export interface ProjectSettingsData {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  status: 'draft' | 'published';
  thumbnail_url?: string;
  created_at?: string;
}

export interface CreateProjectRequest {
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
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
