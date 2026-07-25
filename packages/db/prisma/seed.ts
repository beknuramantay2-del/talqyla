// Seed script — creates the topic catalogue + demo accounts for local dev.
// Run: `pnpm db:seed` (tsx). Idempotent: deletes nothing, upserts by slug/email.
//
// Creates:
//   - 15 debate topics (Russian school curriculum-friendly)
//   - 1 admin
//   - 2 demo students (one beginner, one intermediate — with sample rounds skipped)

import {
  PrismaClient,
  UserRole,
  ExperienceLevel,
  TopicCategory,
  TopicDifficulty,
} from '@talqyla/prisma-client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;
const hash = (pw: string) => bcrypt.hash(pw, SALT_ROUNDS);

const TOPICS: Array<{
  slug: string;
  title: string;
  description: string;
  category: TopicCategory;
  difficulty: TopicDifficulty;
  proHint?: string;
  conHint?: string;
}> = [
  {
    slug: 'ban-homework',
    title: 'Нужно ли запретить домашние задания?',
    description: 'Споры о пользе и вреде домашних заданий для школьников.',
    category: TopicCategory.SCHOOL,
    difficulty: TopicDifficulty.EASY,
    proHint: 'Домашние задания вызывают стресс и убивают интерес к учёбе.',
    conHint: 'Без домашних заданий материал не закрепляется.',
  },
  {
    slug: 'school-uniform',
    title: 'Обязательна ли школьная форма?',
    description: 'Уравнивает ли форма учеников или подавляет индивидуальность?',
    category: TopicCategory.SCHOOL,
    difficulty: TopicDifficulty.EASY,
    proHint: 'Форма снижает социальное неравенство и отвлечение на одежду.',
    conHint: 'Форма подавляет самовыражение и стоит денег семьям.',
  },
  {
    slug: 'ban-phones-school',
    title: 'Нужно ли запретить смартфоны в школе?',
    description: 'Влияние смартфонов на концентрацию и дисциплину.',
    category: TopicCategory.SCHOOL,
    difficulty: TopicDifficulty.EASY,
    proHint: 'Смартфоны отвлекают от учёбы и мешают концентрации.',
    conHint: 'Смартфон — инструмент для учёбы и связи с родителями.',
  },
  {
    slug: 'students-work',
    title: 'Должны ли школьники работать?',
    description: 'Плюсы и минусы подработки во время учёбы.',
    category: TopicCategory.SCHOOL,
    difficulty: TopicDifficulty.MEDIUM,
    proHint: 'Работа учит ответственности и финансовой грамотности.',
    conHint: 'Работа отнимает время у учёбы и отдыха.',
  },
  {
    slug: 'exam-only',
    title: 'Оценивать ли учеников только по экзаменам?',
    description: 'Экзамены против текущей успеваемости.',
    category: TopicCategory.SCHOOL,
    difficulty: TopicDifficulty.MEDIUM,
    proHint: 'Экзамены — объективный и стандартизированный способ оценки.',
    conHint: 'Один экзамен не отражает реальные знания ученика.',
  },
  {
    slug: 'online-school',
    title: 'Стоит ли перевести школу полностью онлайн?',
    description: 'Дистанционное образование: панацея или катастрофа?',
    category: TopicCategory.TECHNOLOGY,
    difficulty: TopicDifficulty.MEDIUM,
    proHint: 'Онлайн даёт доступ к лучшим учителям вне зависимости от географии.',
    conHint: 'Онлайн лишает социализации и живого общения.',
  },
  {
    slug: 'ai-in-education',
    title: 'Должен ли ИИ помогать ученикам делать домашку?',
    description: 'Использование ChatGPT и подобных инструментов в учёбе.',
    category: TopicCategory.TECHNOLOGY,
    difficulty: TopicDifficulty.MEDIUM,
    proHint: 'ИИ — персональный репетитор, доступный каждому.',
    conHint: 'ИИ убивает навык самостоятельного мышления.',
  },
  {
    slug: 'social-media-ban-minors',
    title: 'Запретить ли соцсети до 16 лет?',
    description: 'Влияние соцсетей на психику подростков.',
    category: TopicCategory.SOCIETY,
    difficulty: TopicDifficulty.HARD,
    proHint: 'Соцсети вызывают зависимость и тревожность у подростков.',
    conHint: 'Соцсети — основное пространство общения и самовыражения поколения.',
  },
  {
    slug: 'voting-age-16',
    title: 'Снизить ли возраст голосования до 16 лет?',
    description: 'Политические права подростков.',
    category: TopicCategory.SOCIETY,
    difficulty: TopicDifficulty.HARD,
    proHint: '16-летние достаточно осведомлены, чтобы участвовать в политике.',
    conHint: 'Подростки подвержены влиянию и не имеют жизненного опыта.',
  },
  {
    slug: 'vegetarianism',
    title: 'Стоит ли отказаться от мяса ради экологии?',
    description: 'Влияние животноводства на климат.',
    category: TopicCategory.ENVIRONMENT,
    difficulty: TopicDifficulty.MEDIUM,
    proHint: 'Животноводство — один из главных источников парниковых газов.',
    conHint: 'Отказ от мяса бьёт по здоровью и экономике регионов.',
  },
  {
    slug: 'ban-plastic',
    title: 'Нужно ли полностью запретить одноразовый пластик?',
    description: 'Борьба с пластиковым загрязнением.',
    category: TopicCategory.ENVIRONMENT,
    difficulty: TopicDifficulty.EASY,
    proHint: 'Пластик загрязняет океаны и не разлагается веками.',
    conHint: 'Альтернативы дороже и не всегда экологичнее при производстве.',
  },
  {
    slug: 'animal-testing-ban',
    title: 'Запретить ли тесты на животных?',
    description: 'Этика и наука: можно ли обойтись без животных.',
    category: TopicCategory.ETHICS,
    difficulty: TopicDifficulty.HARD,
    proHint: 'Тесты на животных жестоки и часто нерелевантны для человека.',
    conHint: 'Без тестов на животных многие лекарства и косметику не создать.',
  },
  {
    slug: 'esports-real-sport',
    title: 'Киберспорт — настоящий спорт?',
    description: 'Что такое спорт в XXI веке.',
    category: TopicCategory.SPORTS,
    difficulty: TopicDifficulty.MEDIUM,
    proHint: 'Киберспорт требует реакции, стратегии и командной работы.',
    conHint: 'Без физической нагрузки это не спорт, а игра.',
  },
  {
    slug: 'video-game-ban-violence',
    title: 'Виноваты ли жестокие видеоигры в агрессии?',
    description: 'Связь игр с реальным насилием.',
    category: TopicCategory.SOCIETY,
    difficulty: TopicDifficulty.HARD,
    proHint: 'Жестокие игры десенсибилизируют и провоцируют агрессию.',
    conHint: 'Исследования не находят прямой связи игр с насилием.',
  },
  {
    slug: 'classic-literature-required',
    title: 'Обязательно ли читать классику в школе?',
    description: 'Зачем читать Толстого и Достоевского в 2026.',
    category: TopicCategory.CULTURE,
    difficulty: TopicDifficulty.MEDIUM,
    proHint: 'Классика формирует нравственный компас и язык.',
    conHint: 'Насильно прочитанная классика вызывает отвращение к чтению.',
  },
];

