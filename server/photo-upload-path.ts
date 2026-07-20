// Matches POST /api/service-calls/:id/photos. The photo upload route parses its
// own request body with a 20mb limit in routes.ts; the global 1mb JSON parser in
// index.ts must skip these requests so it doesn't consume/reject them first.
export function isPhotoUploadRequest(method: string, path: string): boolean {
  return method === "POST" && /^\/api\/service-calls\/[^/]+\/photos$/.test(path);
}
