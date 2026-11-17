import type { AssetInfo } from '@/api/schema';
import { TEST_WORKSPACE_ID } from './workspace';

export const TEST_ASSET_ID = 'ast-00000000-0000-4000-8000-000000000001';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAB4AAAAUCAIAAAAVyRqTAAAAI0lEQVR4nGNkYPjPQBvARCNzR40eNXrU6FGjR40eNZqmRgMAp5wBJ5takqoAAAAASUVORK5CYII=';

export function imageFile(filename = 'chart.png'): File {
  return new File([Uint8Array.from(atob(PNG), (char) => char.charCodeAt(0))], filename, { type: 'image/png' });
}

export function assetFixture(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    asset_id: TEST_ASSET_ID, workspace_id: TEST_WORKSPACE_ID, kind: 'upload',
    filename: 'chart.png', media_type: 'image/png', bytes: 92, width: 30, height: 20,
    sha256: '79975bd718bb1f7eb4eb9db6e140dcc52be336b0061e89e631c5b88536bb6451',
    generation_id: null, generation: null, created_by: 'u-preview', created_at: '2026-11-16T12:00:00Z',
    ...overrides,
  };
}
