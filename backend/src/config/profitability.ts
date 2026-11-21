import { SetupError } from './env.js';
export interface ProfitabilityConfig { enabled: boolean; demoWrites: boolean }
export function loadProfitabilityConfig(env: NodeJS.ProcessEnv=process.env): ProfitabilityConfig {
  const flag=(key:string)=>{if(env[key]!==undefined && !['true','false'].includes(env[key]!)) throw new SetupError(`${key} must be true or false.`);return env[key]==='true';};
  return {enabled:flag('PROFITABILITY_ENABLED'),demoWrites:flag('PROFITABILITY_DEMO_WRITES_ENABLED')};
}
