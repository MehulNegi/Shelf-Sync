import { SetupError } from './env.js';

export function loadDemoOrderFeedConfig(env: NodeJS.ProcessEnv = process.env): { enabled: boolean } {
  const value = env.DEMO_ORDER_FEED_ENABLED;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new SetupError('DEMO_ORDER_FEED_ENABLED must be true or false. Enable only for the owner-confirmed isolated hackathon database.');
  }
  return { enabled: value === 'true' };
}
