import { chunkText } from '@/app/_lib/chunkText';

// Not real prose, just enough 。/！/？-punctuated sentence-like text for chunkText to
// chunk the same way it would a real uploaded .txt file - see previewFetchMock.js.
const SENTENCE_POOL = [
  '從前有一座小島,島上住著一群喜歡說故事的人。',
  '每天傍晚,他們會聚在榕樹下,輪流分享今天發生的趣事。',
  '有一天,一艘陌生的船緩緩靠近岸邊。',
  '船上走下一位戴著斗笠的旅人,手裡提著一只舊皮箱。',
  '他自稱是遠方來的說書人,想用故事換一頓晚餐。',
  '島上的孩子們立刻圍了過來,好奇地打量著他。',
  '旅人打開皮箱,裡面裝滿了各式各樣的小物件。',
  '每一件物品背後,都藏著一段離奇的往事。',
  '夜色漸漸降臨,篝火被點燃,故事也正式開始。',
  '旅人的聲音低沉而溫暖,讓人忍不住屏息聆聽。',
  '第一個故事,是關於一枚會唱歌的貝殼。',
  '據說只要在滿月之夜對著它許願,願望就會實現。',
  '第二個故事,講的是一座會自己走路的燈塔。',
  '燈塔每逢暴風雨來襲,就會悄悄挪到船隻最需要它的地方。',
  '孩子們聽得入迷,不知不覺已經過了大半夜。',
  '旅人收起皮箱,笑著說故事還有很多,下次再說。',
  '隔天清晨,旅人的船已經不見蹤影。',
  '只留下沙灘上一枚閃閃發光的貝殼,靜靜躺著。',
  '從此以後,每逢滿月,孩子們都會回到榕樹下等他。',
  '有人說旅人其實從未離開,只是換了一種方式說故事。',
];

function buildText(sentenceCount) {
  return Array.from(
    { length: sentenceCount },
    (_, i) => SENTENCE_POOL[i % SENTENCE_POOL.length],
  ).join('');
}

function resumeIndexFor(position, chunkCount) {
  if (position === 'start') return 0;
  if (position === 'end') return chunkCount - 1;
  return Math.floor(chunkCount / 2);
}

// Five states worth eyeballing on the library/player screens: a never-opened book, one
// resumed partway through, one nearly finished, one with a title long enough to test
// wrapping, and a single-chunk book for end-of-book edge cases.
const BOOK_SPECS = [
  { bookId: 'preview-fresh', title: '剛上傳的書', sentenceCount: 24, position: 'start' },
  { bookId: 'preview-partway', title: '讀到一半的書', sentenceCount: 40, position: 'middle' },
  { bookId: 'preview-almost-done', title: '快讀完的書', sentenceCount: 40, position: 'end' },
  {
    bookId: 'preview-long-title',
    title:
      '這是一本書名非常非常非常長的書,專門用來測試書單列表在標題很長的時候會不會跑版或是換行怪怪的',
    sentenceCount: 12,
    position: 'start',
  },
  { bookId: 'preview-single-chunk', title: '極短篇', sentenceCount: 2, position: 'start' },
];

export function createFixtureLibrary() {
  return BOOK_SPECS.map(({ bookId, title, sentenceCount, position }) => {
    const chunks = chunkText(buildText(sentenceCount));
    return { bookId, title, resumeIndex: resumeIndexFor(position, chunks.length), chunks };
  });
}
