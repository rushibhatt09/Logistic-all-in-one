import { recalculateDisputes } from '../src/services/importService.js';

const result = await recalculateDisputes();
console.log(`Rate cards checked. Validated ${result.chargesValidated} charge rows and created ${result.disputesCreated} disputes.`);
