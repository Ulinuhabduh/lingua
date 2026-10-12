import { handleApi } from '../lib/vercel-api.mjs';

export function POST(request) {
  return handleApi(request);
}
