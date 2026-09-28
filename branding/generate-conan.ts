const KEY = process.env.OPENROUTER_API_KEY;
if (KEY == null || KEY === '') throw new Error('OPENROUTER_API_KEY missing');
const DIR = '/tmp/pr-review/branding';
const base = await Bun.file(`${DIR}/grok-prompt.txt`).text();
const source = Buffer.from(await Bun.file(`${DIR}/grok-d--gemini-3-pro-image.png`).arrayBuffer()).toString('base64');
const addendum = `

[이번 변환의 추가 지시 — 위 규격보다 우선하지 않되, 캐릭터 특징으로 적용]

변환 대상은 첨부한 흰색 둥근 봇이다. 흰색 얼굴과 둥근 실루엣은 유지한다.

1. 방향: 캐릭터는 반드시 화면 왼쪽 아래에서 오른쪽 위를 향해 들여다본다. 머리의 왼쪽과 아래쪽 가장자리가 화면 밖으로 잘리고, 오른쪽 위에 짙은 배경 여백이 남는다. 머리를 시계 방향으로 15~20도 기울여 화면 왼쪽 눈이 오른쪽 눈보다 높다. 첨부 이미지와 좌우가 반대인 구도다.
2. 모자: 기존의 보라색 체크 모자를 버리고, 일본 애니메이션 풍의 아주 귀여운 탐정 모자(디어스토커)로 바꾼다. 따뜻한 캐러멜·초콜릿 브라운 계열, 둥글고 통통한 크라운, 짧고 둥근 앞챙과 뒷챙, 정수리의 작은 둥근 단추, 옆으로 살짝 접어 올린 귀덮개에 작은 리본 매듭. 체크 무늬는 넓고 은은한 두세 줄의 연한 베이지 줄로만 표현한다. 모자는 머리 기울기를 따라 살짝 비스듬히 얹힌다.
3. 모노클: 화면 오른쪽 눈 주위에 얇은 금색 원형 테의 모노클 하나. 렌즈는 투명하고 눈 캡슐을 가리거나 변형하지 않으며, 테 아래에서 얼굴 아래쪽으로 가는 금색 체인이 짧게 늘어진다. 반짝임이나 반사광은 넣지 않는다.
4. 여전히 입·코·눈썹 없음, 두 개의 검은 세로 캡슐 눈, 옅은 볼 홍조, 거의 검은 차콜 단색 배경, 1:1.`;
const prompt = base + addendum;
const RUNS = [
  { model: 'google/gemini-3-pro-image', name: 'conan-a' },
  { model: 'google/gemini-3-pro-image', name: 'conan-b' },
  { model: 'openai/gpt-5.4-image-2', name: 'conan-c' },
  { model: 'openai/gpt-5.4-image-2', name: 'conan-d' },
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
