// Built-in question pools: room type -> array of >= 8 questions.
// To extend the game, simply add strings to the arrays below.

export const STORAGE_PROMPT =
  'Open floor: leave any comment about the sprint, anything at all.';

export const QUESTIONS = {
  // What didn't go well | Problems, pain points, failures during the sprint
  medical: [
    'What did not go well this sprint and why?',
    'Which task took much longer than expected? What slowed it down?',
    "What broke this sprint that shouldn't have?",
    "What's one thing you wish you did differently this sprint?",
    'What almost went wrong this sprint but we got lucky?',
  ],
  // What went well | Wins, highlights, things to keep doing
  recreation: [
    'What is one thing the team did this sprint that we should definitely do again?',
    'Who helped you the most this sprint, and how?',
    'Which delivery this sprint are you most happy with?',
    'What went more smoothly than expected this sprint?',
    'What small win deserves more celebration?',
    'Which tool or practice made your life easier this sprint?',
  ],
  // Serenity | Team mood, morale, sustainability of pace
  cafeteria: [
    'Was your workload this sprint too much, too little, or just right? Explain.',
    'What stressed you the most this sprint?',
    'Did you have enough focus time this sprint? What interrupted you?',
    'What made you smile at work this sprint?',
  ],
  // Improvements | Concrete ideas for improvement / experiments
  engine: [
    'What experiment should we try next sprint?',
    'What could we automate that we currently do by hand?',
    'Which recurring problem should we finally fix next sprint?',
  ],
  // Learning | Things learned, new skills, discoveries
  navigation: [
    "What is something you learned this sprint that you didn't know before?",
    'What skill would you like to develop next sprint?',
    'What did you learn from a mistake this sprint?',
    "What's something a teammate taught you this sprint?",
  ],
  // Risks & blockers | Risks and blockers encountered during the sprint
  security: [
    'What blocked you the longest this sprint? Is it resolved?',
    'What external dependency caused problems this sprint?',
    'Where were you waiting on someone else this sprint?',
    "Is there a looming deadline or commitment you're worried about?",
  ],
  // Teamwork | Collaboration, communication, ways of working
  conference: [
    'When did collaboration work best this sprint? What made it work?',
    'When did you feel most like part of a team this sprint?',
    "Is there anything you wanted to say this sprint but didn't?",
  ],
};
