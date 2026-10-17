/** The go-live steps, in run order. */
import type { Step } from '../lib/context.js';
import { deployRender } from './deploy-render.js';
import { finalizeDocs } from './finalize-docs.js';
import { liveAi } from './live-ai.js';
import { preflight } from './preflight.js';
import { sandboxSetup } from './sandbox-setup.js';
import { sandboxSpike } from './sandbox-spike.js';
import { videoVo } from './video-vo.js';

export const STEPS: Step[] = [preflight, sandboxSetup, sandboxSpike, liveAi, deployRender, videoVo, finalizeDocs];
