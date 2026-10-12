import { handleApi } from '../lib/vercel-api.mjs';

export function GET(request) {
  return handleApi(request);
}
