export type ExportProfile = 'editor-faithful' | 'paper';
export type ExportPageSize = 'A4' | 'Letter';
export type ExportOrientation = 'portrait' | 'landscape';
export type AiBeatExportMode = 'omit' | 'draft-card';

export type DocumentExportOptions = {
  profile: ExportProfile;
  page_size: ExportPageSize;
  orientation: ExportOrientation;
  include_title: boolean;
  ai_beat: AiBeatExportMode;
};

export type DocumentExportSnapshot = {
  base_version: number;
  local_revision: number;
  dirty: boolean;
};

export const DEFAULT_EXPORT_OPTIONS: DocumentExportOptions = {
  profile: 'paper',
  page_size: 'A4',
  orientation: 'portrait',
  include_title: false,
  ai_beat: 'omit',
};

export const HTML_EXPORT_OPTIONS: DocumentExportOptions = {
  ...DEFAULT_EXPORT_OPTIONS,
  profile: 'editor-faithful',
};
