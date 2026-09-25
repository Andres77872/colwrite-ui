/**
 * Entry for `dev-preview.html`: the real app, signed in against the in-browser
 * mock API. Open http://localhost:5180/dev-preview.html while `vite` runs.
 */
import { installMockApi } from './mockApi';

installMockApi();
await import('../main');
