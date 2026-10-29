import './smr-display-test.mjs';
import { runSelfTests } from '../src/lib/selfTest.js';
try { const result=runSelfTests(); console.log(JSON.stringify(result)); }
catch(error){ console.error(error); process.exitCode=1; }

