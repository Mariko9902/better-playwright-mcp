import common from './tools/common.js';
import consoleTools from './tools/console.js';
import debugSummary from './tools/debug_summary.js';
import dialogs from './tools/dialogs.js';
import enhancedFramework from './tools/enhanced_framework.js';
import enhancedResilience from './tools/enhanced_resilience.js';
import enhancedWait from './tools/enhanced_wait.js';
import batch from './tools/batch.js';
import evaluate from './tools/evaluate.js';
import files from './tools/files.js';
import form from './tools/form.js';
import keyboard from './tools/keyboard.js';
import navigate from './tools/navigate.js';
import network from './tools/network.js';
import pdf from './tools/pdf.js';
import request from './tools/request.js';
import runCode from './tools/run_code.js';
import search from './tools/search.js';
import screenshot from './tools/screenshot.js';
import snapshot from './tools/snapshot.js';
import tabs from './tools/tabs.js';
import testingSelectors from './tools/testing_selectors.js';
import wait from './tools/wait.js';

export const allTools: any[] = [
  ...common,
  ...consoleTools,
  ...debugSummary,
  ...dialogs,
  ...enhancedFramework,
  ...enhancedResilience,
  ...enhancedWait,
  ...batch,
  ...evaluate,
  ...files,
  ...form,
  ...keyboard,
  ...navigate,
  ...network,
  ...pdf,
  ...request,
  ...runCode,
  ...search,
  ...screenshot,
  ...snapshot,
  ...tabs,
  ...testingSelectors,
  ...wait,
];

export function filteredTools(config: any) {
  return allTools.filter(tool => tool.capability.startsWith('core') || config.capabilities?.includes(tool.capability));
}
