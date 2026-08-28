// Built-in question pools: room type -> array of >= 8 questions.
// To extend the game, simply add strings to the arrays below.

export const STORAGE_PROMPT =
  'Open floor: leave any comment about the sprint — anything at all.';

export const QUESTIONS = {
  medical: [
    'What was the most frustrating moment of this sprint and why?',
    'Which task took much longer than expected? What slowed it down?',
    "What broke this sprint that shouldn't have?",
    'Where did we waste the most time this sprint?',
    "What's one thing that went worse than last sprint?",
    'Which meeting or ceremony felt least useful this sprint?',
    'What almost went wrong this sprint but we got lucky?',
    'What technical debt hurt us the most this sprint?',
  ],
  recreation: [
    'What is one thing the team did this sprint that we should definitely do again?',
    'What was your proudest moment of the sprint?',
    'Who helped you the most this sprint, and how?',
    'Which delivery this sprint are you most happy with?',
    'What went more smoothly than expected this sprint?',
    "What's the best decision the team made this sprint?",
    'What small win deserves more celebration?',
    'Which tool or practice made your life easier this sprint?',
  ],
  cafeteria: [
    "On a scale of 1–10, how sustainable did this sprint's pace feel? Explain.",
    'How was your energy at the end of the sprint compared to the start?',
    'Did you feel comfortable asking for help this sprint? Why / why not?',
    'What is one thing that would improve team morale next sprint?',
    'Was your workload this sprint too much, too little, or just right?',
    'What stressed you the most this sprint?',
    'Did you have enough focus time this sprint? What interrupted you?',
    'What made you smile at work this sprint?',
  ],
  engine: [
    'If you could change one thing about our process next sprint, what would it be?',
    'What experiment should we try next sprint?',
    "What's one thing we should stop doing entirely?",
    'What could we automate that we currently do by hand?',
    'How could we improve our planning or estimation?',
    'What would make our code reviews better?',
    "What's one small change that would have an outsized impact?",
    'Which recurring problem should we finally fix next sprint?',
  ],
  navigation: [
    "What is something you learned this sprint that you didn't know before?",
    'What surprised you most this sprint?',
    'What skill would you like to develop next sprint?',
    'What did you learn from a mistake this sprint?',
    "What's something a teammate taught you this sprint?",
    'What did we learn about our users or stakeholders this sprint?',
    'Which unknown from sprint planning turned out differently than expected?',
    'What documentation or knowledge gap did you discover this sprint?',
  ],
  security: [
    'What blocked you the longest this sprint? Is it resolved?',
    'What risk are we not talking about enough?',
    'What external dependency caused problems this sprint?',
    "What could derail us next sprint if we don't act now?",
    'Where were you waiting on someone else this sprint?',
    'What single point of failure worries you the most?',
    'Which unclear requirement caused rework or confusion?',
    "Is there a looming deadline or commitment you're worried about?",
  ],
  conference: [
    'When did collaboration work best this sprint? What made it work?',
    'How well did we communicate as a team this sprint?',
    'Was any work duplicated or dropped due to miscommunication?',
    'Did you feel heard in team discussions this sprint?',
    'How well did we collaborate with people outside the team?',
    'What would make our standups more valuable?',
    'When did you feel most like part of a team this sprint?',
    "Is there anything you wanted to say this sprint but didn't?",
  ],
};
