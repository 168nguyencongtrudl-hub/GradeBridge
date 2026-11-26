import type { ExamProfile, SmartTask, SystemBranding } from '../types.ts';

export const INITIAL_EXAM_PROFILES: ExamProfile[] = [
  {
    id: 'profile-khoi-2-g2ft1',
    schoolName: 'TH Nguyễn Bỉnh Khiêm',
    gradeName: 'Grade 2 (G2_FT1)',
    classLabel: '',
    examTitle: 'Cambridge Pre-A1 Starters - Grade 2 Final Test 1 (9 Pages)',
    examLevel: 'Cambridge Pre-A1 Starters / Grade 2',
    pagesPerStudent: 9,
    maxScore: 8,
    sourceFileName: 'G2_FT1_AnswerKey.pdf',
    updatedAt: 1732200000000,
    parts: [
      {
        id: 'g2-l1',
        title: 'Listening Part 1: Listen and draw lines',
        skill: 'Listening',
        type: 'draw_lines',
        note: 'Example: Tina -> The girl in a pink T-shirt holding a green lizard',
        targets: [
          { code: 'A', label: 'The boy in a blue cap pointing at the bee' },
          { code: 'B', label: 'The girl crouching and pointing at the snake' },
          { code: 'C', label: 'The boy in a red T-shirt talking to the farmer' },
          { code: 'D', label: 'The boy in a green T-shirt sitting on hay and drinking juice' },
          { code: 'E', label: 'The farmer in a straw hat standing next to the fence' }
        ],
        items: [
          { q: 1, prompt: 'Adam', ans: 'A', targetDesc: 'The boy in a blue cap pointing at the bee' },
          { q: 2, prompt: 'Bella', ans: 'B', targetDesc: 'The girl crouching and pointing at the snake' },
          { q: 3, prompt: 'Liam', ans: 'C', targetDesc: 'The boy in a red T-shirt talking to the farmer' },
          { q: 4, prompt: 'Daniel', ans: 'D', targetDesc: 'The boy in a green T-shirt sitting on hay and drinking juice' }
        ]
      },
      {
        id: 'g2-l2',
        title: 'Listening Part 2: Listen and write a name or a number',
        skill: 'Listening',
        type: 'text_blank',
        items: [
          { q: 5, prompt: 'Street name', ans: 'Sun' },
          { q: 6, prompt: 'House number', ans: '6' },
          { q: 7, prompt: "Dog's name", ans: 'Max' },
          { q: 8, prompt: "Dog's age", ans: '3' }
        ]
      },
      {
        id: 'g2-l3',
        title: 'Listening Part 3: Listen and tick (✓) the box A, B or C',
        skill: 'Listening',
        type: 'mcq_abc',
        options: ['A', 'B', 'C'],
        items: [
          { q: 9, prompt: '', ans: 'A' },
          { q: 10, prompt: '', ans: 'B' },
          { q: 11, prompt: '', ans: 'A' },
          { q: 12, prompt: '', ans: 'A' }
        ]
      },
      {
        id: 'g2-l4',
        title: 'Listening Part 4: Listen and choose the colour',
        skill: 'Listening',
        type: 'listen_colour',
        options: ['RED', 'GREEN', 'BLUE', 'YELLOW'],
        items: [
          { q: 13, prompt: '', ans: 'RED' },
          { q: 14, prompt: '', ans: 'GREEN' },
          { q: 15, prompt: '', ans: 'BLUE' },
          { q: 16, prompt: '', ans: 'YELLOW' }
        ]
      },
      {
        id: 'g2-rw1',
        title: 'Reading & Writing Part 1: Put a tick (✓) or a cross (✗)',
        skill: 'Reading & Writing',
        type: 'tick_cross',
        options: ['✓', '✗'],
        items: [
          { q: 17, prompt: '', ans: '✓' },
          { q: 18, prompt: '', ans: '✗' },
          { q: 19, prompt: '', ans: '✓' },
          { q: 20, prompt: '', ans: '✗' }
        ]
      },
      {
        id: 'g2-rw2',
        title: 'Reading & Writing Part 2: Look and read. Write YES or NO',
        skill: 'Reading & Writing',
        type: 'yes_no',
        options: ['YES', 'NO'],
        items: [
          { q: 21, prompt: '', ans: 'NO' },
          { q: 22, prompt: '', ans: 'YES' },
          { q: 23, prompt: '', ans: 'NO' },
          { q: 24, prompt: '', ans: 'NO' }
        ]
      },
      {
        id: 'g2-rw3',
        title: 'Reading & Writing Part 3: Look at the letters. Write the words',
        skill: 'Reading & Writing',
        type: 'text_blank',
        items: [
          { q: 25, prompt: '', ans: 'bookshop' },
          { q: 26, prompt: '', ans: 'child' },
          { q: 27, prompt: '', ans: 'people' },
          { q: 28, prompt: '', ans: 'farmer' }
        ]
      },
      {
        id: 'g2-rw4',
        title: 'Reading & Writing Part 4: Read the text and write the missing words',
        skill: 'Reading & Writing',
        type: 'text_blank',
        items: [
          { q: 29, prompt: '', ans: 'spelling' },
          { q: 30, prompt: '', ans: 'answering' },
          { q: 31, prompt: '', ans: 'tick' },
          { q: 32, prompt: '', ans: 'cross' }
        ]
      }
    ],
    answerKeyText: `CAMBRIDGE GRADE 2 FINAL TEST 1 (G2_FT1 - 9 PAGES)
[Listening Part 1 - Draw lines]: 1.Adam->A  2.Bella->B  3.Liam->C  4.Daniel->D
[Listening Part 2 - Write name/number]: 5.Sun  6.6  7.Max  8.3
[Listening Part 3 - Multiple choice]: 9.A  10.B  11.A  12.A
[Listening Part 4 - Colours]: 13.RED  14.GREEN  15.BLUE  16.YELLOW
[R&W Part 1 - Tick/Cross]: 17.✓  18.✗  19.✓  20.✗
[R&W Part 2 - Yes/No]: 21.NO  22.YES  23.NO  24.NO
[R&W Part 3 - Spelling]: 25.bookshop  26.child  27.people  28.farmer
[R&W Part 4 - Gap fill]: 29.spelling  30.answering  31.tick  32.cross`
  },
  {
    id: 'profile-khoi-3-starters',
    schoolName: 'TH Nguyễn Bỉnh Khiêm',
    gradeName: 'Grade 3 (Starters)',
    classLabel: '',
    examTitle: 'Cambridge Pre-A1 Starters - Practice Test 01',
    examLevel: 'Cambridge Pre-A1 Starters',
    pagesPerStudent: 9,
    maxScore: 10,
    sourceFileName: 'Starters_Sample_Key.pdf',
    updatedAt: 1732196400000,
    parts: [
      {
        id: 'st-p1',
        title: 'Listening Part 1: Listen and tick (✓) A, B or C',
        skill: 'Listening',
        type: 'mcq_abc',
        options: ['A', 'B', 'C'],
        items: [
          { q: 1, prompt: '', ans: 'A' },
          { q: 2, prompt: '', ans: 'C' },
          { q: 3, prompt: '', ans: 'B' },
          { q: 4, prompt: '', ans: 'A' },
          { q: 5, prompt: '', ans: 'C' }
        ]
      },
      {
        id: 'st-p2',
        title: 'Listening Part 2: Listen and write a name or a number',
        skill: 'Listening',
        type: 'text_blank',
        items: [
          { q: 6, prompt: '', ans: 'Lucy' },
          { q: 7, prompt: '', ans: '8' },
          { q: 8, prompt: '', ans: 'Green' },
          { q: 9, prompt: '', ans: '12' },
          { q: 10, prompt: '', ans: 'Tiger' }
        ]
      },
      {
        id: 'st-p3',
        title: 'Reading & Writing Part 1: Write YES or NO',
        skill: 'Reading & Writing',
        type: 'yes_no',
        options: ['YES', 'NO'],
        items: [
          { q: 11, prompt: '', ans: 'YES' },
          { q: 12, prompt: '', ans: 'NO' },
          { q: 13, prompt: '', ans: 'YES' },
          { q: 14, prompt: '', ans: 'NO' },
          { q: 15, prompt: '', ans: 'YES' }
        ]
      },
      {
        id: 'st-p4',
        title: 'Reading & Writing Part 2: Write the missing words',
        skill: 'Reading & Writing',
        type: 'text_blank',
        items: [
          { q: 16, prompt: '', ans: 'elephant' },
          { q: 17, prompt: '', ans: 'guitar' },
          { q: 18, prompt: '', ans: 'kitchen' },
          { q: 19, prompt: '', ans: 'pineapple' },
          { q: 20, prompt: '', ans: 'beach' }
        ]
      }
    ],
    answerKeyText: `CAMBRIDGE PRE-A1 STARTERS - PRACTICE TEST 01
[Listening Part 1]: 1.A 2.C 3.B 4.A 5.C
[Listening Part 2]: 6.Lucy 7.8 8.Green 9.12 10.Tiger
[R&W Part 1]: 11.YES 12.NO 13.YES 14.NO 15.YES
[R&W Part 2]: 16.elephant 17.guitar 18.kitchen 19.pineapple 20.beach`
  }
];

