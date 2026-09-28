const KEY = process.env.OPENROUTER_API_KEY;
if (KEY == null || KEY === '') throw new Error('OPENROUTER_API_KEY missing');
const DIR = '/tmp/pr-review/branding';
const base = await Bun.file(`${DIR}/grok-prompt.txt`).text();
const source = Buffer.from(await Bun.file(`${DIR}/conan-c--gpt-5.4-image-2.png`).arrayBuffer()).toString('base64');
const addendum = `

[이번 변환의 추가 지시 — 캐릭터 특징으로 적용]

변환 대상은 명탐정 코난(에도가와 코난)이다. 첨부 이미지는 구도·방향·눈의 참고용이다.

1. 모자는 완전히 제거한다. 모자를 그리지 않는다.
2. 머리카락: 코난의 헤어스타일. 짙은 흑갈색(거의 검정에 가까운 다크 브라운) 머리, 이마를 덮는 크고 뾰족한 앞머리 덩어리 몇 개, 정수리에 위로 솟은 삐친 머리(더듬이) 하나, 옆머리는 귀 위를 덮는 짧은 덩어리. 몇 개의 크고 매끈한 덩어리로만 단순화. 앞머리가 두 눈을 가리지 않는다.
3. 얼굴: 코난의 따뜻하고 밝은 피치 베이지 피부톤, 둥근 봇 얼굴, 입·코 없음, 옅은 코랄 볼 홍조, 같은 피부색 귀.
4. 옷: 화면 아래 가장자리에 파란 블레이저 옷깃, 흰 셔츠 칼라, 빨간 나비넥타이 일부. 큰 색면으로 단순화.
5. 안경: 코난의 상징인 크고 둥근 검은 뿔테 안경. 두 렌즈가 각각 한쪽 눈 캡슐 전체를 여유 있게 감싸고, 렌즈는 완전히 투명하며 반사광·반짝임 없음. 테는 굵고 매끈한 짙은 네이비/검정 색면. 눈 캡슐은 렌즈 안에 온전히 보인다. 모노클은 그리지 않는다.
6. 두 개의 검은 세로 캡슐 눈, 왼쪽 아래에서 오른쪽 위를 들여다보는 시계방향 15~20도 기울기, 머리 왼쪽·아래 가장자리 크롭, 오른쪽 위 여백, 거의 검은 차콜 단색 배경, 1:1.`;
const prompt = base + addendum;
const RUNS = [
  { model: 'google/gemini-3-pro-image', name: 'conan4-a' },
  { model: 'google/gemini-3-pro-image', name: 'conan4-b' },
  { model: 'openai/gpt-5.4-image-2', name: 'conan4-c' },
  { model: 'openai/gpt-5.4-image-2', name: 'conan4-d' },
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
