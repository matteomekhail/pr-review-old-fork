const KEY = process.env.OPENROUTER_API_KEY;
if (KEY == null || KEY === '') throw new Error('OPENROUTER_API_KEY missing');

const OUT = '/tmp/pr-review/branding';
const BRIEF = `Design a premium macOS app icon for a lightning-fast desktop pull-request review tool (working name "PR Review").
Style reference: the Zed code editor icon — bold, geometric, minimal, confident, modern developer-tool aesthetic, flat vector with subtle depth, crisp edges.
Rules: macOS Big Sur squircle app icon shape, centered mark, 1:1 square, no text, no letters, no words, no watermark, no mockup, no background scene, no drop shadow outside the squircle.
Palette: near-black ink (#0f1011) squircle, indigo-violet accent (#5e6ad2 to #8b7cf6), a single hint of green (#4cb782) for "approved".`;

const CONCEPTS = [
  { name: 'merge-bolt', prompt: `${BRIEF}\nConcept: two git branch lines converging into one, where the merge point forms a sharp lightning bolt. Speed + merge.` },
  { name: 'diff-check', prompt: `${BRIEF}\nConcept: a stacked minus bar and plus bar (a diff) whose right edge turns into a bold checkmark. Review + approve.` },
  { name: 'fold-z', prompt: `${BRIEF}\nConcept: an abstract geometric monogram made of two overlapping angled planes like folded paper, forming an arrow merging into a single line, echoing Zed's folded-Z mark.` },
];

const MODELS = ['google/gemini-3-pro-image', 'openai/gpt-5.4-image-2'];

interface ImagePart { image_url?: { url?: string } }
interface ChatResponse {
  choices?: { message?: { images?: ImagePart[]; content?: string } }[];
  error?: { message?: string };
  usage?: { cost?: number };
}

async function generate(model: string, concept: { name: string; prompt: string }): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'PR Review logo' },
    body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: concept.prompt }], usage: { include: true } }),
  });
  const json = (await response.json()) as ChatResponse;
  if (!response.ok) return `${model} ${concept.name}: HTTP ${response.status} ${json.error?.message ?? ''}`;
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (url == null || !url.startsWith('data:image/')) return `${model} ${concept.name}: no image (${(json.choices?.[0]?.message?.content ?? '').slice(0, 120)})`;
  const [meta, data] = url.split(',');
  const extension = meta?.includes('jpeg') ? 'jpg' : 'png';
  const file = `${OUT}/${concept.name}--${model.split('/')[1]}.${extension}`;
  await Bun.write(file, Buffer.from(data ?? '', 'base64'));
  return `${file}  cost=$${json.usage?.cost?.toFixed(4) ?? '?'}`;
}

const results = await Promise.allSettled(MODELS.flatMap((model) => CONCEPTS.map((concept) => generate(model, concept))));
results.forEach((result) => console.log(result.status === 'fulfilled' ? result.value : `ERR ${String(result.reason).slice(0, 200)}`));