export const DEFAULT_SYSTEM_BRANDING: SystemBranding = {
  appName: 'Cambridge Grader',
  appSubtitle: 'Chấm thi Cambridge AI & Quản lý công việc thông minh',
  logoDataUrl: '',
  logoWidth: 32,
  logoHeight: 32,
  sheetHeaderTitle: 'CAMBRIDGE ENGLISH ANSWER SHEET (1-PAGE SUMMARY)',
  sheetFooterNote:
    'Instructions: Draw clear lines to match; fill or circle the correct option; write words clearly on the lines.'
};

export function createInitialTasks(todayIso: string): SmartTask[] {
  const now = Date.now();
  return [
    {
      id: 'task-init-1',
      title: 'Kiểm tra đáp án và in 35 phiếu trả lời 1 trang (A4) cho Grade 2',
      description: 'Rà soát lại Listening Part 1 và Part 4 trước khi in phiếu A4 phát cho lớp 2A1.',
      status: 'todo',
      priority: 'high',
      category: 'preparation',
      dueDate: todayIso,
      estimatedMinutes: 20,
      focusMinutesLogged: 0,
      assignee: 'Admin',
      linkedProfileId: 'profile-khoi-2-g2ft1',
      subtasks: [
        { id: 'st-1', title: 'Đối chiếu 32 câu đáp án G2_FT1', done: true },
        { id: 'st-2', title: 'Xuất file PDF khổ A4 và in thử 1 bản', done: false }
      ],
      createdAt: now - 3600000,
      updatedAt: now - 3600000
    },
    {
      id: 'task-init-2',
      title: 'Chấm thử 1 phiếu mẫu 9→1 bằng Camera AI để kiểm chuẩn',
      description: 'Chạy thử phiếu mẫu trong mục Chấm thi 1 trang để xác nhận tốc độ nhận diện chữ viết tay và nối tranh.',
      status: 'in_progress',
      priority: 'medium',
      category: 'grading',
      dueDate: todayIso,
      estimatedMinutes: 10,
      focusMinutesLogged: 5,
      assignee: 'Admin',
      linkedProfileId: 'profile-khoi-2-g2ft1',
      subtasks: [
        { id: 'st-3', title: 'Chạy thử phiếu mẫu Grade 2', done: false },
        { id: 'st-4', title: 'Kiểm tra bảng điểm và xuất thử file Excel', done: false }
      ],
      createdAt: now - 1800000,
      updatedAt: now - 1800000
    }
  ];
}
