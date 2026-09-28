const KEY = process.env.OPENROUTER_API_KEY;
if (KEY == null || KEY === '') throw new Error('OPENROUTER_API_KEY missing');
const OUT = '/tmp/pr-review/branding';
const BRIEF = `Design an adorable macOS app icon for a fast pull-request review app called "PR Review".
Character: a tiny, round, friendly robot mascot — chibi proportions, glossy smooth body, big glowing oval eyes, a small happy smile, soft rounded shapes, playful and cute like a modern AI assistant mascot (in the spirit of Grok's cute bot companions), but an original character.
Theme: a detective helper bot. It wears a tiny classic detective deerstalker cap (lavender and indigo plaid) and holds a big round magnifying glass up to one eye, which makes that glowing eye look huge and curious. Inside the magnifying glass lens there is a tiny code diff: two short lines, one green (+) and one red (−). A small green checkmark sparkle floats beside it.
Style: premium 3D-rendered app icon, soft studio lighting, subtle rim light, clean and simple, instantly readable at 32px.
Palette: near-black ink squircle background (#0f1011) with a soft indigo-violet glow (#5e6ad2 to #8b7cf6); robot in pearl white and lavender; one pop of green (#4cb782) on the checkmark.
Rules: macOS Big Sur squircle app icon, centered character filling ~70% of the icon, 1:1 square, no text, no letters, no watermark, no mockup, no scene around the squircle.`;
const VARIANTS = [
  { name: 'detective-bot-a', extra: 'Pose: facing the viewer, magnifying glass raised to its right eye, cheerful determined smile.' },
  { name: 'detective-bot-b', extra: 'Pose: three-quarter view, leaning in curiously with the magnifying glass, one little antenna blinking, tiny happy blush marks.' },
];
const VARIANTS_UNUSED = [
  { name: 'cute-bot-a', extra: 'Pose: waving hello with one little arm, other arm holding the checkmark badge.' },
  { name: 'cute-bot-b', extra: 'Pose: head slightly tilted, eyes happily closed in a smile (^ ^), checkmark badge on its chest.' },
];
const MODELS = ['openai/gpt-5.4-image-2', 'google/gemini-3-pro-image'];
interface ChatResponse { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[]; error?: { message?: string }; usage?: { cost?: number } }
async function generate(model: string, variant: { name: string; extra: string }): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'PR Review icon' },
    body: JSON.stringify({ model, modalities: ['image', 'text'], messages: [{ role: 'user', content: `${BRIEF}\n${variant.extra}` }], usage: { include: true } }),
  });
  const json = (await response.json()) as ChatResponse;
  if (!response.ok) return `${model} ${variant.name}: HTTP ${response.status} ${json.error?.message ?? ''}`;
  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (url == null) return `${model} ${variant.name}: no image`;
  const [meta, data] = url.split(',');
  const file = `${OUT}/${variant.name}--${model.split('/')[1]}.${meta?.includes('jpeg') ? 'jpg' : 'png'}`;
  await Bun.write(file, Buffer.from(data ?? '', 'base64'));
  return `${file} cost=$${json.usage?.cost?.toFixed(4) ?? '?'}`;
}
const results = await Promise.allSettled(MODELS.flatMap((model) => VARIANTS.map((variant) => generate(model, variant))));
results.forEach((result) => console.log(result.status === 'fulfilled' ? result.value : `ERR ${String(result.reason).slice(0, 200)}`));
