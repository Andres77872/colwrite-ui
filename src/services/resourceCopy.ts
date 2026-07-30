/**
 * Copy shared between the two places a resource can be deleted.
 *
 * The editor's detail view and the account dashboard each had their own
 * wording — "removed from your library and cannot be recovered" versus "the
 * file, its extracted text, and the assistant's access to it are removed". Two
 * descriptions of one irreversible action is one description too many, and the
 * vaguer of the two undersold what was about to be lost.
 */
export const DELETE_RESOURCE_WARNING =
  'The file, its extracted text, and the assistant’s access to it are removed. This cannot be undone.';