async function main() {
  // ── Topics ─────────────────────────────────────────────────────────
  for (const t of TOPICS) {
    await prisma.topic.upsert({
      where: { slug: t.slug },
      update: {
        title: t.title,
        description: t.description,
        category: t.category,
        difficulty: t.difficulty,
        proHint: t.proHint ?? null,
        conHint: t.conHint ?? null,
      },
      create: t,
    });
  }
  console.log(`✓ ${TOPICS.length} topics`);

  // ── Admin ──────────────────────────────────────────────────────────
  const adminPw = await hash('admin12345');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@talqyla.local' },
    update: {},
    create: {
      email: 'admin@talqyla.local',
      name: 'Админ',
      role: UserRole.ADMIN,
      passwordHash: adminPw,
    },
  });
  console.log(`✓ admin: ${admin.email}`);

  // ── Demo students ──────────────────────────────────────────────────
  const studentDefs = [
    {
      email: 'ivan@talqyla.local',
      name: 'Иван',
      grade: 8,
      level: ExperienceLevel.BEGINNER,
      goal: 'Уверенность в речи',
    },
    {
      email: 'anna@talqyla.local',
      name: 'Анна',
      grade: 10,
      level: ExperienceLevel.INTERMEDIATE,
      goal: 'Быстрые ответы оппоненту',
    },
  ] as const;

  for (const def of studentDefs) {
    const pw = await hash('debato1234');
    const user = await prisma.user.upsert({
      where: { email: def.email },
      update: {},
      create: {
        email: def.email,
        name: def.name,
        role: UserRole.USER,
        passwordHash: pw,
      },
    });
    if (!(await prisma.studentProfile.findUnique({ where: { userId: user.id } })) && def.grade) {
      await prisma.studentProfile.create({
        data: {
          userId: user.id,
          grade: def.grade,
          experienceLevel: def.level,
          goal: def.goal,
        },
      });
    }
    console.log(`✓ student: ${def.email}`);
  }

  console.log('\nSeed complete. Demo passwords: admin12345 / debato1234');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
