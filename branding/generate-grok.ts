const KEY = process.env.OPENROUTER_API_KEY;
if (KEY == null || KEY === '') throw new Error('OPENROUTER_API_KEY missing');
const DIR = '/tmp/pr-review/branding';
const prompt = await Bun.file(`${DIR}/grok-prompt.txt`).text();
const source = Buffer.from(await Bun.file(`${DIR}/detective-bot-a--gpt-5.4-image-2.png`).arrayBuffer()).toString('base64');
const RUNS = [
  { model: 'openai/gpt-5.4-image-2', name: 'grok-a' },
  { model: 'openai/gpt-5.4-image-2', name: 'grok-b' },
  { model: 'google/gemini-3-pro-image', name: 'grok-c' },
  { model: 'google/gemini-3-pro-image', name: 'grok-d' },
];
interface ChatResponse { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[]; error?: { message?: string }; usage?: { cost?: number } }
async function run({ model, name }: { model: string; name: string }): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'PR Review icon' },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${source}` } }] }],
      usage: { include: true },
    }),
  });
  const json = (await response.json()) as ChatResponse;
  if (!response.ok) return `${name}: HTTP ${response.status} ${json.error?.message ?? ''}`;
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (url == null) return `${name}: no image`;
  const [meta, data] = url.split(',');
  const file = `${DIR}/${name}--${model.split('/')[1]}.${meta?.includes('jpeg') ? 'jpg' : 'png'}`;
  await Bun.write(file, Buffer.from(data ?? '', 'base64'));
  return `${file} cost=$${json.usage?.cost?.toFixed(4) ?? '?'}`;
}
const results = await Promise.allSettled(RUNS.map(run));
results.forEach((result) => console.log(result.status === 'fulfilled' ? result.value : `ERR ${String(result.reason).slice(0, 200)}`));
