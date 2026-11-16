// A stand-in reader that looks at nothing and always "reads" the same made-up recipe. It is for the
// tests and for trying the whole path on a computer (scripts/dev-server.mjs) without an AI service.
// Set RECIPES_FAKE_FAIL to make it refuse instead, with that text as the reason.

import { JobError } from '../jobs.mjs';

export const name = 'Stand-in';

export async function read({ pictures }) {
  if (process.env.RECIPES_FAKE_FAIL) throw new JobError(process.env.RECIPES_FAKE_FAIL);
  return {
    title: 'Lemon rice',
    ingredients: ['For the rice:', '1 cup rice', '2 cups water', '½ tsp salt', 'To finish:', '1 lemon, juiced', 'A handful of parsley, chopped'],
    steps: ['Rinse the rice until the water runs clear.', 'Simmer it in the salted water for 15 minutes.', 'To finish:', 'Stir in the lemon juice and the parsley.'],
    notes: 'Keeps for 2 days in the fridge.',
    time: '25 minutes',
    serves: '4 servings',
    source: pictures.length > 1 ? 'A made-up cookbook' : '',
    unsure: ['½ tsp salt'],
  };
}
