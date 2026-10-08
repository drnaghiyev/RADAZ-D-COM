export type AiSettings = { configured: boolean; model: string };

export async function aiRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/local-archive-api/ai/${path}`, {
    cache: 'no-store', signal,
    ...(body === undefined ? {} : {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)}),
  });
  const result = await response.json().catch(() => ({error:'AI xidməti ilə əlaqə alınmadı.'})) as {error?:string;requestId?:string};
  if (!response.ok) {
    // Never log request bodies or the saved credential.
    console.error('[RADAZ AI]', {status: response.status, message: result.error, requestId: result.requestId || ''});
    throw new Error(result.error || 'AI sorğusu tamamlanmadı.');
  }
  return result as T;
}

export const openAiSettings = () => window.dispatchEvent(new Event('radaz-ai-settings'));
